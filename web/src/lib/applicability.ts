import type { Answers, ApplicabilityCondition } from "./types";

/** Shared by the form, evaluator and evidence scope. Unknown is never true. */
export function applicability(
  conditions: ApplicabilityCondition[] | undefined,
  answers: Answers,
): "APPLIES" | "SKIP" | "UNKNOWN" {
  let unknown = false;
  for (const condition of conditions ?? []) {
    const answer = answers[condition.field];
    if (answer === undefined || answer === null || typeof answer !== typeof condition.value) {
      unknown = true;
      continue;
    }
    let matches: boolean;
    switch (condition.operator) {
      case "eq": matches = answer === condition.value; break;
      case "gt": matches = typeof answer === "number" && answer > Number(condition.value); break;
      case "lte": matches = typeof answer === "number" && answer <= Number(condition.value); break;
    }
    if (!matches) return "SKIP";
  }
  return unknown ? "UNKNOWN" : "APPLIES";
}
