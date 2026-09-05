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
"Are my assumptions about my case accurate, and is the case actually as strong as I think?"

*User Stories*
- As a claimant, I want to state who I am and who I'm claiming against, so I'm told upfront if my filing route is wrong.
- As a claimant, I want to upload my documents and see which parts of my claim they actually support.
- As a claimant, I want to be told when my own documents contradict what I said.
- As a claimant, I want the tool to push back on the weakest parts of my case and make me answer for it.
- As a claimant, I want each element of my claim marked established / weak / missing, each with a reason and a source.
- As a claimant, I want to be told when the tool can't assess something.

*Features:*
- Structured LLM contract: 
The app calls a LLM model via an OpenRouter API Key;the LLM's output schema should be derived from rules.json at import time, so the model's reference space is a closed set of gate ids that already exist. It cannot invent a legal issue because it has no field in which to express one.

- Quote verification by exact substring match:
Every LLM output item should carry a verbatim quote; server checks it appears in the extracted document text; if not, the item is dropped before it reaches the user. Twenty lines of code, kills fabricated citations empirically rather than by prompt-begging. 

- Deterministic contradictions where the data is structured: Claimed amount vs invoice amount, breach date vs limitation window, tenancy duration vs 2-year cap — these are code, not LLM. Reliability ~100%.

- Document ingestion: text-layer PDFs and pasted text only

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

What was completed:
The Engine (src/lib/) — built, tested, working
- types.ts — one flat Answers record (no hand-maintained per-category types), a Gate schema matching legal's authoring template (id, status: draft|published, field, answerType: boolean|number|select|date, operator, value, onFail: FAIL|CONDITIONAL|WEAKNESS, source), and RulesFileSchema with cross-checks (no duplicate gate ids, category gates reference declared categories, shared fields can't disagree on type).
- evaluate.ts — a generic interpreter (9 operators including withinDays for limitation periods) rather than hand-written per-gate logic. Two-phase: evaluateGeneral always runs; evaluateCategory only if general isn't FAIL/INCOMPLETE. MISSING (unanswered or wrong type) never silently passes — it produces INCOMPLETE, not a false clearance.
- rules.ts — validates rules.json once at import (throws with the specific gate id if malformed), derives supportedCategories() from what's actually published rather than a hardcoded list.
- config/rules.json — 1 category (BREACH_OF_CONTRACT), 3 general gates, 23 category gates transcribed from the team's criteria table with severity assigned per row.

The APIs (app/api/) — built, tested, working
- GET /api/config — categories + general questions, ready flag.
- GET /api/config/[categoryId] — category questions, 404 for unsupported categories.
- POST /api/evaluate — one endpoint, both phases, a nextStep field so the frontend doesn't re-derive routing logic, 503 (not 500) when rules aren't published yet.

**Sprint 2**: 2 hours, building the features for Epic 2

### Feature: Party & filing details (Story 1)

**Why**: Unlocks representation requirements. Also gives the LLM a party frame so it can tell "what I paid"
from "what they invoiced" when reading a document.

**Fields** (another page, if Sprint 1 form passes): should adhere to Sprint 2's set questions provided in the Project memory 
- if unable to be found, please surface

**Rules**: Introduce new gate types when required, schema can be added on to

**Build**: ~15 min. Form fields + wiring into `answers{}`. 

**Success**: a respondent's information is recorded — [x] done

**What was built**: fields Q4/Q4Bi/Q4Bii/Q5/Q6 from legal's question set, as a
new `partyFields` array in rules.json — deliberately *not* gates (no
operator/onFail/source), because these are intake, not eligibility checks.
New `text` answerType; new `dependsOn` for the Q4B conditional. Q7 re-renders
the existing `claimAmount` question rather than duplicating the field. Q8
computes the filing fee from the official schedule (`lib/filing-fee.ts`:
≤$5k $10/$50, ≤$10k $20/$100, ≤$30k 1%/3% — individual/entity), which is why
Q4 has to be answered before the fee can show.

### Feature: Evidence layer (document-vs-answer checking)
**Why**: Sprint 1 verdicts are self-report. `evaluate()` is deterministic about the
rule, not the fact — a PASS only means the user's answer satisfied the operator.
A claimant who is confidently wrong hides in the PASS set. So the LLM must see
passed gates too, filtered by *verifiability*, not by severity.

**Division of labour** (this is the answer to the technical-feasibility Q&A):
- Legal content lives in `rules.json`. The model never sees `source` or
  `explanation` — it cannot paraphrase, mangle, or invent a provision.
- The LLM does three jurisdiction-free jobs: extract facts from a document,
  compare them to what the user typed, phrase the mismatch in plain English.
- Citations are **looked up by gateId after validation, never generated**.
- The model proposes a fact; the user confirms; `evaluate()` re-decides.
  The model never touches the verdict.

**Rules authoring** — new `evidence` block on every gate:
- `checkable: false` → requires `reason` (why no document could speak to it)
- `checkable: true`  → requires `expect` (what a document would have to show —
  this is the field that drives finding quality), `docTypes`, `correctable`,
  and `onContradiction: CORRECT | ESCALATE`
- `correctable: false` + `ESCALATE` → contradiction goes to the handoff brief
  instead of flipping an answer. Used where the inference is a judgement call
  (see `boc.payment.price_variation` — §7 Scenario B). Consistent with §8:
  the tool will not characterise the claim.
- Default the whole file to `checkable: false`. Legal promotes only the gates
  Scenario B needs plus 2–3 for texture. ~6 good `expect` strings beat 26 thin
  ones; budget ~30 min, not 15.

**File changes**:
- `types.ts` — add `DocType` enum (shared with the ingest route, do not
  redeclare there). Add `Evidence` as a discriminated union on `checkable`, so
  a gate cannot be half-filled. Extend `GateSchema`. Add cross-check to
  `RulesFileSchema`: reject `correctable: true` + `onContradiction: ESCALATE`.
  Stays pure — no knowledge that `rules.json` exists.
- `rules.ts` — add `checkableGates()`, same pattern as `supportedCategories()`.
  Replaces the earlier severity filter.
- `llm/schema.ts` (new) — `GateId` (`z.enum` derived from published gate ids),
  `Finding`, `LlmOutput`. Lives here, not `types.ts`: it depends on
  `publishedGates()`, and `types.ts ← rules.ts` means putting it there is a
  cycle. It is an LLM-boundary constraint, not a domain type.

Dependency direction: `types.ts ← rules.ts ← { evaluate.ts, llm/schema.ts }`

**Prompt payload**: `{ id, question, userAnswer, expect }` per checkable gate.
Nothing else. Findings capped at 8, contradictions-on-passed-gates ranked first.

**Server-side, after the call**:
1. Zod parse (`LlmOutput`)
2. Quote verification — normalised substring match against extracted page text;
   unmatched findings dropped. **Log the drop count — state it to judges.**
3. Coerce `proposedAnswer` to the gate's `answerType`; reject if it won't coerce
4. Join `source` + `explanation` back in by `gateId`
5. Route by `onContradiction`

**Persistence: none.** §12 stands — React state + `sessionStorage` mirror.
Vercel functions have no persistent filesystem; storing uploads means blob
storage + DB + env vars, 40+ min and three new live failure modes. Ingest
extracts text and discards the bytes; only text crosses the wire.
Mitigation: "Load Scenario B" button hydrates full state from a fixture —
also makes rehearsals and the backup recording repeatable, and skips
`pdf-parse` if it chokes on stage.

**Provenance badge per gate** (free once passed gates are in scope):
Asserted / Corroborated / Contradicted. This is the honesty axis as UI rather
than as a slide claim.

**Success criteria**:
- [x] One contradiction surfaced from an uploaded document, page-anchored quote,
      zero LLM legal claims in output
- [x] Quote verification demonstrably rejects a fabricated citation in a test
- [ ] Confirmed correction merges into `answers{}` and re-runs `evaluate()`
      — deferred to the challenge round (Feature 3); this feature surfaces
      findings, it does not take an answer back
- [x] One visible refusal path — three: 503 not configured, 502 unverifiable
      output, and an explicit "nothing we could verify" instead of silence
- [x] Whole flow renders with the LLM call stubbed
- [x] Scenario B end-to-end in under 90s — the model call is ~10s

**What was built** (2026-09-05):

*Model*: `anthropic/claude-sonnet-5` via OpenRouter, `OPENROUTER_MODEL`-overridable.
Chosen over Sonnet 4.6 because it is both newer and cheaper ($2/$10 vs $3/$15 per
1M). Two live-verified constraints: it **rejects `temperature`/`top_p`** (sampling
params removed on Sonnet 5), and default reasoning effort took ~30s, so we send
`reasoning: {effort: "low"}` — ~10s, and it actually found *more*. ~$0.02/call.

*Legal's evidence blocks* arrived as a PDF, not a rules.json edit, and were not
valid JSON (blocks outside their gate objects, curly quotes, a stray `]`).
Transcribed gate-by-gate into 22 gates. Three deviations from the plan above:
- **`onContradiction` was omitted on every block.** Legal marked all of them
  `correctable: true`, and ESCALATE requires `correctable: false`, so CORRECT is
  the only consistent value — the field now defaults to it. The cross-check
  rejecting `correctable: true` + ESCALATE still stands.
- **`docTypes` is free text, not the planned `DocType` enum.** Legal authored
  descriptions ("Value in dollar", "Number of items"), not document formats. An
  enum would have rejected their content; ingest never needed it.
- **Everything is `checkable: true`** (plan said default false, promote ~6). Kept
  as authored; the cap of 8 plus contradictions-first ranking absorbs the noise.

*Payment trio, re-anchored — legal to confirm*: the `expect` strings were attached
one gate late. The block on `boc_payment_evidence` described *form of payment*
(that is `boc_payment_form`, which had none) and the block on `boc_payment_due`
described *proof of transfer* (that is `boc_payment_evidence`). Two of the three
are published, and `expect` drives finding quality, so leaving it would have aimed
the model at the wrong thing on live gates. Both moved; **`boc_payment_due`'s block
is newly authored by dev and needs legal sign-off.**

*Question wording NOT applied*: legal's PDF also rewrites `question`/`missingMessage`
on ~15 gates. Several break the question against its own answer type
(`boc_subject_matter`, `boc_delivery_date`, `boc_quantity`,
`boc_claimant_preconditions` pair an open "what/how" question with yes-no or
"Yes — …" options), and **`boc_price_agreed` inverts polarity** — "Were there *any
changes* to the price?" still PASSes on `true`. Sprint 1 wording stands until legal
fixes these.

*Stub-on-no-key*: with no API key the pipeline returns a fixture rather than an
error, quoting the real document so verification still runs honestly. The UI
labels it "Demo fixture — pre-recorded, not a live assessment", per §8.

**Cut order if the LLM slips at 90 min**: drop the challenge round (2.4), keep
upload (2.2) + discrepancy detection (2.3). Discrepancy detection alone carries
the pitch.

### Feature: Challenge round (Story 4)

**Why**: This is the feature. MinLaw's stated problem is that SRPs turn to
generic GenAI and get their assumptions reinforced. Without a loop that takes
an answer back, a contradiction on a PASS gate is a red box that changes
nothing, and the passed-gates design buys us nothing. §2: the tool disagrees
with the user when the user is wrong.

**Not a chat box.** Bounded, gate-anchored, finite. A free-text chat rebuilds
the problem we claim to solve.

**Question sources**, ranked in this order, capped at 5:
1. Contradiction on a **passed** gate with `correctable: true` — confirm/reject
   the `proposedAnswer`
2. Contradiction on a **passed** gate with `onContradiction: ESCALATE` — no
   correction offered; goes to the handoff brief
3. `unclear[]` from the LLM
4. Gates returning WEAKNESS or INCOMPLETE — question comes from the
   `if unknown` column legal already authored

**Loop**:
render question (+ quote, docId, page where a document drove it)
→ user confirms / rejects / says "I don't know"
→ confirmed corrections coerced to answerType, merged into answers{}
→ re-run evaluate()
→ verdict + provenance badges re-render

**Non-negotiables**:
- The user always has the last word on facts about their own life. Reject is
  always available and always ends that question.
- Copy is "this doesn't look like it matches — is this right?", never an
  accusation. False positives are most likely exactly where users are most
  confident.
- "I don't know" is a valid answer → gate stays INCOMPLETE, no forced guess.
- Every document-driven question shows its verified quote. No quote, no
  question — it was dropped at verification.
- The model proposes; the engine decides. No LLM output writes a verdict.
- §8 holds: no outcome or quantum prediction anywhere in this loop.

**Rejected corrections**: keep the user's original answer, mark the gate
`Contradicted` in the provenance badge, and carry the disagreement into the
handoff brief. We do not silently drop a verified contradiction because the
user said no — a real person should see both.

**Build**: ~35 min. Question ranker, one question component, merge +
re-evaluate. Reuses the Sprint 1 form controls per `answerType`.

**Success**:
- [x] A confirmed correction visibly changes the eligibility verdict on screen
- [x] Rejecting a correction leaves the answer intact and the badge Contradicted
- [x] Round terminates in ≤5 questions with no dead end
- [x] Every document-driven question shows a verified quote
- [x] Works with the LLM stubbed — WEAKNESS/INCOMPLETE questions come from
      `rules.json` alone, so the round is never empty

**What was built** (2026-09-05):

Queue built **once** by `/api/challenge` and then walked — not re-derived
between answers, which is what makes "terminates in ≤5" provable rather than
hopeful. Server-side because `missingMessage` (legal's "if unknown" question)
only reaches the client on a MISSING result, not a WEAKNESS one; `evaluate.ts`
is untouched.

*Ranking*, as specified, plus one addition: a contradiction on a gate that did
**not** pass ranks third (after the two passed-gate sources, before `unclear`).
Dropping a verified contradiction just because its gate already failed would
contradict the same principle that keeps rejected corrections in the handoff.

*Two gaps Feature 2 left, now closed*: the `provenance` map was computed but
never rendered — it now appears on review as "You said so / Backed by your
document / Your document disagrees"; and findings were trapped in
`EvidencePanel` local state, now lifted to `page.tsx`.

### Prompt payload change — `answerFormat` added

§Evidence said the payload is `{ id, question, userAnswer, expect }` and nothing
else. It now also carries **`answerFormat`** — "exactly true or false", "a
number", or the list of select values with their labels.

Why: without it the model could not tell whether an item wanted Yes/No, a
number, or one of a fixed list, so it returned `proposedAnswer: null` on *every*
finding. Measured, not guessed — before the change, zero of three contradictions
carried a usable proposal, so the one-click "Yes — use my document" correction
never appeared and the claimant had to retype every answer. After, all three did.

This does not weaken the guarantee the original rule protects. `operator`,
`value`, `onFail`, `source` and `plainExplanation` are still withheld, so the
model still cannot see which answer passes, and still cannot invent a provision.
`answerFormat` is the same set of choices already on screen in the intake form.

### Correction for legal — the claimAmount lever does not work yet

An earlier note suggested Scenario B hinge on `claimAmount` crossing the
S$30,000 cap. **That will not fire.** Legal labelled only the *category* gates
with `evidence` blocks — both general gates (`gen_claim_amount_max`,
`gen_limitation_period`) are `checkable: false` by omission, so no document is
ever checked against them and no correction can be proposed for them.

Two ways to get the verdict-flip demo:
- add an `evidence` block to `gen_claim_amount_max` (then a document showing a
  figure over S$30,000 flips PASS → FAIL), or
- build Scenario B on **`boc_consideration`** or **`boc_proof_of_agreement`** —
  the only published gates that are both checkable and FAIL-severity. This is
  what the flip was verified against: a delivery note reading "supplied free of
  charge… no price was agreed" contradicts "a price was clearly agreed", and
  confirming it takes the claim PASS → FAIL mid-round.

**Sprint 3**: 1.5 hours, building the features for Epic 3

## 3c. Clean-up
1. Polish format 
2. Build fixture files for Scenario A and Scenario B (demo scenarios)

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
- **A — sound claim:** claimant's documents support their case and assumptions, which the LLM validates
- **B — flawed claim:** claimant is convinced they're right but the claim is wrong. The tool must contradict their framing, cite the provision, and redirect. **This is the demo climax.**

## 8. Tech stack
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


