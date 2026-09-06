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

/* ============================================================
 * TRANSCRIPTION — a deliberately separate call.
 *
 * Screenshots (WhatsApp threads, most often) have no text layer,
 * so there is nothing to extract mechanically. The text has to
 * be produced. This covers two shapes of the same problem: an
 * image file, and an image-only PDF — which is what you get when
 * someone exports or prints a chat thread, and is by far the
 * commoner of the two in practice.
 *
 * That is a problem for quote verification. Its guarantee holds
 * because the document text comes from a source independent of
 * the model: the model cannot fake a quote into text it did not
 * write. If one call both transcribed the image AND generated
 * findings against it, the check would be circular — the model
 * marking its own homework, while knowing exactly what would be
 * convenient to find.
 *
 * So the duties are split. This call is given the image and
 * nothing else: no gates, no answers, no claim, no idea what the
 * case needs. It transcribes and stops. The findings call then
 * runs over the transcript as ordinary text, unchanged.
 *
 * This is weaker than a text-layer PDF and we say so in the UI —
 * a transcript is a reading of an image, and the claimant is
 * shown it so they can catch a misreading before it is used.
 * ============================================================ */

const TRANSCRIBE_PROMPT = `You transcribe images of documents and chat threads.

Rules:
- Output the text you can see, verbatim. Nothing else.
- For a chat screenshot, keep every message on its own line, in order, as:
  [time] Sender: message
  Use the sender name exactly as shown. Who said what is the whole point —
  never merge, reattribute, or summarise messages.
- Keep timestamps, dates, amounts and reference numbers exactly as written.
- Do not correct spelling, expand abbreviations, translate, or tidy grammar.
- Do not describe the image, add commentary, or explain anything.
- Never guess at text that is cut off, blurred, or covered. Write [unreadable].
- If you can read no text at all, output nothing.`;

/** Image types we accept. A PDF gets here only after its text layer comes up empty. */
export const TRANSCRIBABLE_MIME = ["image/png", "image/jpeg", "image/webp"] as const;

/**
 * The content part for one document. Images go as `image_url`; PDFs go as a
 * `file` part, which the model reads natively — page by page, as images. That
 * saves us extracting the embedded bitmap out of the PDF or shipping a
 * rasteriser, and it handles a multi-page export for free.
 */
function contentPart(base64: string, mime: string, name: string) {
  return mime === "application/pdf"
    ? { type: "file", file: { filename: name, file_data: `data:application/pdf;base64,${base64}` } }
    : { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } };
}

/**
 * A transcript for a stubbed run — a short WhatsApp thread, so the demo path
 * exercises ingestion, verification and the findings call with no key set.
 */
function stubTranscript(): string {
  return [
    "[10:14] Me: Hi, just checking on the order — it was meant to arrive last Friday.",
    "[10:31] Supplier: Sorry for the delay. We'll get it to you this week.",
    "[10:32] Me: That's the second time. Can you confirm the agreed price still stands?",
    "[11:02] Supplier: We never agreed a fixed price for this one, it was supplied free of charge as a sample.",
  ].join("\n");
}

export async function transcribeDocument(
  base64: string,
  mime: string,
  name: string
): Promise<string> {
  if (isStubbed()) return stubTranscript();

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
        // No `reasoning` here, deliberately. Setting it to "low" was measured
        // against the findings call's precedent and bought nothing — 8.3s
        // either way, because this call is output-token-bound, not thinking-
        // bound (29 reasoning tokens on a 550-token transcript). It did appear
        // to cost fidelity: the sender came back as "Jasmine" rather than
        // "Jasmine (Huat Huat Huat)", and who the respondent is matters.
        messages: [
          { role: "system", content: TRANSCRIBE_PROMPT },
          {
            role: "user",
            content: [contentPart(base64, mime, name)],
          },
        ],
      }),
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "timed out" : "unreachable";
    throw new LlmUnavailableError(`OpenRouter ${reason} while transcribing "${name}"`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const Failure = response.status === 401 || response.status === 402 ? LlmUnavailableError : LlmBadOutputError;
    throw new Failure(`OpenRouter returned ${response.status} transcribing "${name}": ${detail.slice(0, 300)}`);
  }

  const body = await response.json().catch(() => null);
  const content = body?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content.trim() : "";
}
