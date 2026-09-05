import { z } from "zod";
import { publishedGateIds } from "../rules";

/* ============================================================
 * THE LLM BOUNDARY CONTRACT
 *
 * Lives here rather than in types.ts because it depends on
 * publishedGateIds — and types.ts ← rules.ts means putting it
 * there would be a cycle. It is a boundary constraint, not a
 * domain type (DECISIONS.md §Evidence).
 *
 * Shape is constrained here; *meaning* is constrained in
 * verify.ts and coerce.ts. Deliberately no .min()/.max() on
 * these fields: strict structured-output mode supports only a
 * subset of JSON Schema, and a model that returns nine findings
 * should be truncated after ranking, not rejected wholesale.
 * ============================================================ */

/**
 * The closed set of gate ids the model may name. Derived from
 * rules.json at import, so the model cannot invent a legal issue —
 * it has no field in which to express one.
 */
export const GateIdSchema = z.enum(publishedGateIds as [string, ...string[]]);

export const FindingKindSchema = z.enum(["CORROBORATES", "CONTRADICTS"]);
export type FindingKind = z.infer<typeof FindingKindSchema>;

export const FindingSchema = z.object({
  gateId: GateIdSchema,
  kind: FindingKindSchema,
  /** Verbatim from the document. Unverifiable quotes are dropped in verify.ts. */
  quote: z.string(),
  /** Advisory — the authoritative page is re-derived by quote verification. */
  page: z.number().int(),
  /** Plain-English description of the mismatch. No legal claims. */
  observation: z.string(),
  /** What the document suggests the answer should be. null = no proposal. */
  proposedAnswer: z.union([z.string(), z.number(), z.boolean()]).nullable(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const UnclearSchema = z.object({
  gateId: GateIdSchema,
  why: z.string(),
});
export type Unclear = z.infer<typeof UnclearSchema>;

export const LlmOutputSchema = z.object({
  findings: z.array(FindingSchema),
  unclear: z.array(UnclearSchema),
});
export type LlmOutput = z.infer<typeof LlmOutputSchema>;

/** Most findings shown to the claimant at once (DECISIONS.md). */
export const MAX_FINDINGS = 8;

/**
 * The JSON Schema sent to the provider, derived from the Zod schema above
 * so the two cannot drift. `$schema` is stripped: providers reject or
 * ignore it in strict mode.
 */
export function wireSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(LlmOutputSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}
