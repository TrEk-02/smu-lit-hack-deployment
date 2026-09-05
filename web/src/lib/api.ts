import { z } from "zod";
import { AnswersSchema, CategorySchema, GateResultSchema, PhaseStatusSchema } from "./types";
import type { PartyQuestion, Question } from "./types";

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