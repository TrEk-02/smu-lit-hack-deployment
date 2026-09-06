import { LlmOutputSchema, wireSchema, type LlmOutput } from "./schema";
import { SYSTEM_PROMPT, buildUserPrompt, type GateBrief } from "./prompt";
import type { SourceDoc } from "./verify";

/* ============================================================
 * OPENROUTER TRANSPORT
 *
 * Server-side only — the key never reaches the browser.
 * Model is env-configurable; anthropic/claude-sonnet-5 is the
 * default (verified on OpenRouter: supports json_schema strict
 * structured outputs, $2/$10 per 1M).
 *
 * Note: no `temperature` / `top_p`. Sonnet 5 removed sampling
 * parameters and rejects them. Determinism comes from the strict
 * schema and a constrained prompt.
 * ============================================================ */

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "anthropic/claude-sonnet-5";
// Measured ~30s at default effort, which is both too slow to watch on stage
// and too close to the abort. Low effort suits extract-and-compare work.
const TIMEOUT_MS = 45_000;
const REASONING_EFFORT = "low";

/** Nothing to call — no key configured. Route maps this to 503. */
export class LlmUnavailableError extends Error {}

/** Called it, but what came back could not be trusted. Route maps this to 502. */
export class LlmBadOutputError extends Error {}

/** Stub when there is no key, or when LLM_STUB is set for rehearsal. */
export function isStubbed(): boolean {
  return process.env.LLM_STUB === "1" || !process.env.OPENROUTER_API_KEY;
}

/**
 * A stub that quotes the real document, so the whole pipeline —
 * including quote verification — runs honestly with no network.
 * Fabricating a quote here would make the stub demo show nothing,
 * because verification would correctly drop it.
 */
function stubOutput(briefs: GateBrief[], docs: SourceDoc[]): LlmOutput {
  const firstPage = docs.flatMap((doc) => doc.pages).find((page) => page.text.trim().length > 0);
  const target = briefs[0];
  if (!firstPage || !target) return { findings: [], unclear: [] };

  const quote = firstPage.text.trim().split(/\s+/).slice(0, 12).join(" ");

  return {
    findings: [
      {
        gateId: target.id,
        kind: "CONTRADICTS",
        quote,
        page: firstPage.page,
        observation: `This document does not appear to match your answer to "${target.question}".`,
        proposedAnswer: null,
      },
    ],
    unclear: briefs[1]
      ? [{ gateId: briefs[1].id, why: "The document is ambiguous on this point." }]
      : [],
  };
}

export async function requestFindings(briefs: GateBrief[], docs: SourceDoc[]): Promise<LlmOutput> {
  if (isStubbed()) return stubOutput(briefs, docs);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new LlmUnavailableError("OPENROUTER_API_KEY is not set");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "SCT pre-filing guide (SMU LIT Hackathon)",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL,
        reasoning: { effort: REASONING_EFFORT },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(briefs, docs) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "evidence_findings", strict: true, schema: wireSchema() },
        },
      }),
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "timed out" : "unreachable";
    throw new LlmUnavailableError(`OpenRouter ${reason}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    // 401/402 are configuration or credit problems, not bad model output.
    const Failure = response.status === 401 || response.status === 402 ? LlmUnavailableError : LlmBadOutputError;
    throw new Failure(`OpenRouter returned ${response.status}: ${detail.slice(0, 300)}`);
  }

  const body = await response.json().catch(() => null);
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new LlmBadOutputError("no message content in response");

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new LlmBadOutputError("model response was not valid JSON");
  }

  const result = LlmOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new LlmBadOutputError(`model response did not match the contract: ${result.error.message.slice(0, 300)}`);
  }
  return result.data;
}
