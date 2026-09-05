"use client";

import type { AnswerType, AnswerValue, Question } from "@/lib/types";

/**
 * One input per answerType, shared by the intake form and the challenge
 * round so a gate is answered the same way wherever it is asked
 * (DECISIONS.md §Challenge round: "reuses the Sprint 1 form controls").
 *
 * Emits `null` for "no answer" — types.ts treats null as "the claimant said
 * they don't know", which evaluates to MISSING rather than a false clearance.
 */
/**
 * Only what the control itself needs. The label is the caller's business —
 * the intake form calls it `question`, the challenge round calls it `prompt`.
 */
export type FormQuestion = Pick<Question, "field" | "answerType" | "options">;

export function AnswerInput({
  question,
  value,
  onChange,
  id,
}: {
  question: FormQuestion;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue) => void;
  id?: string;
}) {
  const inputId = id ?? question.field;

  // <input> values arrive as strings; a number gate expects a number.
  function fromRaw(raw: string) {
    if (raw === "") return onChange(null);
    if (question.answerType === "number") {
      const parsed = Number(raw);
      return onChange(Number.isNaN(parsed) ? null : parsed);
    }
    onChange(raw);
  }

  switch (question.answerType as AnswerType) {
    case "text":
      return (
        <textarea
          id={inputId}
          rows={2}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => fromRaw(event.target.value)}
        />
      );

    case "number":
      return (
        <input
          id={inputId}
          type="number"
          step="0.01"
          value={typeof value === "number" ? value : ""}
          placeholder="Enter a number"
          onChange={(event) => fromRaw(event.target.value)}
        />
      );

    case "select":
      return (
        <select
          id={inputId}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => fromRaw(event.target.value)}
        >
          <option value="">Select an option</option>
          {(question.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );

    case "boolean":
      return (
        <select
          id={inputId}
          value={typeof value === "boolean" ? String(value) : ""}
          onChange={(event) =>
            onChange(event.target.value === "" ? null : event.target.value === "true")
          }
        >
          <option value="">Select an answer</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );

    default:
      return null;
  }
}
