import { z } from "zod";
import { AnswersSchema, CategorySchema, GateResultSchema, PhaseStatusSchema } from "./types";
import type { AnswerValue, PartyQuestion, Question, Source } from "./types";
import type { ChallengeQuestion } from "./challenge";
import type { Provenance } from "./llm/provenance";

/* ============================================================
 * GET /api/config  →  ConfigResponse
 * What the UI needs to render forms. Read-only, no input.
 * ============================================================ */

export type ConfigResponse = {
  version?: string;
  ready: boolean;              // false when a phase has no published gates yet
  categories: Category[];      // only categories with published gates
  generalQuestions: Question[];
  partyQuestions: PartyQuestion[];
};

// GET /api/config/[categoryId] → CategoryConfigResponse
export type CategoryConfigResponse = {
  category: Category;
  questions: Question[];
};

type Category = z.infer<typeof CategorySchema>;

/* ============================================================
 * POST /api/evaluate  →  EvaluateResponse
 *
 * One endpoint, both phases. The category step is optional:
 * the UI posts general answers alone first, and only includes
 * categoryId + categoryAnswers once general has cleared.
 * ============================================================ */

export const EvaluateRequestSchema = z
  .object({
    generalAnswers: AnswersSchema,
    categoryId: z.string().min(1).optional(),
    categoryAnswers: AnswersSchema.optional(),
  })
  .refine((b) => (b.categoryId === undefined) === (b.categoryAnswers === undefined), {
    message: "categoryId and categoryAnswers must be sent together",
  });
export type EvaluateRequest = z.infer<typeof EvaluateRequestSchema>;

// Client-facing verdict. Deliberately NOT the internal PhaseVerdict:
// see toPublicPhase in evaluate route — gate.description, operator
// and value never cross the wire.
export const PublicPhaseSchema = z.object({
  status: PhaseStatusSchema,
  results: z.array(GateResultSchema),
  failed: z.array(GateResultSchema),
  conditional: z.array(GateResultSchema),
  weaknesses: z.array(GateResultSchema),
  missing: z.array(GateResultSchema),
});

export const EvaluateResponseSchema = z.object({
  general: PublicPhaseSchema,
  category: PublicPhaseSchema.extend({ category: z.string() }).optional(),
  nextStep: z.enum(["ANSWER_FOLLOW_UPS", "CHOOSE_CATEGORY", "COMPLETE", "STOP"]),
});
export type EvaluateResponse = z.infer<typeof EvaluateResponseSchema>;

export type ApiError = { error: string; detail?: unknown };

/* ============================================================
 * POST /api/evidence  →  EvidenceResponse
 *
 * Document-vs-answer checking. The model proposes; evaluate()
 * still decides — nothing here writes a verdict.
 * ============================================================ */

export const PageSchema = z.object({ page: z.number().int(), text: z.string() });

export const ExtractedDocSchema = z.object({
  docId: z.string().min(1),
  name: z.string(),
  pages: z.array(PageSchema).min(1),
});

export const EvidenceRequestSchema = z.object({
  generalAnswers: AnswersSchema,
  categoryId: z.string().min(1).optional(),
  categoryAnswers: AnswersSchema.optional(),
  doc: ExtractedDocSchema,
});
export type EvidenceRequest = z.infer<typeof EvidenceRequestSchema>;

/**
 * One verified finding. `source` and `explanation` are joined in by
 * gateId after validation — the model never sees or generates them.
 */
export type EvidenceFinding = {
  gateId: string;
  field: string;
  question: string;
  kind: "CORROBORATES" | "CONTRADICTS";
  /** Verified to appear verbatim in the document; unmatched quotes never reach here. */
  quote: string;
  page: number;
  observation: string;
  /** Coerced to the gate's answerType, or null if it would not coerce. */
  proposedAnswer: AnswerValue | null;
  correctable: boolean;
  /** true → goes to the handoff brief instead of offering a correction. */
  escalate: boolean;
  explanation: string;
  source: Source;
};

export type EvidenceResponse = {
  docId: string;
  findings: EvidenceFinding[];
  unclear: { gateId: string; question: string; why: string }[];
  provenance: Record<string, Provenance>;
  /** Findings discarded because their quote was not in the document. Shown, not hidden. */
  droppedFindings: number;
  /** Gates that were actually checked, for the provenance display. */
  checkedGateIds: string[];
  /** true → output is a demo fixture, and must be labelled as one in the UI. */
  stubbed: boolean;
};

/* ============================================================
 * POST /api/challenge  →  ChallengeResponse
 *
 * Builds the bounded question queue. Findings are optional: with
 * no document at all the round still asks about weak and
 * unanswered gates, straight from rules.json.
 * ============================================================ */

const FindingInputSchema = z.object({
  gateId: z.string().min(1),
  kind: z.enum(["CORROBORATES", "CONTRADICTS"]),
  quote: z.string(),
  page: z.number().int(),
  observation: z.string(),
  proposedAnswer: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  correctable: z.boolean(),
  escalate: z.boolean(),
});

export const ChallengeRequestSchema = z.object({
  generalAnswers: AnswersSchema,
  categoryId: z.string().min(1).optional(),
  categoryAnswers: AnswersSchema.optional(),
  findings: z.array(FindingInputSchema).default([]),
  unclear: z.array(z.object({ gateId: z.string().min(1), why: z.string() })).default([]),
});
export type ChallengeRequest = z.infer<typeof ChallengeRequestSchema>;

export type ChallengeResponse = {
  questions: ChallengeQuestion[];
};

/**
 * A verified contradiction the claimant rejected, or one that was escalated
 * rather than corrected. Kept so the Sprint 3 handoff brief can show a real
 * person both sides — we do not drop a verified contradiction because the
 * claimant said no (DECISIONS.md §Challenge round).
 */
export type Disagreement = {
  gateId: string;
  question: string;
  /** What they told us, and are sticking with. */
  claimantAnswer: string;
  /** Why the document disagrees, with its verified quote. */
  observation: string;
  quote: string;
  page: number;
  reason: "REJECTED" | "ESCALATED";
};