import { z } from "zod";

/* ============================================================
 * ANSWERS
 * One flat record keyed by gate.field. rules.json decides which
 * fields exist — there is no hand-maintained Answers type to drift.
 * null = "claimant said they don't know" (treated as MISSING).
 * ============================================================ */

export const AnswerValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type AnswerValue = z.infer<typeof AnswerValueSchema>;

export const AnswersSchema = z.record(z.string(), AnswerValueSchema);
export type Answers = z.infer<typeof AnswersSchema>;

/* ============================================================
 * VOCABULARY
 * ============================================================ */

// Authoring lifecycle. Draft gates live in rules.json but never run.
export const LifecycleStatusSchema = z.enum(["draft", "published"]);
export type LifecycleStatus = z.infer<typeof LifecycleStatusSchema>;

// What kind of input the UI renders for a gate's field.
export const AnswerTypeSchema = z.enum(["boolean", "number", "select", "text"]);
export type AnswerType = z.infer<typeof AnswerTypeSchema>;

// Comparison applied as: answers[field] <operator> value
export const OperatorSchema = z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "notIn"]);
export type Operator = z.infer<typeof OperatorSchema>;

// gate.onFail — what a failed check means for the claim.
//   FAIL        hard stop (jurisdiction / not a contract claim)
//   CONDITIONAL can proceed only if a stated condition is met
//   WEAKNESS    this ground is weak or unavailable; claim continues
export const SeveritySchema = z.enum(["FAIL", "CONDITIONAL", "WEAKNESS"]);
export type Severity = z.infer<typeof SeveritySchema>;

// Per-gate result. MISSING = field unanswered, null, or wrong type.
export const GateOutcomeSchema = z.enum(["PASS", "FAIL", "CONDITIONAL", "WEAKNESS", "MISSING"]);
export type GateOutcome = z.infer<typeof GateOutcomeSchema>;

// Per-phase status. INCOMPLETE = a FAIL/CONDITIONAL-severity gate is
// MISSING, so eligibility cannot be assumed (DECISIONS.md §12).
export const PhaseStatusSchema = z.enum(["PASS", "CONDITIONAL", "INCOMPLETE", "FAIL"]);
export type PhaseStatus = z.infer<typeof PhaseStatusSchema>;

export const GateValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number()])), // for in / notIn
]);
export type GateValue = z.infer<typeof GateValueSchema>;

export const OptionSchema = z.object({ value: z.string(), label: z.string() });
export type Option = z.infer<typeof OptionSchema>;

export const SourceSchema = z.object({
  title: z.string(),
  provision: z.string(),
  url: z.string(), // "" allowed — matches the authoring template
});
export type Source = z.infer<typeof SourceSchema>;

/* ============================================================
 * EVIDENCE — what a document would have to show for this gate.
 * A discriminated union on `checkable`, so a gate cannot be
 * half-filled: either it says what to look for, or it says why
 * no document could speak to it.
 *
 * `expect` is the field that drives finding quality — it is the
 * only gate content the model ever sees besides the question and
 * the claimant's own answer. `source` and `plainExplanation` are
 * never sent; they are joined back in by gateId afterwards.
 *
 * `docTypes` is free text, not a closed enum: legal authors
 * descriptions ("Value in dollar", "Number of items"), not
 * document formats. Surfaced to the claimant as "what would help".
 * ============================================================ */

export const OnContradictionSchema = z.enum(["CORRECT", "ESCALATE"]);
export type OnContradiction = z.infer<typeof OnContradictionSchema>;

const EvidenceCheckableSchema = z.object({
  checkable: z.literal(true),
  expect: z.string().min(1),
  docTypes: z.array(z.string().min(1)).min(1),
  correctable: z.boolean(),
  // Legal's authoring template omits this; CORRECT is the only value
  // consistent with correctable: true (see the RulesFileSchema cross-check).
  onContradiction: OnContradictionSchema.default("CORRECT"),
});

const EvidenceUncheckableSchema = z.object({
  checkable: z.literal(false),
  reason: z.string().min(1), // why no document could speak to it
});

export const EvidenceSchema = z.discriminatedUnion("checkable", [
  EvidenceCheckableSchema,
  EvidenceUncheckableSchema,
]);
export type Evidence = z.infer<typeof EvidenceSchema>;
export type CheckableEvidence = Extract<Evidence, { checkable: true }>;

/* ============================================================
 * GATE — legal's authoring template, plus four additions:
 *   scope, category  → which phase / which claim type
 *   question         → what the UI asks the claimant (description
 *                      stays as the internal label)
 *   answerType, options → so the UI can render the form from
 *                      rules.json instead of a hand-coded schema
 *   exceptions       → the table's "Exceptions" column; not
 *                      evaluated, surfaced in the handoff brief
 * ============================================================ */

const GateFields = {
  id: z.string().min(1),
  status: LifecycleStatusSchema,
  description: z.string(),
  question: z.string(),
  field: z.string().nullable(),
  answerType: AnswerTypeSchema.nullable(),
  options: z.array(OptionSchema).optional(),
  operator: OperatorSchema.nullable(),
  value: GateValueSchema.nullable(),
  onFail: SeveritySchema.nullable(),
  plainExplanation: z.string(),
  missingMessage: z.string(), // the table's "If unknown: follow-up question"
  exceptions: z.string().optional(),
  source: SourceSchema,
  evidence: EvidenceSchema.optional(), // absent = not yet labelled by legal
};

const GateBaseSchema = z.object(GateFields);
type GateShape = z.infer<typeof GateBaseSchema>;

function refinePublished(gate: GateShape, ctx: z.RefinementCtx) {
  if (gate.status !== "published") return;

  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: `gate "${gate.id}": ${message}` });

  for (const key of ["field", "answerType", "operator", "value", "onFail"] as const) {
    if (gate[key] === null) issue(key, `published gate is missing "${key}"`);
  }
  if (!gate.question.trim()) issue("question", "published gate needs a question");

  const listOp = gate.operator === "in" || gate.operator === "notIn";
  if (listOp && !Array.isArray(gate.value)) issue("value", `"${gate.operator}" needs an array value`);
  if (!listOp && Array.isArray(gate.value)) issue("value", `"${gate.operator}" needs a single value`);

  if (gate.answerType === "select") {
    if (!gate.options || gate.options.length === 0) issue("options", "select gate needs options");
    const allowed = new Set((gate.options ?? []).map((o) => o.value));
    const vals = Array.isArray(gate.value) ? gate.value : [gate.value];
    for (const v of vals) {
      if (typeof v !== "string" || !allowed.has(v)) issue("value", `value "${String(v)}" is not one of the options`);
    }
  }
  if (gate.answerType === "number" && !listOp && typeof gate.value !== "number") {
    issue("value", "number gate needs a numeric value");
  }
  if (gate.answerType === "boolean" && typeof gate.value !== "boolean") {
    issue("value", "boolean gate needs a boolean value");
  }
}

export const GeneralGateSchema = z
  .object({ scope: z.literal("general"), ...GateFields })
  .superRefine(refinePublished);
export type GeneralGate = z.infer<typeof GeneralGateSchema>;

export const CategoryGateSchema = z
  .object({ scope: z.literal("category"), category: z.string().min(1), ...GateFields })
  .superRefine(refinePublished);
export type CategoryGate = z.infer<typeof CategoryGateSchema>;

export type Gate = GeneralGate | CategoryGate;

// A published gate with its nullable authoring fields narrowed.
export type PublishedGate = Gate & {
  status: "published";
  field: string;
  answerType: AnswerType;
  operator: Operator;
  value: GateValue;
  onFail: Severity;
};

export function isPublished(g: Gate): g is PublishedGate {
  return (
    g.status === "published" &&
    g.field !== null &&
    g.answerType !== null &&
    g.operator !== null &&
    g.value !== null &&
    g.onFail !== null
  );
}

/* ============================================================
 * CATEGORY — shown to the claimant when choosing claim type.
 * A category is "supported" only if it has ≥1 published gate.
 * ============================================================ */

export const CategorySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string(),
});
export type Category = z.infer<typeof CategorySchema>;

/* ============================================================
 * PARTY FIELD — plain intake fields (who is filing, who they're
 * filing against). Deliberately not a Gate: these have no
 * operator/onFail/source/plainExplanation because they aren't
 * eligibility checks, just data capture into answers{} (Sprint 2,
 * DECISIONS.md "Party & filing details").
 * ============================================================ */

export const DependsOnSchema = z.object({
  field: z.string().min(1),
  value: AnswerValueSchema,
});
export type DependsOn = z.infer<typeof DependsOnSchema>;

export const PartyFieldSchema = z.object({
  id: z.string().min(1),
  status: LifecycleStatusSchema,
  field: z.string().min(1),
  question: z.string().min(1),
  answerType: AnswerTypeSchema,
  options: z.array(OptionSchema).optional(),
  dependsOn: DependsOnSchema.optional(),
});
export type PartyField = z.infer<typeof PartyFieldSchema>;

// What the UI renders for a party field — parallel to Question,
// but there's no gateIds since these don't back an evaluated gate.
export type PartyQuestion = {
  field: string;
  question: string;
  answerType: AnswerType;
  options?: Option[];
  dependsOn?: DependsOn;
};

/* ============================================================
 * RULES FILE — the whole of config/rules.json
 * ============================================================ */

export const RulesFileSchema = z
  .object({
    version: z.string().optional(),
    categories: z.array(CategorySchema).min(1),
    generalGates: z.array(GeneralGateSchema),
    categoryGates: z.array(CategoryGateSchema),
    partyFields: z.array(PartyFieldSchema).default([]),
  })
  .superRefine((file, ctx) => {
    const issue = (path: string[], message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

    const catIds = new Set(file.categories.map((c) => c.id));
    const seenIds = new Set<string>();
    const fieldTypes = new Map<string, string>();

    file.partyFields.forEach((f) => {
      if (seenIds.has(f.id)) issue(["partyFields", f.id], `duplicate id "${f.id}"`);
      seenIds.add(f.id);
    });

    const all: Gate[] = [...file.generalGates, ...file.categoryGates];
    all.forEach((g) => {
      if (seenIds.has(g.id)) issue(["gates", g.id], `duplicate gate id "${g.id}"`);
      seenIds.add(g.id);

      if (g.scope === "category" && !catIds.has(g.category)) {
        issue(["categoryGates", g.id], `category "${g.category}" is not declared in categories`);
      }

      // Two gates may share a field (e.g. claimAmount cap + consent),
      // but they must agree on how it's asked.
      if (g.field && g.answerType) {
        const key = `${g.scope}:${g.field}`;
        const sig = g.answerType + "|" + JSON.stringify(g.options ?? null);
        const prev = fieldTypes.get(key);
        if (prev && prev !== sig) issue(["gates", g.id], `field "${g.field}" has conflicting answerType/options across gates`);
        fieldTypes.set(key, sig);
      }

      // ESCALATE means "don't offer a correction, send it to a human".
      // Marking the same gate correctable contradicts that.
      if (g.evidence?.checkable && g.evidence.correctable && g.evidence.onContradiction === "ESCALATE") {
        issue(["gates", g.id], `evidence: correctable true cannot be paired with onContradiction ESCALATE`);
      }
    });
  });
export type RulesFile = z.infer<typeof RulesFileSchema>;

/* ============================================================
 * UI QUESTION — what Dev B renders. Derived from gates, one per
 * distinct field (see rules.ts → toQuestions).
 * ============================================================ */

export type Question = {
  field: string;
  question: string;
  answerType: AnswerType;
  options?: Option[];
  gateIds: string[];
};

/* ============================================================
 * RESULTS
 * ============================================================ */

export const GateResultSchema = z.object({
  gateId: z.string(),
  field: z.string(),
  outcome: GateOutcomeSchema,
  severity: SeveritySchema, // what this gate's failure would mean
  explanation: z.string(),
  followUp: z.string().optional(), // set when outcome === MISSING
  exceptions: z.string().optional(),
  source: SourceSchema,
});
export type GateResult = z.infer<typeof GateResultSchema>;

export const PhaseVerdictSchema = z.object({
  status: PhaseStatusSchema,
  results: z.array(GateResultSchema),
  failed: z.array(GateResultSchema),
  conditional: z.array(GateResultSchema),
  weaknesses: z.array(GateResultSchema),
  missing: z.array(GateResultSchema),
});
export type PhaseVerdict = z.infer<typeof PhaseVerdictSchema>;

export const CategoryVerdictSchema = PhaseVerdictSchema.extend({ category: z.string() });
export type CategoryVerdict = z.infer<typeof CategoryVerdictSchema>;

export const VerdictSchema = z.object({
  general: PhaseVerdictSchema,
  category: CategoryVerdictSchema.optional(), // absent until general clears
});
export type Verdict = z.infer<typeof VerdictSchema>;