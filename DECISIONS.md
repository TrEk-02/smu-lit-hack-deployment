# DECISIONS.md
Last updated: 1400HR by Tung Geng Hong
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

**Sprint 3**: Clean-up & polish

**Epic 3 (claim artifact / handoff brief) is abandoned.** Decided 2026-09-06:
the MVP is stronger polished than broadened. Two consequences to own:
- §Challenge round says rejected corrections "carry the disagreement into the
  handoff brief". With no brief, **"Where we still disagree" on the review page
  becomes the terminal artifact** — it has to stand on its own, not read as a
  stub for something later.
- The challenge statement's *Escalation* requirement asks each build to produce
  "a handoff brief… the issue, the relevant documents and clauses, what the tool
  already established, and the specific question that needs human judgement".
  Our disagreements + escalated findings already contain all four. Reframing that
  one section as the handoff (rather than building Epic 3) is ~20 min and keeps
  the requirement answered. **Recommended; not yet decided.**

Ordered by priority. F1 is the only one that is currently breaking the demo.

---

### F1. Ship the OpenRouter key to Vercel  ⚠️ demo-breaking (COMPLETE)

The deployed app has no `OPENROUTER_API_KEY` — `.env` is gitignored and never
left the laptop — so `isStubbed()` is true and **every deployed run serves the
demo fixture**. This is the root cause of the "[demo fixture]" confusion, and
almost certainly of "only one contradiction per document" and "the questions
seem arbitrary" as well (the stub emits exactly one finding and hard-picks
`briefs[0]`/`briefs[1]` with no ranking at all).

- Set as a plain server-side var (never `NEXT_PUBLIC_`), Production **and**
  Preview, then redeploy — Vercel only reads env changes on a new build.
- Set a spend cap at OpenRouter: Preview URLs are public, and $15 is drainable.
- Re-test 4 and 7 against the live model before designing around them.

### F2. Fix legal's broken question wording  ⚠️ visibly wrong on screen

Four gates pair an open "what/how" question with a yes-no or "Yes — …" input
(`boc_subject_matter`, `boc_delivery_date`, `boc_quantity`,
`boc_claimant_preconditions`), and **`boc_price_agreed` is polarity-inverted** —
"Were there *any changes* to the price?" still PASSes on `true`. Legal fixes the
wording or the answer type; dev does not guess. Also still open:
`boc_payment_due`'s evidence block is dev-authored and needs legal sign-off.

### F3. Challenge round — make the point visible (COMPLETED)

The ranking is a documented five-tier order, but the user never sees it, so it
reads as arbitrary. Two changes, both cheap, both aimed at "what is the point if
they can just double down":

- **Say why we're asking**, per question: *"because your document appears to
  disagree with what you told us"* vs *"because you left this blank"*.
- **Stop mixing two products.** Contradictions and missing-answer follow-ups
  currently arrive looking identical, which dilutes both. Split the round:
  *"XX things don't match what you told us"* then *"YY things we still need"*.
- Same split on the evidence page: contradictions expanded, corroborations
  collapsed under "N things your document backs up".
- Stress-test the user journey end to end, including a claimant who rejects
  everything — the round must still terminate and still produce a usable
  disagreement record.

**[x] Done (2026-09-06).** The round now counts within its group, not across
both: "THINGS THAT DON'T MATCH · 1 OF 1" then "THINGS WE STILL NEED · 1 OF 4".
Each question states why it was asked — the queue was always ranked, but none of
that was visible, which is what made it read as arbitrary. Copy per kind lives in
`whyAsking()` in `challenge-panel.tsx`; the grouping predicate is `isMismatch()`
in `challenge.ts` so the UI cannot drift from the ranking. Evidence page:
contradictions expanded, corroborations collapsed behind "N things your documents
back up". Reject-everything walked end to end — terminates, and the disagreement
record survives with its quote and document name.

### F4. Demo fixtures — Scenario A and Scenario B (COMPLETED)

- Live in **`src/config/scenarios.json`, not `rules.json`** — rules.json is
  validated at import and throws, so a typo in demo data would take down the
  whole app.
- Auto-fill button at the foot of the category page, filling general + category
  + party **inputs only**. Verdict and LLM findings still compute live: if a
  judge suspects canned findings, the pitch is over.
- Legal authors **dummy documents** per scenario for the LLM to ingest,
  separately from the answer fixtures.
- One test per scenario asserting its expected verdict, so a rules.json edit
  can't silently kill the demo overnight.
- Scenario B must turn on `boc_consideration` or `boc_proof_of_agreement` — the
  only published gates that are both checkable and FAIL-severity. The
  `claimAmount` lever does **not** work (see F5).

**Fixture shortcuts implemented 2026-09-06:** `src/config/scenarios.json`
holds editable Scenario A and Scenario B answer data transcribed from Book1.xlsx.
The buttons at the bottom of the breach-of-contract category form populate
general, category and party answers only; the normal "Check eligibility" action
still calculates the verdict. F5 fields absent from the spreadsheet are explicit
demo assumptions: adult claimant, Singapore respondent, not bankrupt/insolvent,
and no existing proceedings. Both scenarios initially pass current rules,
enforced by `src/lib/scenarios.test.ts`. Scenario B's separate document-driven
PASS-to-FAIL demonstration remains to be finalised with legal.

### F5. General eligibility gates — five additions (COMPLETED)

All fit the existing schema; no new gate types. Legal authors, dev publishes.

| Gate | Severity | Note |
|---|---|---|
| Claim $20k–$30k needs both parties' written consent | CONDITIONAL | **Already drafted** as `gen_claim_amount_consent` — publish, don't build |
| Claimant is 18+, or has a litigation representative | CONDITIONAL | Ask as a boolean — avoids adding a `date` answerType |
| Respondent is in Singapore | FAIL | legal to confirm |
| Respondent is bankrupt | CONDITIONAL | Decided 2026-09-06. Note the semantic stretch: CONDITIONAL means "proceed if a condition is met", but bankruptcy means "you may file and it will likely be pointless". Accepted as the closest fit rather than adding a severity |
| Existing/concurrent proceedings on the same claim elsewhere | FAIL | legal to confirm |

Watch the side effect: 2 gates → 7 gates means more ways to land INCOMPLETE,
since any unanswered FAIL/CONDITIONAL gate blocks. Decide per gate whether it
truly blocks.

**Also add `evidence` blocks to the general gates.** They are all
`checkable: false` by omission today, so no document is ever checked against
them — which is why a document showing a figure over S$30,000 cannot flip the
verdict.

#### F5 implementation — Ding Jie's clarified requirements (2026-09-06)

Implemented the supplied requirements across the general form, evaluator,
evidence scope and review. These replace the earlier age severity and the
"publish, don't build" instruction for the drafted amount-consent gate.

- Above S$20,000 and up to S$30,000: ask whether both parties signed the
  memorandum of understanding. Yes passes, No is CONDITIONAL, unanswered is
  INCOMPLETE. The question does not apply at S$20,000 or above S$30,000;
  amounts above S$30,000 still FAIL the existing cap.
- Ask whether the claimant is **18 or older** (18 is included). This is an
  answered-age selector, with both Yes and No accepted. Under 18 reveals a
  parent/guardian representation gate: Yes passes, No FAILs, unknown blocks.
- Respondent outside Singapore: FAIL.
- Respondent bankrupt or insolvent: CONDITIONAL, showing exactly:
  "You need to obtain permission from the Official Assignee to file the claim /
  Official Receiver or Liquidator to file the claim (Corporate Entity)."
  Permission status is not collected in this increment.
- Claimant has already started court proceedings about the same dispute or
  claim: FAIL.

There are eight published general gate records, including the age selector
and its conditional representation check. `appliesWhen` is shared by frontend
visibility and server evaluation/evidence/challenge scoping. Its prerequisites
must be unconditional published questions in the same phase; hidden answers
are ignored. Boolean list membership supports the age selector without
treating being under 18 itself as a failure. `passExplanation` avoids showing
failure/permission instructions on a passing general gate.

The party screen re-evaluates edited amounts and returns to general questions
when the memorandum answer is needed. Review uses the most restrictive phase
status so a category PASS does not hide a general condition. Challenge writes
wait for re-evaluation and surface failures; newly required questions can be
answered through Edit answers on review.

Every general gate now has an explicit evidence block. Amount, memorandum,
representation, respondent location, insolvency and proceedings can be checked
against explicit document statements. Age and limitation remain uncheckable:
date calculation/identity verification and legal accrual assessment are not
implemented. Document silence is not evidence of a negative answer; an invoice
total alone is not the claim amount. These new evidence expectations are
developer-authored and need legal review. New source labels identify the
project team's F5 requirements; no unverified statutory citations were invented.
Legal still needs to confirm terminology, references and evidence wording.

F5 boundary/branch regression tests live in `src/lib/evaluate.test.ts`.
The npm test glob uses double quotes so Windows runs the tests instead of
silently discovering zero. Validation: 33 unit tests, production build, API
requests covering the branches, and a headless browser walkthrough of minor
representation, memorandum boundaries, party amount edits and insolvency copy.
Evidence API validation used the labelled stub, not a paid live model call.

### F6. Review page — readable labels and colour (COMPLETED)

- `GateResult` carries `question` from the server. The client has no rules
  access, so any client-side gateId→question map is a second source of truth.
- Colour per outcome, **per gate only — never aggregated into a score.** Six
  ambers must not start reading as "60% likely to lose"; that is outcome
  prediction, which §8 forbids.

| Outcome | Colour | Reads as |
|---|---|---|
| PASS | green | clear |
| CONDITIONAL | amber | can proceed if a condition is met |
| WEAKNESS | amber-neutral | this part is thin |
| MISSING | grey | not answered — explicitly **not** a mark against you |
| FAIL | red | hard stop |

Colour never carries meaning alone — every state keeps its text label.

**Implemented 2026-09-06:** `GateResult` now carries the rule-authored
`question`, and the review cards and "More information needed" display it rather
than internal answer keys such as `claimAmount` or `respondentInSingapore`.
Per-gate outcome colours use the agreed PASS/CONDITIONAL/WEAKNESS/MISSING/FAIL
palette with an explicit text label. Form submit controls and field-local
actions receive spacing from the preceding input.

### F7. Multiple documents — up to five (COMPLETED)

- UI states the limit explicitly ("up to 5 files").
- `docId` flows through the finding and the quote verifier, which currently
  takes a flat page list. Already anticipated in §Challenge round ("quote,
  docId, page").
- Cap the **bundle**, not the file: `MAX_CHARS` is 200k per document today, so
  five documents is 1M characters of prompt.

**[x] Done (2026-09-06).** `MAX_DOCS = 5`, enforced server-side and stated in the
UI ("Upload up to 5 PDFs"); `capBundle()` trims to `MAX_BUNDLE_CHARS = 200_000`
across the whole bundle, in order, so an early document is never dropped for a
later one.

The model is **not** asked which document a quote came from — it cites a page,
and `locateQuote()` searches every document and returns `{docId, docName, page}`
from the actual match. Same principle as the page number: location is resolved by
matching, never claimed by the model, so a wrong attribution is impossible rather
than merely unlikely. Verified across a three-document bundle: findings resolved
correctly to quotation.pdf and receipt.pdf, zero drops.

### F8. Cleanup (COMPLETE)

- Delete `src/lib/mock-verdict.ts` — dead code, nothing imports it. **[x] Deleted.**
- Drop the inline `[demo fixture]` prefix from stub observations; keep the
  banner. Two signals reads as noise. **[x] Already done; only the banner remains.**
- Distinguish **"never configured"** (a setup error — say so before the user
  uploads anything) from **"the call failed"** (stub and label it, per §8).
  **[x] Partly, and deliberately.** No key is caught by `isStubbed()` before any
  call, so the claimant gets the labelled fixture and the banner — never an
  error. Everything that reaches `LlmUnavailableError` is therefore a *live*
  failure (timeout, unreachable, 401/402), and the 503 copy no longer asserts
  "not configured" for it. The cause is logged server-side; the claimant is told
  the check could not be reached and that their eligibility result is unaffected.
- Stale READMEs in `api/evaluate/` and `config/` describe field names that no
  longer exist. **[x] Both rewritten** against the code as it now stands.
  `config/README.md` now documents the `evidence` block and states what the
  model is and is not sent.

### F9. Handoff notes — the Escalation requirement (COMPLETE)

§Sprint 3 left this "Recommended; not yet decided". Decided and built
2026-09-06: **"Where we still disagree" is now the handoff brief**, renamed
"Handoff notes — for the person who helps you next". Epic 3 stays abandoned.

The challenge statement asks for four things; the section now carries all four:
the issue (the gate's question plus why it needs judgement), the documents
behind it (the verified quote, its document and page), what the tool already
established, and the disagreement stated as a decision for a human.

- **"What this tool established"** is counts of facts only — checks passed,
  conditions to meet, points unanswered, documents read, findings verified,
  findings discarded. Never a score. §8 forbids outcome prediction and F6
  forbids aggregating per-gate colour; a percentage here would breach both.
- **Copy and print.** A handoff nobody can hand off is not a handoff. `Copy
  these notes` serialises the section as plain text; `Print or save as PDF`
  uses a print stylesheet that drops the app chrome and keeps the record.
- **The clause per item was cut** from this increment (team call, T-2h). The
  gate's `source` is already on screen elsewhere on the review page.

### F10. Screenshots — WhatsApp threads as evidence (COMPLETE)

**Why it is not just another file type.** Quote verification works because a
PDF's text is extracted mechanically: the model cannot fake a quote into text
it did not write. A screenshot has no text layer, so the text must be
*produced*. Doing that in the findings call would make the check circular —
the model marking its own homework, while knowing exactly what the case needs.

**The duties are therefore split.** `transcribeImage()` is a separate call
given the image and nothing else: no gates, no answers, no claim. It
transcribes and stops. The existing findings call then runs over that
transcript as ordinary text, unchanged. Verification is still a check between
two things the same model did not both author.

This is **weaker than a text-layer PDF and the UI says so.** The transcript is
shown to the claimant before it is used ("check this"), because a transcript is
a reading, not an extraction, and a misreading carries through. Screenshots are
also trivially fabricated; the tool cannot authenticate one, so an
image-derived quote is labelled "read from a screenshot, not authenticated"
wherever it appears, including in the handoff notes.

**Image-only PDFs are the real case.** The team's actual test data is not PNGs
— it is `scenario_A_whatsapp.pdf` / `scenario_B_whatsapp.pdf`, each a
single-page PDF holding one JPEG and zero fonts. That is what you get when a
chat thread is printed or exported, and it is how a WhatsApp thread will
usually arrive. So `extractFromPdf` no longer refuses a PDF with no text layer:
it falls back to the same transcription path. **The text layer is still
preferred wherever it exists** — mechanical, free, and a stronger guarantee
than a reading.

The PDF goes to the model natively as a `file` content part rather than being
rasterised or having its bitmap dug out: no PDF parsing, no rasteriser on
Vercel, and multi-page falls out for free. Capped at `MAX_TRANSCRIBE_PAGES`
(10) and 6MB, because each page is billed as an image and a 40-page scan is a
bill arriving quietly.

*Bug found by testing, not by reading*: pdf.js **detaches the buffer it is
handed**, so after `getDocumentProxy(bytes)` the original array is empty and
base64-encodes to `""` — the transcription call then failed with "Invalid
base64 data URL". `getDocumentProxy` now gets a copy so `bytes` survives for
the fallback. Nothing in the type system would have caught this.

**Implementation**: `origin: "pdf" | "text" | "image"` is set at ingest and
travels through `SourceDoc` → `QuoteLocation` → the finding → the challenge
question → the disagreement, so no surface can accidentally show a transcript
as a document. PNG/JPEG/WebP, 6MB per image (lower than the 10MB PDF cap —
base64 inflates the body ~1.33x and vision tokens are billed by area).
`MAX_DOCS` is unchanged, so five screenshots is already the limit.

*An unreadable image is refused, not passed through.* The transcription prompt
asks for `[unreadable]` rather than a guess, so "nothing was read" arrives as
markers rather than an empty string; `hasReadableText()` catches both. Without
it a blank transcript would reach the verifier, match no quote, and read to the
claimant as "your document showed nothing" when the truth is "we could not read
your document". Pure, and split into `lib/transcript.ts` so it is testable
without a network — same reason `verify.ts` is separate.

**Verified live against the team's own test PDFs (2026-09-06)**, not stubbed.
Both `scenario_A_whatsapp.pdf` and `scenario_B_whatsapp.pdf` transcribe
verbatim — dates, timestamps, per-message sender attribution, Singlish and
emoji all intact — and run the full pipeline with **zero dropped findings**:

- **Scenario A**: 3 findings, all CORROBORATES (`boc_payment_due`,
  `boc_notice_given`, `boc_subject_matter`). Correct for a sound claim.
- **Scenario B**: 5 findings, 2 of them CONTRADICTS
  (`gen_claim_amount_max`, `boc_quality`), and a 5-question challenge round.

43 unit tests pass, including four pinning that a fabricated quote is still
dropped when the source is a transcript.

**Verdict flips from a WhatsApp PDF: supported, and proven.** Nothing needed
building — the six published gates that are `FAIL` severity *and* checkable
*and* correctable are `gen_claim_amount_max`, `gen_minor_representation`,
`gen_respondent_in_singapore`, `gen_existing_proceedings`,
`boc_proof_of_agreement` and `boc_consideration`. Any of them flips the verdict
when a document contradicts it and the claimant confirms the correction. The
transcript is ordinary text by that point, so its being a screenshot changes
nothing.

What Scenario B lacks is **content**, not capability: its thread contains no
fact that contradicts any of those six. Verified by appending one line to the
transcript — *"I already filed the case at the Magistrate's Court last week"* —
which produced a CONTRADICTS on `gen_existing_proceedings` with a coercible
proposal of `true`, and confirming it took the general phase **PASS → FAIL**,
end to end from the PDF. Legal adds one line of that shape to the artwork and
the climax runs off the real export. `gen_respondent_in_singapore` ("we've
moved operations to KL") works the same way and is equally natural to the story.

### Ingest latency — "it feels like it hangs" (2026-09-06)

Measured before changing anything: **~8.3s** to read one image-only PDF, and
**~17.7s** for the evidence check. So the claimant waits ~26s across two steps.
Two causes, only one of them the algorithm.

**1. Files were read one after another.** `for (const file of files) { await … }`
meant five screenshots cost 5 × 8s ≈ 40s. They are independent, so they now go
through `Promise.all` — which also preserves input order, and `capBundle`
depends on that order. Measured: two PDFs went **16s → 8.3s**, the same as one.
Type validation moved ahead of the reads, so an unreadable fifth file no longer
costs four paid transcriptions before it is rejected.

**2. Nothing on screen said anything.** `reading` only disabled the file input
and relabelled the *paste* button, so uploading a PDF changed nothing visible
for eight seconds. Silence during a slow step reads as a crash, and a claimant
who reloads pays for the work twice. Both slow steps now show a status block
(`role="status"`, `aria-live="polite"`) naming the files, explaining that a
picture has to have its words read off the page, and saying they are read at
the same time rather than in turn. This was the larger half of "it hangs".

**Rejected: `reasoning: {effort: "low"}` on transcription.** The findings call
uses it, so it looked like free speed. Measured: **8.28s vs 8.14s — nothing.**
This call is output-token-bound, not thinking-bound (29 reasoning tokens against
a ~550-token transcript). It also appeared to cost fidelity: the sender came
back as "Jasmine" rather than "Jasmine (Huat Huat Huat)", and who the respondent
is matters. Reverted, and the reason left in the code so it is not re-attempted.

**What is left, and why it is not being touched at T-1h.** The remaining ~8.3s
is the transcript itself — the model writing out ~550 tokens, which is the
product. The 17.7s check is prompt-size-bound: 22 checkable gates plus the
document. Fewer, better-targeted `checkable` gates would shorten it (§Evidence
planned ~6, legal published 22), but that is a `rules.json` change needing
re-testing, not a submission-eve edit.

### Run-to-run variance — measured, not guessed (2026-09-06)

Four identical `/api/evidence` calls on `scenario_B_whatsapp.pdf`, same model,
no sampling parameters available to pin (Sonnet 5 rejects `temperature`):

| | run 1 | run 2 | run 3 | run 4 |
|---|---|---|---|---|
| findings | 3 | 4 | 4 | 4 |
| dropped | 0 | 0 | 0 | 0 |
| contradictions | 1 | 2 | 2 | 4 |

Nine distinct gates appeared across the four runs; only one appeared in all
four. **Set stability 1/9 = 11%.**

**But the headline is stable and the tail is not**, which is the distinction
that matters. `gen_claim_amount_max` came back CONTRADICTS in **4/4 runs with
the same substance** every time: the claimant says she is claiming $1,500, and
the thread indicates the $1,500 was the half already paid to her, with the
dispute actually about the unpaid remainder. That is a correct, non-obvious
challenge to the claimant's own framing — precisely what §2 exists to do. What
varies is the supporting cast of WEAKNESS-gate findings beneath it.

Nothing observed in any run was *wrong*. The variance is in which true
observations get surfaced, not in their correctness, and every run produced at
least one contradiction with the same headline.

**Prompt fix attempted and rejected.** Replacing "Report at most N findings"
with an explicit instruction to work through every item and prefer completeness
over brevity made it **worse**: the candidate pool grew 9 → 13, and
`gen_claim_amount_max` fell from 4/4 to 1/4, with one run surfacing no
contradiction at all. Reverted. Recorded so nobody retries it.

**Consequences owned:**
- Do not script the demo to a named finding. "It found N things that do not
  match" and then read what is on screen. The headline challenge is reliable;
  the specific list is not.
- The deterministic layers are unaffected and this is what the pitch rests on:
  `evaluate()`, quote verification, coercion, ranking and gate selection are
  all code. **0 dropped in 8 of 8 runs.**
- The real fix is not a prompt: run the findings call more than once and union
  the verified results, trading latency and spend for coverage. Post-hackathon
  — it doubles the ~10s call and was not attempted at T-1h.

*Diagnostics added*: the evidence route now warns when a proposal is dropped
because it would not coerce, so "no correction was offered" can be told apart
from "we rejected what the model proposed". On these threads it was always the
former — the model declining, never a coercion failure.

**Superseded — Scenario B's contradictions carry no proposed answer.**
Both came back with `proposedAnswer: null`, so the round asks the question but
cannot offer the one-click "Yes — use my document" correction, and nothing
flips the verdict on its own. That is the model declining to put a number on
"how much are you claiming" from a thread where the only figure is the 1.5k the
other side says it will not ask back — defensible behaviour, not a bug. But it
means **the PASS → FAIL climax does not currently fire from these PDFs alone.**
The verified flip is on `boc_consideration` (see F5 correction above). Either
rehearse the flip through the pre-loaded fixture as before, or have legal add a
line to Scenario B's thread that speaks directly to a FAIL-severity checkable
gate. Decide before the run-through, not on stage.

**Known limit, worth saying before a judge asks**: sender attribution depends
on bubble alignment, and "You" in a WhatsApp export is the phone's owner — the
tool cannot verify that is the claimant.

## 4. Scope + cut-line — CUT (2026-09-06)

Never filled in, and by submission there is nothing left to cut. The priority
order that would have lived here is the F1–F8 list above; the cut decisions
actually taken are recorded where they were made (Epic 3 abandoned in §Sprint 3;
"drop the challenge round" in §Evidence). Section numbers below are unchanged —
they are referenced throughout this file and in code comments.

## 5. Ground rules of law (source of truth — cite in-app)
Small Claims Tribunals Act 1984, Schedule; State Courts / ask.gov.sg guidance.
Any rule change goes in this file AND in `rules.json`.

## 6. Eligibility logic lives in ONE place
`/config/rules.json` — written by legal, imported by code. Not a Google Doc.
Anyone editing it announces it in the team channel.
- Actual location: `web/src/config/rules.json` — 8 published general gates,
  23 breach-of-contract gates, and the party/filing intake fields.
- Draft or incomplete gates must not produce an eligibility verdict. Enforced:
  only `status: "published"` gates are evaluated, and `RulesFileSchema` throws at
  import — naming the offending gate id — rather than failing at runtime.
- See `web/src/config/README.md` for the field-by-field authoring reference.

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


