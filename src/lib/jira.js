import api, { route } from '@forge/api';
import { adfDoc, adfHeading, adfParagraph, adfBulletList, formatTriageMarkdown } from './triage';

/** Fetch a Jira issue with the fields FixPilot needs. */
export async function getIssue(issueKey) {
  const res = await api
    .asUser()
    .requestJira(
      route`/rest/api/3/issue/${issueKey}?fields=summary,description,status,priority,labels,issuelinks,reporter,assignee`
    );
  if (!res.ok) {
    throw new Error(`Could not read issue ${issueKey} (HTTP ${res.status}).`);
  }
  return res.json();
}

/** Fetch the most recent comments on an issue (newest first, max 5). */
export async function getRecentComments(issueKey) {
  const res = await api
    .asUser()
    .requestJira(route`/rest/api/3/issue/${issueKey}/comment?maxResults=5&orderBy=-created`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.comments || []).map((c) => ({
    author: c.author && c.author.displayName,
    created: c.created,
    body: c.body,
  }));
}

/** Fetch summary + status for each linked issue (max 5). */
export async function getLinkedIssues(issue) {
  const links = (issue.fields && issue.fields.issuelinks) || [];
  const keys = [];
  for (const link of links.slice(0, 5)) {
    const target = link.outwardIssue || link.inwardIssue;
    if (target && target.key) keys.push(target.key);
  }
  const out = [];
  for (const key of keys) {
    try {
      const res = await api
        .asUser()
        .requestJira(route`/rest/api/3/issue/${key}?fields=summary,status`);
      if (res.ok) {
        const data = await res.json();
        out.push({ key, summary: data.fields.summary, status: data.fields.status && data.fields.status.name });
      }
    } catch (e) {
      // A linked issue the user cannot see must not break triage.
    }
  }
  return out;
}

/** Post a comment on an issue. Body is plain text converted to ADF. */
export async function addComment(issueKey, text) {
  const blocks = [adfHeading('FixPilot triage summary', 2)];
  for (const para of String(text).split('\n\n')) {
    if (para.startsWith('- ')) {
      blocks.push(adfBulletList(para.split('\n').map((l) => l.replace(/^- /, ''))));
    } else if (para.trim()) {
      blocks.push(adfParagraph(para.trim()));
    }
  }
  const res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: adfDoc(blocks) }),
  });
  if (!res.ok) {
    throw new Error(`Could not post comment on ${issueKey} (HTTP ${res.status}).`);
  }
  return res.json();
}

/** Shared helper: build the markdown triage summary for an issue. */
export function triageSummaryText(issue, analysis, hypotheses) {
  return formatTriageMarkdown(issue, analysis, hypotheses);
}
