import {
  isPublished,
  type Answers,
  type AnswerType,
  type AnswerValue,
  type CategoryGate,
  type CategoryVerdict,
  type Gate,
  type GateResult,
  type GateValue,
  type GeneralGate,
  type Operator,
  type PhaseStatus,
  type PhaseVerdict,
  type PublishedGate,
  type Verdict,
} from "./types.ts";
import { applicability } from "./applicability.ts";

/* ------------------------------------------------------------
 * Pure interpreter. No I/O, no parsing — inputs are already
 * validated by the route handler (answers) and rules.ts (gates).
 * ------------------------------------------------------------ */

function typeMatches(raw: AnswerValue, answerType: AnswerType): boolean {
  switch (answerType) {
    case "boolean": return typeof raw === "boolean";
    case "number":  return typeof raw === "number" && Number.isFinite(raw);
    case "select":  return typeof raw === "string";
    case "text":    return typeof raw === "string";
  }
}

function compare(raw: string | number | boolean, operator: Operator, target: GateValue): boolean {
  switch (operator) {
    case "eq":    return raw === target;
    case "neq":   return raw !== target;
    case "gt":    return typeof raw === "number" && typeof target === "number" && raw > target;
    case "gte":   return typeof raw === "number" && typeof target === "number" && raw >= target;
    case "lt":    return typeof raw === "number" && typeof target === "number" && raw < target;
    case "lte":   return typeof raw === "number" && typeof target === "number" && raw <= target;
    case "in":    return Array.isArray(target) && (target as unknown[]).includes(raw);
    case "notIn": return Array.isArray(target) && !(target as unknown[]).includes(raw);
  }
}

function evaluateGate(gate: PublishedGate, answers: Answers): GateResult {
  const raw = answers[gate.field];
  const base = {
    gateId: gate.id,
    field: gate.field,
    severity: gate.onFail,
    exceptions: gate.exceptions,
    source: gate.source,
  };

  // Unanswered, "don't know", or wrong type — never a silent pass.
  if (raw === undefined || raw === null || !typeMatches(raw, gate.answerType)) {
    return { ...base, outcome: "MISSING", explanation: gate.plainExplanation, followUp: gate.missingMessage };
  }

  const passed = compare(raw, gate.operator, gate.value);
  return { ...base, outcome: passed ? "PASS" : gate.onFail, explanation: passed ? gate.passExplanation ?? gate.plainExplanation : gate.plainExplanation };
}

function deriveStatus(results: GateResult[]): PhaseStatus {
  if (results.some((r) => r.outcome === "FAIL")) return "FAIL";
  // An unanswered hard gate blocks; an unanswered weakness does not.
  if (results.some((r) => r.outcome === "MISSING" && r.severity !== "WEAKNESS")) return "INCOMPLETE";
  if (results.some((r) => r.outcome === "CONDITIONAL")) return "CONDITIONAL";
  return "PASS";
}

export function evaluateGates(gates: Gate[], answers: Answers): PhaseVerdict {
  const published = gates.filter(isPublished);
  if (published.length === 0) {
    // Refuse to return PASS on an empty rule set — that would be
    // exactly the false-confidence failure the brief warns about.
    throw new Error("evaluateGates: no published gates to evaluate");
  }
  // UNKNOWN prerequisites are represented by their own MISSING gate result.
  // Never assess a hidden follow-up using a stale answer from another branch.
  const results = published
    .filter((g) => applicability(g.appliesWhen, answers) === "APPLIES")
    .map((g) => evaluateGate(g, answers));
  return {
    status: deriveStatus(results),
    results,
    failed: results.filter((r) => r.outcome === "FAIL"),
    conditional: results.filter((r) => r.outcome === "CONDITIONAL"),
    weaknesses: results.filter((r) => r.outcome === "WEAKNESS"),
    missing: results.filter((r) => r.outcome === "MISSING"),
  };
}

/* ------------------------------------------------------------
 * Phase 1 — general eligibility, category-independent.
 * ------------------------------------------------------------ */
export function evaluateGeneral(answers: Answers, generalGates: GeneralGate[]): PhaseVerdict {
  return evaluateGates(generalGates, answers);
}

// The UI moves to category selection only when this is true.
// CONDITIONAL proceeds (claim can go ahead if the condition is met);
// INCOMPLETE does not (answer the follow-ups first).
export function canProceedToCategory(general: PhaseVerdict): boolean {
  return general.status === "PASS" || general.status === "CONDITIONAL";
}

/* ------------------------------------------------------------
 * Phase 2 — category-specific criteria.
 * ------------------------------------------------------------ */
export function evaluateCategory(
  categoryId: string,
  answers: Answers,
  categoryGates: CategoryGate[]
): CategoryVerdict {
  const gates = categoryGates.filter((g) => g.category === categoryId);
  if (gates.length === 0) throw new Error(`evaluateCategory: no gates for category "${categoryId}"`);
  return { category: categoryId, ...evaluateGates(gates, answers) };
}

/* ------------------------------------------------------------
 * Full flow — general → (if it clears) category.
 * ------------------------------------------------------------ */
export function evaluate(
  generalAnswers: Answers,
  generalGates: GeneralGate[],
  categoryStep?: { categoryId: string; answers: Answers; gates: CategoryGate[] }
): Verdict {
  const general = evaluateGeneral(generalAnswers, generalGates);
  if (!categoryStep || !canProceedToCategory(general)) return { general };
  const category = evaluateCategory(categoryStep.categoryId, categoryStep.answers, categoryStep.gates);
  return { general, category };
}
