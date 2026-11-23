import Resolver from '@forge/resolver';
import { scoreTriage, rankHypotheses, formatTriageMarkdown, buildRunbookStorage } from './lib/triage';
import { getIssue, getRecentComments, getLinkedIssues, addComment } from './lib/jira';
import { getFirstSpace, createPage } from './lib/confluence';

const fixpilotResolver = new Resolver();

function issueKeyFrom(payload, context) {
  if (payload && payload.issueKey) return String(payload.issueKey).trim().toUpperCase();
  // Rovo passes the open work item in the action context when available.
  const ctx = (context && context.extension) || {};
  if (ctx.issue && ctx.issue.key) return String(ctx.issue.key).trim().toUpperCase();
  if (ctx.jira && ctx.jira.issue && ctx.jira.issue.key) return String(ctx.jira.issue.key).trim().toUpperCase();
  return null;
}

async function runTriage(issueKey) {
  const issue = await getIssue(issueKey);
  const analysis = scoreTriage(issue);
  const linked = await getLinkedIssues(issue);
  const hypotheses = rankHypotheses(issue, linked);
  return { issue, analysis, linked, hypotheses };
}

fixpilotResolver.define('get-issue-triage', async ({ payload, context }) => {
  const issueKey = issueKeyFrom(payload, context);
  if (!issueKey) {
    return { error: 'No issue key given. Please tell me the issue key, e.g. PROJ-123, or open the issue first.' };
  }
  const { issue, analysis } = await runTriage(issueKey);
  return {
    issueKey,
    summary: issue.fields.summary,
    status: issue.fields.status && issue.fields.status.name,
    priority: issue.fields.priority && issue.fields.priority.name,
    completenessScore: analysis.score,
    missingInformation: analysis.missing,
    sectionsFound: Object.fromEntries(
      Object.entries(analysis.sections).map(([k, v]) => [k, Boolean(v)])
    ),
  };
});

fixpilotResolver.define('get-linked-context', async ({ payload, context }) => {
  const issueKey = issueKeyFrom(payload, context);
  if (!issueKey) {
    return { error: 'No issue key given. Please tell me the issue key, e.g. PROJ-123, or open the issue first.' };
  }
  const { issue, linked } = await runTriage(issueKey);
  const comments = await getRecentComments(issueKey);
  return {
    issueKey,
    linkedIssues: linked,
    recentComments: comments.map((c) => ({ author: c.author, created: c.created })),
    linkedCount: linked.length,
    commentCount: comments.length,
    note: linked.length === 0
      ? 'No linked issues found. Triage is based on this issue alone.'
      : `${linked.length} linked issue(s) found; see linkedIssues for their status.`,
  };
});

fixpilotResolver.define('draft-fix-plan', async ({ payload, context }) => {
  const issueKey = issueKeyFrom(payload, context);
  if (!issueKey) {
    return { error: 'No issue key given. Please tell me the issue key, e.g. PROJ-123, or open the issue first.' };
  }
  const { issue, analysis, hypotheses } = await runTriage(issueKey);
  const plan = formatTriageMarkdown(issue, analysis, hypotheses);
  return {
    issueKey,
    draftOnly: true,
    plan,
    note: 'This is a DRAFT. Nothing has been saved. Ask me to post it as a comment or create a runbook page, and I will do so only after you confirm.',
  };
});

fixpilotResolver.define('post-triage-comment', async ({ payload, context }) => {
  const issueKey = issueKeyFrom(payload, context);
  if (!issueKey) {
    return { error: 'No issue key given. Please tell me the issue key, e.g. PROJ-123, or open the issue first.' };
  }
  const { issue, analysis, hypotheses } = await runTriage(issueKey);
  const text = formatTriageMarkdown(issue, analysis, hypotheses);
  const comment = await addComment(issueKey, text);
  return {
    issueKey,
    posted: true,
    commentId: comment.id,
    note: `Triage summary posted as a comment on ${issueKey}.`,
  };
});

fixpilotResolver.define('create-runbook-page', async ({ payload, context }) => {
  const issueKey = issueKeyFrom(payload, context);
  if (!issueKey) {
    return { error: 'No issue key given. Please tell me the issue key, e.g. PROJ-123, or open the issue first.' };
  }
  const spaceKey = (payload && payload.spaceKey && String(payload.spaceKey).trim().toUpperCase()) || null;
  const { issue, analysis, hypotheses } = await runTriage(issueKey);
  const space = spaceKey ? { key: spaceKey } : await getFirstSpace();
  const title = `Runbook — ${issueKey}: ${issue.fields.summary || 'Bug triage'}`;
  const body = buildRunbookStorage(issue, analysis, hypotheses);
  const page = await createPage(space.key, title, body);
  return {
    issueKey,
    created: true,
    spaceKey: space.key,
    pageId: page.id,
    pageTitle: page.title,
    pageUrl: page._links && page._links.webui,
    note: `Runbook draft created in space ${space.key}.`,
  };
});

export const resolver = fixpilotResolver.getDefinitions();
