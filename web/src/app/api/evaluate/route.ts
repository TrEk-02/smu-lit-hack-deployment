import { GeneralAnswersSchema, GeneralVerdictSchema } from "@/lib/types";
import { evaluateGeneral } from "@/lib/evaluate";

// Phase 1 only: accepts GeneralAnswers directly and returns GeneralVerdict.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { code: "INVALID_JSON", error: "Send a valid JSON request body." },
      { status: 400 },
    );
  }

  const parsed = GeneralAnswersSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        code: "INVALID_ANSWERS",
        error: "Please check your answers.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  // The loader currently rejects the draft JSON. Load it inside the handler
  // so unfinished rules cannot break route loading or bypass input validation.
  let generalRules;
  try {
    ({ generalRules } = await import("@/lib/rules"));
  } catch {
    return Response.json(
      {
        code: "RULES_UNAVAILABLE",
        error: "Eligibility rules are not ready. Your claim has not been assessed.",
      },
      { status: 503 },
    );
  }

  try {
    const verdict = GeneralVerdictSchema.safeParse(
      evaluateGeneral(parsed.data, generalRules),
    );
    if (!verdict.success) {
      return Response.json(
        { code: "INVALID_VERDICT", error: "Unable to verify the eligibility result. Please try again later." },
        { status: 500 },
      );
    }
    return Response.json(verdict.data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    // The explicit error comes from Dev A's current placeholder evaluator.
    if (error instanceof Error && error.message === "not implemented") {
      return Response.json(
        { code: "EVALUATOR_UNAVAILABLE", error: "Eligibility checking is not ready. Your claim has not been assessed." },
        { status: 503 },
      );
    }
    return Response.json(
      { code: "EVALUATION_FAILED", error: "Unable to check eligibility right now. Please try again later." },
      { status: 500 },
    );
  }
}
