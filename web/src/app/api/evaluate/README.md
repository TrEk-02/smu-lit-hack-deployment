# POST /api/evaluate

Both eligibility phases, one stateless endpoint. The UI calls it twice: once
with general answers alone, then again with the same general answers plus the
category step. No session, no database — refresh resets everything
(DECISIONS.md §12).

## Request

```json
{
  "generalAnswers": { "claimAmount": 3000, "withinTwoYears": true },
  "categoryId": "BREACH_OF_CONTRACT",
  "categoryAnswers": { "proofOfAgreement": "written" }
}
```

`categoryId` and `categoryAnswers` are optional and are only read once the
general phase clears. Answer keys are the `field` values in
`src/config/rules.json` — they are not hardcoded here, so adding a gate to
that file is enough to make its answer meaningful.

## Responses

- `200` — `EvaluateResponse`: `general`, optionally `category`, and
  `nextStep` (`STOP` | `ANSWER_FOLLOW_UPS` | `CHOOSE_CATEGORY` | `COMPLETE`).
  `nextStep` exists so the client does not re-derive routing logic.
- `400` — body was not valid JSON, failed `EvaluateRequestSchema`, or named an
  unsupported category.
- `503` — no general gates are published. Refusing beats returning a verdict
  from an empty rule set.

`GateResult` deliberately excludes `gate.description` (legal's internal notes),
`gate.operator` and `gate.value` (the answer key). `strip()` in `route.ts` is
where to re-narrow if `GateResult` is ever widened.

## Notes

- Missing or wrong-typed answers produce `MISSING` / `INCOMPLETE`. They never
  silently pass.
- The category phase does not run while the general phase is `FAIL` or
  `INCOMPLETE`.
- No LLM is involved. This endpoint is fully deterministic; document checking
  lives in `POST /api/evidence`.
