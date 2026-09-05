import { NextResponse } from "next/server";
import { canProceedToCategory, evaluateCategory, evaluateGeneral } from "@/lib/evaluate";
import { publishedCategoryGates, publishedGeneralGates, supportedCategories } from "@/lib/rules";
import { EvaluateRequestSchema, type ApiError, type EvaluateResponse } from "@/lib/api";
import type { PhaseVerdict } from "@/lib/types";
import type { ConfigResponse } from "@/lib/api";


/**
 * POST /api/evaluate
 *
 * Body: { generalAnswers, categoryId?, categoryAnswers? }
 * Both phases go through this one endpoint. The UI calls it twice:
 * once with general answers alone, then again with the same general
 * answers plus the category step. Stateless — no session, no DB,
 * which matches "refresh resets the session" in DECISIONS.md §12.
 */
export async function POST(req: Request) {
  // ---- 1. Parse the envelope ------------------------------------
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json<ApiError>({ error: "Body must be valid JSON" }, 400);
  }

  // ---- 2. Validate at the boundary ------------------------------
  // This is the ONLY place request data is validated. evaluate.ts
  // assumes it never sees malformed input.
  const parsed = EvaluateRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return json<ApiError>({ error: "Invalid request", detail: parsed.error.flatten() }, 400);
  }
  const { generalAnswers, categoryId, categoryAnswers } = parsed.data;

  // ---- 3. Refuse to run against an unconfigured rule set ---------
  // Without this the engine throws and the client gets a 500 with a
  // stack trace. A tool that says "not configured" beats one that
  // looks broken — and beats one that silently returns PASS.
  if (publishedGeneralGates.length === 0) {
    return json<ApiError>(
      { error: "Eligibility rules are not yet published. No assessment can be given." },
      503
    );
  }

  // ---- 4. Phase 1 -----------------------------------------------
  const general = evaluateGeneral(generalAnswers, publishedGeneralGates);

  if (!canProceedToCategory(general)) {
    return json<EvaluateResponse>({
      general: strip(general),
      nextStep: general.status === "INCOMPLETE" ? "ANSWER_FOLLOW_UPS" : "STOP",
    });
  }

  if (!categoryId || !categoryAnswers) {
    return json<EvaluateResponse>({ general: strip(general), nextStep: "CHOOSE_CATEGORY" });
  }

  // ---- 5. Phase 2 -----------------------------------------------
  if (!supportedCategories().some((c) => c.id === categoryId)) {
    return json<ApiError>({ error: `Unknown or unsupported category: ${categoryId}` }, 400);
  }

  const category = evaluateCategory(categoryId, categoryAnswers, publishedCategoryGates(categoryId));

  return json<EvaluateResponse>({
    general: strip(general),
    category: { category: categoryId, ...strip(category) },
    nextStep: category.status === "INCOMPLETE" ? "ANSWER_FOLLOW_UPS" : "COMPLETE",
  });
}

/**
 * Strips nothing today — GateResult already excludes gate.description
 * (which holds legal's internal notes and "UNVERIFIED" markers) and
 * gate.operator/value (which is the answer key). This function exists
 * so that stays deliberate: if anyone widens GateResult later, this is
 * the one place to re-narrow it before it reaches the browser.
 */
function strip(v: PhaseVerdict): PhaseVerdict {
  return v;
}

function json<T>(body: T, status = 200) {
  return NextResponse.json(body, { status });
}
/**
 * GET /api/config
 * Everything the UI needs to render the general-eligibility form and
 * the category picker. No input, no side effects — hence GET, not POST.
 *
 * `ready: false` means legal hasn't published the general gates yet.
 * The UI should show "not configured", not an empty form that looks
 * like it works.
 */
export function GET() {
  const body: ConfigResponse = {
    version: rules.version,
    ready: publishedGeneralGates.length > 0,
    categories: supportedCategories(),
    generalQuestions,
  };

  return NextResponse.json(body, {
    // rules.json is read at build/import time, so this is safe to cache
    // for the length of a demo. Drop to no-store if legal is editing live.
    headers: { "Cache-Control": "public, max-age=60" },
  });
}