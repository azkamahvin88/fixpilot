import api, { route } from '@forge/api';
import { render, Fragment, Text, Heading, Section, Button, useState, useEffect, useProductContext } from '@forge/ui';
import { scoreTriage, rankHypotheses, adfToText } from './lib/triage';

function App() {
  const { platformContext } = useProductContext();
  const issueKey =
    (platformContext && platformContext.issueKey) ||
    (platformContext && platformContext.issue && platformContext.issue.key) ||
    null;
  const [state, setState] = useState({ loading: true, error: null, result: null });

  async function load() {
    if (!issueKey) {
      setState({ loading: false, error: 'Could not determine the open issue.', result: null });
      return;
    }
    setState({ loading: true, error: null, result: null });
    try {
      const res = await api
        .asUser()
        .requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary,description,status,priority,labels,issuelinks`);
      if (!res.ok) throw new Error(`Jira returned HTTP ${res.status}`);
      const issue = await res.json();
      const analysis = scoreTriage(issue);
      const hypotheses = rankHypotheses(issue, []);
      setState({ loading: false, error: null, result: { issue, analysis, hypotheses } });
    } catch (e) {
      setState({ loading: false, error: String((e && e.message) || e), result: null });
    }
  }

  useEffect(() => {
    load();
  }, [issueKey]);

  if (state.loading) {
    return render(
      <Fragment>
        <Text>FixPilot is checking this issue…</Text>
      </Fragment>
    );
  }
  if (state.error || !state.result) {
    return render(
      <Fragment>
        <Text>FixPilot could not triage this issue: {state.error || 'unknown error'}</Text>
        <Button text="Re-check" onClick={load} />
      </Fragment>
    );
  }

  const { analysis, hypotheses } = state.result;
  return render(
    <Fragment>
      <Heading size="medium">FixPilot triage — {analysis.score}/100</Heading>
      <Section>
        <Text>
          {analysis.missing.length === 0
            ? 'This bug report is complete.'
            : `Missing: ${analysis.missing.join('; ')}`}
        </Text>
      </Section>
      <Section>
        <Heading size="small">Checklist</Heading>
        {analysis.checks.map((c) => (
          <Text key={c.key}>
            {c.pass ? '✓' : '✗'} {c.label}
          </Text>
        ))}
      </Section>
      <Section>
        <Heading size="small">Top hypothesis</Heading>
        <Text>
          [{hypotheses[0].confidence}] {hypotheses[0].hypothesis}
        </Text>
        <Text>{hypotheses[0].evidence}</Text>
      </Section>
      <Button text="Re-check" onClick={load} />
      <Text>For the full plan, ask @FixPilot in Rovo Chat.</Text>
    </Fragment>
  );
}

export const run = render(<App />);
