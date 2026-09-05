# POST /api/evaluate

General eligibility endpoint only. Uses the existing provisional GeneralAnswers
schema; legal still needs to confirm the questions. No legal rules are invented here.

Send JSON directly (not wrapped in an `answers` property):

```json
{
  "claimAmount": 250,
  "respondentType": "business",
  "causeOfActionDate": "2026-08-01",
  "hasAttemptedMediation": false,
  "isRespondentInSingapore": true
}
```

- Amount must be a positive number, not a string.
- Respondent type: `individual`, `business`
- Date must be a valid ISO date (`YYYY-MM-DD`). This validates format, not legal accrual.
- Both yes/no answers must be booleans. Missing answers are rejected, not assumed false.
- `200`: GeneralVerdict (`overallStatus` and `gateResults`), validated before sending.
- `400 INVALID_JSON`: malformed JSON.
- `400 INVALID_ANSWERS`: invalid/missing fields; `issues` lists field paths and messages.
- `503 RULES_UNAVAILABLE`: rule configuration cannot load/validate (current draft state).
- `503 EVALUATOR_UNAVAILABLE`: evaluator still throws its placeholder error.
- `500`: unexpected evaluator failure or invalid verdict; no internal details exposed.

Frontend integration:

```ts
const response = await fetch("/api/evaluate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(answers),
});
const result = await response.json();
if (!response.ok) {
  // Show result.error and result.issues, preserving the user's answers.
  return;
}
// Render result.overallStatus and result.gateResults.
```

The current mock UI is unchanged. Dev A must align the rules JSON with RulesFileSchema
and implement evaluateGeneral before this endpoint can return a real verdict.
