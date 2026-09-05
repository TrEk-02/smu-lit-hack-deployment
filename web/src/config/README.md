# Eligibility rules

- `rules.json` contains five empty draft gates. No legal details have been filled in.
- Empty strings and `null` mean unfinished, not a default value or a passed check.
- This is a proposed data shape; agree it with the developer writing the Zod schema before filling it in.
- No evaluator or schema validation is implemented by this scaffold.
- The evaluator must refuse to issue an eligibility verdict while required gates are draft or incomplete; do not silently skip them.

Fields to fill later:

| Field | Meaning |
|---|---|
| `id` | Stable gate identifier; keep it when editing the content. |
| `status` | Starts as `draft`; agree the reviewed status with the schema owner. |
| `description` | What the gate checks. |
| `field` | Answer key to inspect; coordinate with the intake form. |
| `operator` | Comparison supported by the evaluator; agree its meaning first. |
| `value` | Comparison target, with type and units agreed with the developer. |
| `onFail` | Result when the condition is false; agree allowed outcomes with the Verdict schema owner. |
| `plainExplanation` | Legal-reviewed explanation when the condition is false. |
| `missingMessage` | Question to ask when the required answer is missing. |
| `source` | Official source title, provision reference, and URL. |

- A single comparison may not express every legal gate. Agree any compound conditions with the evaluator developer rather than putting executable expressions in this file.
- Legal supplies the conditions, sources, and expected results for sample answers.
- Record substantive rule changes in `DECISIONS.md` as required by the working agreement.
