import {
  adfToText,
  adfDoc,
  extractSections,
  scoreTriage,
  rankHypotheses,
  formatTriageMarkdown,
  buildRunbookStorage,
} from '../src/lib/triage';

const adfDescription = {
  type: 'doc',
  version: 1,
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Steps to reproduce' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '1. Open the checkout page' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '2. Apply a discount code' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Expected result' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'The total drops by 10%.' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Actual result' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'The total stays the same.' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Environment' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Chrome 142, production, v2.14.0' }] },
  ],
};

const completeIssue = {
  key: 'SHOP-123',
  fields: {
    summary: 'Discount code does not change the total at checkout',
    description: adfDescription,
    status: { name: 'To Do' },
    priority: { name: 'High' },
    labels: ['checkout'],
    issuelinks: [{ outwardIssue: { key: 'SHOP-120' } }],
  },
};

const emptyIssue = {
  key: 'SHOP-999',
  fields: {
    summary: 'Broken',
    description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'It does not work.' }] }] },
    status: { name: 'To Do' },
    priority: null,
    labels: [],
    issuelinks: [],
  },
};

test('adfToText flattens headings and paragraphs', () => {
  const text = adfToText(adfDescription);
  expect(text).toMatch(/Steps to reproduce/);
  expect(text).toMatch(/Apply a discount code/);
  expect(text).toMatch(/Chrome 142/);
});

test('adfToText handles null and strings', () => {
  expect(adfToText(null)).toBe('');
  expect(adfToText('plain')).toBe('plain');
  expect(adfDoc([1, 2]).content).toHaveLength(2);
});

test('extractSections finds all four sections', () => {
  const sections = extractSections(adfToText(adfDescription));
  expect(sections.repro).toMatch(/checkout page/);
  expect(sections.expected).toMatch(/drops by 10%/);
  expect(sections.actual).toMatch(/stays the same/);
  expect(sections.environment).toMatch(/Chrome 142/);
});

test('extractSections returns nulls for an empty description', () => {
  const sections = extractSections('It does not work.');
  expect(sections.repro).toBeNull();
  expect(sections.expected).toBeNull();
});

test('scoreTriage gives a complete issue a high score', () => {
  const result = scoreTriage(completeIssue);
  expect(result.score).toBeGreaterThanOrEqual(90);
  expect(result.missing).toHaveLength(0);
});

test('scoreTriage gives a bare issue a low score and lists what is missing', () => {
  const result = scoreTriage(emptyIssue);
  expect(result.score).toBeLessThan(50);
  expect(result.missing).toContain('Reproduction steps included');
  expect(result.missing).toContain('Expected result stated');
  expect(result.missing).toContain('Actual result stated');
  expect(result.missing).toContain('Environment / version stated');
  expect(result.missing).toContain('Priority is set');
});

test('rankHypotheses flags a regression from the report text', () => {
  const issue = {
    key: 'SHOP-200',
    fields: {
      summary: 'Checkout broke',
      description: {
        type: 'doc', version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'It worked before the last deploy. Now the total never updates.' }] }],
      },
    },
  };
  const hyps = rankHypotheses(issue, []);
  expect(hyps[0].hypothesis).toMatch(/Regression/);
  expect(hyps[0].confidence).toBe('high');
});

test('rankHypotheses cites linked issues', () => {
  const hyps = rankHypotheses(completeIssue, [{ key: 'SHOP-120', status: 'In Progress' }]);
  expect(hyps.some((h) => h.hypothesis.includes('SHOP-120'))).toBe(true);
});

test('formatTriageMarkdown contains score and hypotheses', () => {
  const analysis = scoreTriage(completeIssue);
  const hyps = rankHypotheses(completeIssue, [{ key: 'SHOP-120', status: 'In Progress' }]);
  const md = formatTriageMarkdown(completeIssue, analysis, hyps);
  expect(md).toMatch(/SHOP-123/);
  expect(md).toMatch(/Completeness score: 100\/100/);
  expect(md).toMatch(/Root-cause hypotheses/);
});

test('buildRunbookStorage produces a runbook with all sections', () => {
  const analysis = scoreTriage(completeIssue);
  const hyps = rankHypotheses(completeIssue, []);
  const storage = buildRunbookStorage(completeIssue, analysis, hyps);
  expect(storage).toMatch(/Runbook — SHOP-123/);
  expect(storage).toMatch(/Steps to reproduce/);
  expect(storage).toMatch(/Test checklist/);
  expect(storage).not.toMatch(/<script/);
});

test('scoreTriage never crashes on a missing description', () => {
  const issue = { key: 'X-1', fields: { summary: 'No desc', description: null, priority: null, labels: [], issuelinks: [] } };
  const result = scoreTriage(issue);
  expect(result.score).toBeLessThan(50);
});

test('adfToText handles mentions and hard breaks', () => {
  const node = {
    type: 'doc', version: 1,
    content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'Hi ' },
      { type: 'mention', attrs: { text: '@Ana' } },
      { type: 'hardBreak' },
      { type: 'text', text: 'see above' },
    ] }],
  };
  expect(adfToText(node)).toMatch(/@Ana/);
  expect(adfToText(node)).toMatch(/see above/);
});
