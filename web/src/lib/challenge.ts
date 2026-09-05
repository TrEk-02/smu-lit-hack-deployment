// Explicit .ts extension: challenge.test.ts runs this module directly under
// `node --test` type stripping, where relative runtime imports need one.
// Type-only imports are erased, so they don't.
import { formatAnswer } from "./format.ts";
import type { AnswerType, AnswerValue, Answers, Option, Source } from "./types";

/* ============================================================
 * THE CHALLENGE ROUND — question builder
 *
 * Bounded, gate-anchored, finite. Not a chat box: a free-text
 * chat would rebuild the confirmation-bias problem we claim to
 * solve (DECISIONS.md §Challenge round).
 *
 * Pure — the gate lookup is injected, so ranking and termination
 * are unit-testable without rules.json or a server.
 * ============================================================ */

/** Hard cap. The round must terminate, and five questions is the ceiling. */
export const MAX_QUESTIONS = 5;

export type ChallengeKind =
  /** A document contradicts an answer, and legal allows a correction. */
  | "CONFIRM_CORRECTION"
  /** A document contradicts an answer, but the inference is a judgement call. */
  | "ESCALATED"
  /** The model saw something but could not tell — ask the person. */
  | "UNCLEAR"
  /** Gate is weak or unanswered — prompt is legal's own "if unknown" question. */
  | "FOLLOW_UP";

export type ChallengeQuestion = {
  /** Stable key. One question per gate, so the gate id carries it. */
  id: string;
  gateId: string;
  field: string;
  /** Which answers bucket a confirmed correction merges into. */
  scope: "general" | "category";
  kind: ChallengeKind;
  /** What we ask them. */
  prompt: string;
  answerType: AnswerType;
  options?: Option[];
  /** What they told us, as they'd recognise it. */
  currentAnswerLabel: string;
  /** Already coerced to the gate's answerType upstream; null = no proposal. */
  proposedAnswer: AnswerValue | null;
  proposedAnswerLabel: string | null;
  /** Present only where a document drove the question. No quote, no question. */
  evidence: { quote: string; page: number; observation: string } | null;
  explanation: string;
  source: Source;
};

/**
 * The finding shape this module needs. Declared structurally rather than
 * imported from api.ts, which would make api.ts ← challenge.ts a cycle.
 * `EvidenceFinding` satisfies it.
 */
export type FindingLike = {
  gateId: string;
  kind: "CORROBORATES" | "CONTRADICTS";
  quote: string;
  page: number;
  observation: string;
  proposedAnswer: AnswerValue | null;
  correctable: boolean;
  escalate: boolean;
};

/** The gate fields the builder needs. `PublishedGate` satisfies it. */
export type GateLike = {
  id: string;
  scope: "general" | "category";
  field: string;
  question: string;
  missingMessage: string;
  answerType: AnswerType;
  options?: Option[];
  plainExplanation: string;
  source: Source;
};

export type BuildInput = {
  findings: FindingLike[];
  unclear: { gateId: string; why: string }[];
  /** Gate ids currently PASSing — contradictions against these rank first. */
  passedGateIds: Set<string>;
  /** Gate ids returning WEAKNESS or MISSING, in verdict order. */
  weakOrIncompleteGateIds: string[];
  answers: Answers;
};

/*
 * Ranking (DECISIONS.md §Challenge round, plus one addition):
 *   0  contradiction on a PASSED gate, correctable   → confirm/reject
 *   1  contradiction on a PASSED gate, ESCALATE      → to the handoff brief
 *   2  contradiction on a gate that did not pass     → (addition, see plan)
 *   3  unclear[] from the model
 *   4  WEAKNESS / INCOMPLETE, from legal's missingMessage
 *
 * Priority 4 is what makes the round non-empty with the LLM stubbed, or with
 * no document at all: it needs nothing but rules.json.
 */
function contradictionPriority(finding: FindingLike, passed: Set<string>): number {
  if (!passed.has(finding.gateId)) return 2;
  return finding.escalate ? 1 : 0;
}

export function buildQuestions(
  input: BuildInput,
  lookup: (gateId: string) => GateLike | undefined
): ChallengeQuestion[] {
  const ranked: { priority: number; question: ChallengeQuestion }[] = [];
  // One question per gate: being asked about the same gate twice reads as
  // badgering, and the second answer would overwrite the first anyway.
  const claimed = new Set<string>();

  const push = (priority: number, question: ChallengeQuestion | null) => {
    if (!question || claimed.has(question.gateId)) return;
    claimed.add(question.gateId);
    ranked.push({ priority, question });
  };

  const base = (gate: GateLike) => ({
    id: gate.id,
    gateId: gate.id,
    field: gate.field,
    scope: gate.scope,
    answerType: gate.answerType,
    options: gate.options,
    currentAnswerLabel: formatAnswer(input.answers[gate.field], gate.answerType, gate.options),
    explanation: gate.plainExplanation,
    source: gate.source,
  });

  // --- Contradictions (priorities 0-2) ------------------------------
  for (const finding of input.findings) {
    if (finding.kind !== "CONTRADICTS") continue; // corroboration needs no challenge
    const gate = lookup(finding.gateId);
    if (!gate) continue;

    const escalated = finding.escalate;
    push(contradictionPriority(finding, input.passedGateIds), {
      ...base(gate),
      kind: escalated ? "ESCALATED" : "CONFIRM_CORRECTION",
      prompt: gate.question,
      // A correction is only offered where one is allowed and survived coercion.
      proposedAnswer: escalated ? null : finding.proposedAnswer,
      proposedAnswerLabel:
        escalated || finding.proposedAnswer === null
          ? null
          : formatAnswer(finding.proposedAnswer, gate.answerType, gate.options),
      evidence: {
        quote: finding.quote,
        page: finding.page,
        observation: finding.observation,
      },
    });
  }

  // --- The model saw something but couldn't tell (priority 3) -------
  for (const item of input.unclear) {
    const gate = lookup(item.gateId);
    if (!gate) continue;
    push(3, {
      ...base(gate),
      kind: "UNCLEAR",
      prompt: gate.question,
      proposedAnswer: null,
      proposedAnswerLabel: null,
      evidence: null,
    });
  }

  // --- Weak or unanswered gates (priority 4) ------------------------
  // Needs nothing but rules.json, so the round is never empty.
  for (const gateId of input.weakOrIncompleteGateIds) {
    const gate = lookup(gateId);
    if (!gate) continue;
    push(4, {
      ...base(gate),
      kind: "FOLLOW_UP",
      prompt: gate.missingMessage || gate.question,
      proposedAnswer: null,
      proposedAnswerLabel: null,
      evidence: null,
    });
  }

  return ranked
    .sort((a, b) => a.priority - b.priority) // stable: ties keep source order
    .slice(0, MAX_QUESTIONS)
    .map((entry) => entry.question);
}
