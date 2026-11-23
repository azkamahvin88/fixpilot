# FixPilot — bug-triage copilot for Jira

**Codegeist 2026 entry — Apps for Software Teams.**
Bonus prizes targeted: **Best Agents (rovo:agent)** + **Best app with Atlassian MCP (rovo:mcp)**.

FixPilot is a Rovo agent + MCP server on Atlassian Forge. It reads a Jira bug issue,
scores how complete the report is, ranks likely root causes from linked context,
and drafts a fix plan plus a Confluence runbook — **never writing anything until
you confirm**.

## What it does

1. **Read the issue** — summary, description, status, priority, labels, linked
   issues, recent comments — via the Jira REST API as the chatting user
   (`api.asUser()`, so Jira permissions apply).
2. **Deterministic triage** (not LLM guesswork): extracts repro steps / expected /
   actual / environment from the description, scores completeness 0–100, and lists
   exactly what is missing.
3. **Ranked root-cause hypotheses**, each citing its evidence (regression hint,
   linked issues, environment detail, intermittency).
4. **Draft fix plan** as text — nothing is saved at this stage.
5. **After your confirmation only:** post the triage summary as a Jira comment,
   and create a Confluence runbook page (repro + fix plan + test checklist).
6. **Jira issue panel "FixPilot Triage"** shows the same score + checklist on
   every issue, with a Re-check button.
7. **MCP server** exposes the read tools (`get-issue-triage`, `get-linked-context`)
   so custom agents in Rovo Studio can call them.

## How to use (demo)

1. Install FixPilot on a Jira site where **Rovo is enabled**.
2. Open any bug issue, e.g. `SHOP-123`.
3. Open Rovo Chat and mention **@FixPilot**, then ask:
   - "Triage this issue"
   - "What is missing from this bug report?"
   - "Draft a fix plan for this issue"
4. Review the triage, then confirm to post the comment or create the runbook.

## Setup for judges

1. Open the installation link and install FixPilot on a Jira site where Rovo is enabled.
2. No configuration is needed. The app needs no API keys and makes no external
   network calls — everything runs on Atlassian.
3. For the runbook feature, the site needs at least one Confluence space the
   installing user can write to. If no space key is given, the first accessible
   space is used.

## Architecture

```
fixpilot/ (Forge app, Node 24, @forge/api)
├── manifest.yml            — rovo:agent + rovo:mcp + jira:issuePanel + 5 actions
├── src/index.js            — @forge/resolver dispatching the 5 actions
├── src/panel.jsx           — UI Kit issue panel (score + checklist + Re-check)
├── src/lib/triage.js       — pure logic: ADF→text, section parser, scoring,
│                             hypothesis ranking, markdown + Confluence rendering
├── src/lib/jira.js         — Jira REST helpers (asUser)
├── src/lib/confluence.js   — Confluence REST helpers (asUser)
└── test/triage.test.js     — 13 Jest tests for the pure logic
```

No Forge LLM calls (Rovo provides the reasoning), no remotes, no egress,
no external storage. All logic that can be tested is pure and covered by Jest.

## Honest notes

- **FixPilot is not a Jira assignee.** A Forge `rovo:agent` has no assignment
  property; work-item assignment is only documented for `rovo:agentConnector`
  (a remote agent on your own infrastructure). The Best Agents bonus does not
  require assignability — the `rovo:agent` module alone qualifies. FixPilot works
  through Rovo Chat in the context of the open issue (`@FixPilot`).
- **Rovo needs a paid plan.** Rovo is only available on Standard / Premium /
  Enterprise Jira Cloud sites. A free site does not have Rovo; a Standard or
  Premium trial includes it.
- **Write actions need confirmation twice over:** the agent prompt forbids writing
  before the user confirms, and Rovo's own review card gates every write action.
- **Known Forge quirk (FRGE-1601):** action verbs other than GET are not always
  reliably invoked. Read actions use GET with optional inputs. The two write
  actions use UPDATE/CREATE and must be verified on the dev site; if either
  does not fire, flip it to GET with a separate confirmation step.
- **Different from ReadyGate (another Codegeist 2026 entry):** ReadyGate scores
  issue *readiness* against a Definition of Ready. FixPilot does *bug triage*:
  repro extraction, root-cause ranking, fix-plan drafting, and a Confluence
  runbook. Different problem, analysis, and output.

## Developer setup

```bash
npm install
npm test            # Jest — pure triage logic
forge lint          # validate manifest + code
forge deploy        # deploy to development
forge install       # install on your dev site
forge deploy -e production   # production deploy for the installation link
```

The `app.id` in `manifest.yml` is a placeholder UUID. After `forge login`,
run `forge register` to replace it with the real app ID before deploying.

## License

MIT — see [LICENSE](LICENSE).
