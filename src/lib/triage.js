/**
 * FixPilot triage logic — PURE functions, no Forge imports.
 * Safe to unit-test with Jest and to reuse from the agent resolver,
 * the MCP tools, and the Jira issue panel.
 */

// ---------------------------------------------------------------------------
// ADF (Atlassian Document Format) helpers — Jira v3 descriptions are ADF.
// ---------------------------------------------------------------------------

/** Recursively convert an ADF node to plain text. */
export function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(adfToText).join('\n');
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'mention') return node.attrs && node.attrs.text ? node.attrs.text : '@user';
  if (node.content) {
    // Block containers separate children with newlines; inline containers
    // (strong, em, link, ...) join without a separator.
    const BLOCK_TYPES = new Set([
      'doc', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem',
      'table', 'tableRow', 'tableCell', 'tableHeader', 'blockquote',
      'codeBlock', 'panel', 'expand', 'taskList', 'taskItem', 'mediaGroup',
    ]);
    const sep = BLOCK_TYPES.has(node.type) ? '\n' : '';
    return node.content.map(adfToText).join(sep);
  }
  return '';
}

/** Build a minimal ADF document from an array of block nodes. */
export function adfDoc(blocks) {
  return { type: 'doc', version: 1, content: blocks };
}

export function adfParagraph(text) {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

export function adfHeading(text, level = 2) {
  return { type: 'heading', attrs: { level }, content: [{ type: 'text', text }] };
}

export function adfBulletList(items) {
  return {
    type: 'bulletList',
    content: items.map((item) => ({
      type: 'listItem',
      content: [adfParagraph(item)],
    })),
  };
}

// ---------------------------------------------------------------------------
// Section extraction from a bug description.
// ---------------------------------------------------------------------------

const SECTION_PATTERNS = {
  repro: /(steps?\s+to\s+reproduce|repro(duce|duction)?|langkah\s+(reproduksi|untuk\s+mereproduksi)|cara\s+mereproduksi)/i,
  expected: /(expected\s+(result|behaviou?r)|hasil\s+yang\s+diharapkan|seharusnya)/i,
  actual: /(actual\s+(result|behaviou?r)|hasil\s+(aktual|yang\s+terjadi)|yang\s+terjadi)/i,
  environment: /(environment|env(ironment)?|lingkungan|browser|os|version|versi)/i,
};

/**
 * Split a plain-text description into known bug-report sections.
 * Returns { repro, expected, actual, environment } — each a string or null.
 * Lines that match no heading are kept under the closest previous section.
 */
export function extractSections(text) {
  const sections = { repro: null, expected: null, actual: null, environment: null };
  if (!text || !text.trim()) return sections;
  const lines = text.split('\n');
  let current = null;
  const buckets = { repro: [], expected: [], actual: [], environment: [], other: [] };
  for (const line of lines) {
    let matched = null;
    for (const [key, pattern] of Object.entries(SECTION_PATTERNS)) {
      if (pattern.test(line)) { matched = key; break; }
    }
    if (matched) {
      current = matched;
      // Keep the heading line itself out of the content, but keep any
      // trailing text after a colon on the same line.
      const afterColon = line.split(':').slice(1).join(':').trim();
      if (afterColon) buckets[matched].push(afterColon);
    } else if (current) {
      buckets[current].push(line);
    } else {
      buckets.other.push(line);
    }
  }
  for (const key of Object.keys(sections)) {
    const body = buckets[key].join('\n').trim();
    if (body) sections[key] = body;
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Triage scoring.
// ---------------------------------------------------------------------------

/**
 * Score how complete a bug report is (0-100) and list exactly what is missing.
 * `issue` is the Jira issue JSON (fields.summary, fields.description as ADF,
 * fields.status, fields.priority, fields.labels, fields.issuelinks).
 */
export function scoreTriage(issue) {
  const fields = issue.fields || {};
  const descriptionText = adfToText(fields.description);
  const sections = extractSections(descriptionText);
  const links = fields.issuelinks || [];
  const checks = [
    { key: 'summary', label: 'Summary describes the problem', pass: Boolean(fields.summary && fields.summary.trim().length > 10) },
    { key: 'description', label: 'Description is present', pass: descriptionText.trim().length > 20 },
    { key: 'repro', label: 'Reproduction steps included', pass: Boolean(sections.repro) },
    { key: 'expected', label: 'Expected result stated', pass: Boolean(sections.expected) },
    { key: 'actual', label: 'Actual result stated', pass: Boolean(sections.actual) },
    { key: 'environment', label: 'Environment / version stated', pass: Boolean(sections.environment) },
    { key: 'priority', label: 'Priority is set', pass: Boolean(fields.priority) },
    { key: 'context', label: 'Linked issue, label, or attachment gives context', pass: links.length > 0 || (fields.labels || []).length > 0 },
  ];
  const passed = checks.filter((c) => c.pass).length;
  const score = Math.round((passed / checks.length) * 100);
  const missing = checks.filter((c) => !c.pass).map((c) => c.label);
  return { score, checks, missing, sections, descriptionText };
}

// ---------------------------------------------------------------------------
// Root-cause hypotheses (heuristic, evidence-based, never invented).
// ---------------------------------------------------------------------------

/**
 * Rank root-cause hypotheses from the issue text and linked issues.
 * Every hypothesis cites its evidence. Returns highest-confidence first.
 */
export function rankHypotheses(issue, linkedIssues = []) {
  const fields = issue.fields || {};
  const text = adfToText(fields.description) + '\n' + (fields.summary || '');
  const hypotheses = [];

  if (/regress|used to work|worked before|dulu (bisa|jalan|normal)|setelah (update|deploy|rilis)|after (update|deploy|release)/i.test(text)) {
    hypotheses.push({
      hypothesis: 'Regression from a recent change',
      confidence: 'high',
      evidence: 'Report mentions the feature worked before a recent update/deploy.',
    });
  }
  if (linkedIssues.length > 0) {
    const openLinked = linkedIssues.filter((l) => l.status && /open|progress|reopen|to do/i.test(l.status));
    hypotheses.push({
      hypothesis: 'Related to linked issue(s): ' + linkedIssues.map((l) => l.key).join(', '),
      confidence: openLinked.length > 0 ? 'medium' : 'low',
      evidence: `${linkedIssues.length} linked issue(s), ${openLinked.length} still open.`,
    });
  }
  if (/only (on|in)|hanya (di|pada)|specific|tertentu/i.test(text) && extractSections(text).environment) {
    hypotheses.push({
      hypothesis: 'Environment-specific failure',
      confidence: 'medium',
      evidence: 'Report names a specific environment/version where the failure occurs.',
    });
  }
  if (/intermittent|kadang|random|sometimes|flaky/i.test(text)) {
    hypotheses.push({
      hypothesis: 'Intermittent / timing-dependent failure (race condition or flaky dependency)',
      confidence: 'medium',
      evidence: 'Report describes the failure as intermittent.',
    });
  }
  if (hypotheses.length === 0) {
    hypotheses.push({
      hypothesis: 'Not enough signal to rank a root cause yet',
      confidence: 'low',
      evidence: 'No regression hint, linked issue, environment detail, or intermittency in the report.',
    });
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return hypotheses.sort((a, b) => rank[a.confidence] - rank[b.confidence]);
}

// ---------------------------------------------------------------------------
// Rendering: markdown summary + Confluence storage format.
// ---------------------------------------------------------------------------

export function formatTriageMarkdown(issue, analysis, hypotheses) {
  const key = issue.key || 'UNKNOWN';
  const summary = (issue.fields && issue.fields.summary) || '';
  const lines = [
    `## FixPilot triage — ${key}: ${summary}`,
    '',
    `**Completeness score: ${analysis.score}/100**`,
    '',
  ];
  if (analysis.missing.length > 0) {
    lines.push('**Missing information:**');
    for (const m of analysis.missing) lines.push(`- ${m}`);
    lines.push('');
  } else {
    lines.push('No information missing — the report is complete.');
    lines.push('');
  }
  lines.push('**Root-cause hypotheses (ranked):**');
  hypotheses.forEach((h, i) => {
    lines.push(`${i + 1}. [${h.confidence}] ${h.hypothesis} — _${h.evidence}_`);
  });
  lines.push('');
  lines.push('**Suggested next step:** reproduce with the steps above, then verify the top hypothesis first.');
  return lines.join('\n');
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Build a Confluence storage-format (XHTML) runbook body. */
export function buildRunbookStorage(issue, analysis, hypotheses) {
  const key = issue.key || 'UNKNOWN';
  const summary = (issue.fields && issue.fields.summary) || '';
  const sections = analysis.sections;
  const part = (title, body) =>
    body ? `<h2>${escHtml(title)}</h2><p>${escHtml(body).replace(/\n/g, '<br/>')}</p>` : '';
  const missingList = analysis.missing.length
    ? `<ul>${analysis.missing.map((m) => `<li>${escHtml(m)}</li>`).join('')}</ul>`
    : '<p>None — report is complete.</p>';
  const hypoList = `<ol>${hypotheses.map((h) => `<li><strong>[${escHtml(h.confidence)}] ${escHtml(h.hypothesis)}</strong> — ${escHtml(h.evidence)}</li>`).join('')}</ol>`;
  return [
    `<h1>Runbook — ${escHtml(key)}: ${escHtml(summary)}</h1>`,
    `<p>Generated by FixPilot triage. Completeness score: <strong>${analysis.score}/100</strong>. Source issue: ${escHtml(key)}.</p>`,
    part('Steps to reproduce', sections.repro),
    part('Expected result', sections.expected),
    part('Actual result', sections.actual),
    part('Environment', sections.environment),
    `<h2>Missing information</h2>${missingList}`,
    `<h2>Root-cause hypotheses (ranked)</h2>${hypoList}`,
    '<h2>Test checklist</h2><ul><li>Reproduce on the reported environment</li><li>Verify the fix against the expected result</li><li>Add a regression test for this case</li></ul>',
  ].join('\n');
}
