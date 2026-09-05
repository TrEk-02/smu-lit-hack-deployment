import type { AnswerType, AnswerValue, Option } from "./types";

/**
 * Render a stored answer the way the claimant would recognise it —
 * the option label they picked, not the value we store it under.
 * Shared by the LLM prompt and the challenge round so the two can
 * never describe the same answer differently.
 */
export function formatAnswer(
  value: AnswerValue | undefined,
  answerType: AnswerType | null,
  options?: Option[]
): string {
  if (value === undefined || value === null || value === "") return "(not answered)";
  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (answerType === "select" && options) {
    const option = options.find((candidate) => candidate.value === value);
    if (option) return option.label;
  }
  return String(value);
}
