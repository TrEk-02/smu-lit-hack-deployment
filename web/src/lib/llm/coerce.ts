import type { AnswerType, AnswerValue, Option } from "../types";

/* ============================================================
 * PROPOSED-ANSWER COERCION
 *
 * The model proposes a fact; the engine decides. Before a proposal
 * can be shown as "the document suggests X", it has to survive
 * conversion to the gate's own answerType — otherwise a confirmed
 * correction would write a string into a number field and quietly
 * turn a real answer into MISSING.
 *
 * Returns null when it won't coerce. Callers keep the finding and
 * drop the proposal: an unusable suggestion is not a reason to hide
 * a verified contradiction, and it is never a reason to guess.
 * ============================================================ */

const TRUTHY = new Set(["true", "yes", "y"]);
const FALSY = new Set(["false", "no", "n"]);

export function coerceProposedAnswer(
  value: string | number | boolean,
  answerType: AnswerType,
  options?: Option[]
): AnswerValue | null {
  switch (answerType) {
    case "boolean": {
      if (typeof value === "boolean") return value;
      const text = String(value).trim().toLowerCase();
      if (TRUTHY.has(text)) return true;
      if (FALSY.has(text)) return false;
      return null;
    }

    case "number": {
      if (typeof value === "number") return Number.isFinite(value) ? value : null;
      if (typeof value === "boolean") return null;
      // Documents write money as "S$3,000.00" — that is still a number.
      const cleaned = value.replace(/[^0-9.-]/g, "");
      if (!cleaned || !/\d/.test(cleaned)) return null;
      const parsed = Number(cleaned);
      return Number.isFinite(parsed) ? parsed : null;
    }

    case "select": {
      if (typeof value !== "string" || !options) return null;
      // Must be one of legal's declared option values — the model does not
      // get to introduce a new branch into a gate.
      const match = options.find(
        (option) => option.value.toLowerCase() === value.trim().toLowerCase()
      );
      return match ? match.value : null;
    }

    case "text": {
      const text = String(value).trim();
      return text ? text : null;
    }
  }
}
