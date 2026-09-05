import { NextResponse } from "next/server";
import { ChallengeRequestSchema, type ApiError, type ChallengeResponse } from "@/lib/api";
import { buildQuestions, type GateLike } from "@/lib/challenge";
import { evaluateCategory, evaluateGeneral } from "@/lib/evaluate";
import { gateById, publishedCategoryGates, publishedGeneralGates } from "@/lib/rules";
import type { Answers, GateResult } from "@/lib/types";
import { applicability } from "@/lib/applicability";

/**
 * POST /api/challenge
 *
 * Builds the bounded question queue for the challenge round.
 *
 * Server-side because it needs rules.json: `missingMessage` — the "if unknown"
 * follow-up legal authored — only reaches the client on a GateResult when the
 * outcome is MISSING (evaluate.ts), so WEAKNESS gates would otherwise have no
 * question to ask. Nothing here changes a verdict.
 *
 * The queue is built once and then walked. Re-deriving it after each answer
 * could fix one gate only to reveal another, and the round has to terminate.
 */
export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json<ApiError>({ error: "Body must be valid JSON" }, 400);
  }

  const parsed = ChallengeRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return json<ApiError>({ error: "Invalid request", detail: parsed.error.flatten() }, 400);
  }
  const { generalAnswers, categoryId, categoryAnswers, findings, unclear } = parsed.data;

  if (publishedGeneralGates.length === 0) {
    return json<ApiError>({ error: "Eligibility rules are not yet published." }, 503);
  }

  // Re-run the deterministic engine to see where the claim actually stands.
  const results: GateResult[] = [...evaluateGeneral(generalAnswers, publishedGeneralGates).results];
  if (categoryId && categoryAnswers) {
    const gates = publishedCategoryGates(categoryId);
    if (gates.length > 0) {
      results.push(...evaluateCategory(categoryId, categoryAnswers, gates).results);
    }
  }

  const passedGateIds = new Set(
    results.filter((r) => r.outcome === "PASS").map((r) => r.gateId)
  );
  const weakOrIncompleteGateIds = results
    .filter((r) => r.outcome === "WEAKNESS" || r.outcome === "MISSING")
    .map((r) => r.gateId);

  const answers: Answers = { ...(categoryAnswers ?? {}), ...generalAnswers };

  const inScope = (gateId: string) => {
    const gate = gateById(gateId);
    return gate && (gate.scope === "general" || gate.category === categoryId) &&
      applicability(gate.appliesWhen, gate.scope === "general" ? generalAnswers : categoryAnswers ?? {}) === "APPLIES";
  };

  const questions = buildQuestions(
    { findings: findings.filter((item) => inScope(item.gateId)), unclear: unclear.filter((item) => inScope(item.gateId)), passedGateIds, weakOrIncompleteGateIds, answers },
    toGateLike
  );

  return json<ChallengeResponse>({ questions });
}

/** Narrow a published gate to what the builder needs. */
function toGateLike(gateId: string): GateLike | undefined {
  const gate = gateById(gateId);
  if (!gate) return undefined;
  return {
    id: gate.id,
    scope: gate.scope,
    field: gate.field,
    question: gate.question,
    missingMessage: gate.missingMessage,
    answerType: gate.answerType,
    options: gate.options,
    plainExplanation: gate.plainExplanation,
    source: gate.source,
    appliesWhen: gate.appliesWhen,
  };
}

function json<T>(body: T, status = 200) {
  return NextResponse.json(body, { status });
}
