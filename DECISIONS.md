# DECISIONS.md
Last updated: 1200HR by Tung Geng Hong
Rule: if a decision isn't in this file, it didn't happen. Update within the hour, not at end of day.

## 1. Track
**Problem Statement 4 — Ministry of Law (SRPs using GenAI for Small Claims Tribunal pre-filing).**
Committed. Not reopening.

Why: 2 legal + 2 tech team. Our legal members can encode actual SCT
procedure. Judged deliverable is a
guidance layer, not a model.


## 2. What we are building
A web app that guides an SRP through SCT pre-filing and **pushes back on them**.

Non-negotiable differentiator: the tool disagrees with the user when the user is
wrong. Confirmation-bias mitigation is named in the problem statement. If our demo
only shows a claimant who turns out to be right, we have not built what was asked.

## 3. Epics and User Stories:
**Epic 1 — Eligibility gate**
"Can my claim go to SCT at all?"
- As a claimant, I want to be told plainly that my claim can't proceed and why, so I don't waste the filing fee.
- As a claimant, I want to know when my claim can proceed but only if a condition is met, so I know what to do next.

**Epic 2 — Case interrogation**
"Is my case actually as strong as I think?"

**Epic 3 — Claim artifact**
"Give me an organised way I can act on to put together a claim."

## 3b. Sprints
**Sprint 1**: 1.5 hour, building the features for Epic 1
Tech:
- Zod schema for rules.json + Answers + Verdict types
- evaluate(answers): Verdict — a pure deterministic function. No LLM. Returns {status, failedGate, provision, plainExplanation}
- One form screen collecting all inputs (single page beats a multi-step wizard at this stage — wizard is polish)
- Verdict screen rendering status + failed gate + provision

Legal: 
- rules.json — all five gates, each with provision reference and one plain-English sentence
- The minimum question set needed to evaluate all five
- mock scenario to test against what is built 

**Sprint 2**: 2 hours, building the features for Epic 2

**Sprint 3**: 1.5 hours, building the features for Epic 3

## 4. Scope + cut-line
IN (MVP, in priority order):

CUT-LINE (decided in advance, executed at T-minus [x]): 

OUT: 

## 5. Ground rules of law (source of truth — cite in-app)
Small Claims Tribunals Act 1984, Schedule; State Courts / ask.gov.sg guidance.
Any rule change goes in this file AND in `rules.json`.

## 6. Eligibility logic lives in ONE place
`/config/rules.json` — written by legal, imported by code. Not a Google Doc.
Anyone editing it announces it in the team channel.
- Scaffold location: `web/config/rules.json` — five empty draft gates; legal details pending.
- Draft or incomplete gates must not produce an eligibility verdict. Data shape to be agreed with the Zod schema/evaluator owner.

## 7. Demo scenarios (2, chosen by failure mode not topic)
- **A — sound claim:** 
- **B — flawed claim:** claimant is convinced they're right but the claim is
  wrong. The tool must contradict their framing, cite the provision,
  and redirect. **This is the demo climax.**


## 8. Competence boundary (what the tool refuses to do)
Written by legal, enforced in code:
- Will not predict outcome or quantum
- Will not advise on claims outside SCT jurisdiction beyond "this is the wrong forum, here is the right one"
- Will not characterise the claim until the user has supplied evidence for it
- Escalation output: a structured summary a real person could act on

## 9. Definition of done (demo script)
The exact click-by-click sequence we will show in 4 minutes. Written before
building continues. If it isn't in the script, it isn't required to work.

## 10. Submission checklist (hard deadline 6 Sep, 12:00 — no late submissions)
- [ ] GitHub repo, source code pushed
- [ ] Slide deck uploaded via Notion
- [ ] AI tools used disclosed (rules require it) — [list]
- [ ] Sources/datasets cited
- [ ] Backup demo recording taken at feature freeze

## 11. Working agreement
- Joint scoping → 1.5h split sprints → rejoin and integrate
- Anyone bouncing ideas with their own AI account pastes this file in as context first
- Split: 1 tech on UI, 1 on rules/API; legal supplies rules, sources, and expected findings
- Agree on request/response shape before splitting work
- Feature freeze at 2200H. After freeze: bug fixes and pitch only.
- Final 2 hours: integration, demo rehearsals, backup recording

## 12. Tech stack
**Recommended for the 1-day MVP** (assuming React/TypeScript familiarity):
- Frontend: Next.js (App Router) + React + TypeScript
- Styling: Tailwind CSS + native form controls
- Backend: Next.js Route Handlers — one repo, one deployment
- Eligibility: TypeScript functions importing `/config/rules.json` — legal owns rules, code applies them
- GenAI: one hosted LLM API the team already has access to — choose after testing both demo scenarios
- Validation: Zod — validate inputs, model response structure, and source IDs on the server
- Sources: legal-reviewed excerpts + official URLs linked to rule IDs
- State: React state + synthetic demo fixtures — refresh resets the session
- Hosting: Vercel — deploy early; API keys stay server-side
- Checks: Vitest for eligibility rules + manual walkthroughs of both demos and missing-evidence cases

Ground rules:
- Flow: intake → validate → eligibility checks → AI explanation → cited result
- Missing facts trigger follow-up questions; do not assume eligibility
- AI explains findings and challenges unsupported claims; cannot override rules or section 7
- Render rule findings directly from code; valid AI response structure does not guarantee correctness
- API failure: show rule findings + templated next step. Label prerecorded AI output as a demo fixture


