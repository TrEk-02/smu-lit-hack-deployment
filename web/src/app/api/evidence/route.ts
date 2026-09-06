import { NextResponse } from "next/server";
import { EvidenceRequestSchema, type ApiError, type EvidenceFinding, type EvidenceResponse } from "@/lib/api";
import { evaluateCategory, evaluateGeneral } from "@/lib/evaluate";
import { checkableGates, gateById, publishedCategoryGates, publishedGeneralGates } from "@/lib/rules";
import { coerceProposedAnswer } from "@/lib/llm/coerce";
import { LlmBadOutputError, LlmUnavailableError, isStubbed, requestFindings } from "@/lib/llm/openrouter";
import { buildBriefs } from "@/lib/llm/prompt";
import { provenanceByGate } from "@/lib/llm/provenance";
import { rankFindings } from "@/lib/llm/rank";
import { verifyFindings } from "@/lib/llm/verify";
import type { Answers } from "@/lib/types";
import { applicability } from "@/lib/applicability";

/**
 * POST /api/evidence
 *
 * Compares an ingested document against the claimant's own answers.
 *
 * The pipeline, in order (DECISIONS.md §Evidence):
 *   1. Zod parse the model output      (inside requestFindings)
 *   2. Quote verification              — unmatched findings dropped, counted
 *   3. Coerce proposedAnswer           — to the gate's answerType, or drop it
 *   4. Join source + explanation       — by gateId, never generated
 *   5. Route by onContradiction        — CORRECT offers a fix, ESCALATE doesn't
 *
 * No verdict is written here. The model proposes; evaluate() decides.
 */
export async function POST(req: Request) {
  // ---- Validate at the boundary -----------------------------------
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json<ApiError>({ error: "Body must be valid JSON" }, 400);
  }

  const parsed = EvidenceRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return json<ApiError>({ error: "Invalid request", detail: parsed.error.flatten() }, 400);
  }
  const { generalAnswers, categoryId, categoryAnswers, docs } = parsed.data;

  // One flat view: gates are keyed by field, and a field is a field.
  const answers: Answers = { ...(categoryAnswers ?? {}), ...generalAnswers };

  // ---- What is worth asking about ---------------------------------
  const gates = checkableGates(categoryId).filter((gate) =>
    applicability(gate.appliesWhen, gate.scope === "general" ? generalAnswers : categoryAnswers ?? {}) === "APPLIES"
  );
  const allowedGateIds = new Set(gates.map((gate) => gate.id));
  if (gates.length === 0) {
    return json<ApiError>(
      { error: "No gates in this claim type have been labelled for document checking yet." },
      503
    );
  }

  // Passed gates rank first: a claimant who is confidently wrong hides
  // in the PASS set, which is the whole reason this feature exists.
  const passedGateIds = collectPassedGateIds(generalAnswers, categoryId, categoryAnswers);

  // ---- Ask the model ----------------------------------------------
  const briefs = buildBriefs(gates, answers);
  let output;
  try {
    output = await requestFindings(briefs, docs);
  } catch (error) {
    if (error instanceof LlmUnavailableError) {
      // Unreachable, timed out, or refused for credit/key reasons. We do not
      // know which from here, so the copy does not claim a cause — saying
      // "not configured" when the service merely timed out is a lie to the
      // claimant, and DECISIONS.md §F8 asks these two be distinguishable.
      console.error("[evidence] LLM unavailable:", error.message);
      return json<ApiError>(
        { error: "Document checking could not be reached, so your document was not assessed. Your answers and your eligibility result are unaffected." },
        503
      );
    }
    if (error instanceof LlmBadOutputError) {
      return json<ApiError>(
        { error: "The assistant returned something we could not verify, so nothing is being shown." },
        502
      );
    }
    throw error;
  }

  // ---- 2. Quote verification --------------------------------------
  const { kept, dropped } = verifyFindings(output.findings, docs);
  const ranked = rankFindings(
    kept.filter((finding) => allowedGateIds.has(finding.gateId)),
    passedGateIds
  );

  // ---- 3/4/5. Coerce, join, route ---------------------------------
  const findings: EvidenceFinding[] = [];
  for (const finding of ranked) {
    const gate = gateById(finding.gateId);
    // Belt to the z.enum's braces: a gate id that isn't published is dropped.
    if (!gate || !gate.evidence?.checkable) continue;

    const proposed =
      finding.proposedAnswer === null
        ? null
        : coerceProposedAnswer(finding.proposedAnswer, gate.answerType, gate.options);

    // Two very different things both end up as `proposed === null`: the model
    // declining to propose, and us rejecting what it proposed. Only the second
    // is a problem we can fix, and without this line they are indistinguishable
    // from the outside — which is what made "no correction was offered" hard to
    // diagnose on the WhatsApp threads (DECISIONS.md §F10).
    if (finding.proposedAnswer !== null && proposed === null) {
      console.warn(
        `[evidence] dropped an uncoercible proposal for ${gate.id} (${gate.answerType}):`,
        JSON.stringify(finding.proposedAnswer)
      );
    }

    const escalate = gate.evidence.onContradiction === "ESCALATE";

    findings.push({
      gateId: gate.id,
      field: gate.field,
      question: gate.question,
      kind: finding.kind,
      quote: finding.quote,
      docId: finding.location.docId,
      docName: finding.location.docName,
      page: finding.location.page,
      origin: finding.location.origin,
      // Document text is untrusted input. An injected screed cannot reach the
      // claimant as a wall of text, and cannot claim more than one sentence.
      observation: finding.observation.slice(0, MAX_OBSERVATION_CHARS),
      // A correction is only offered where legal allows one and the value survived coercion.
      proposedAnswer: escalate || !gate.evidence.correctable ? null : proposed,
      correctable: gate.evidence.correctable && !escalate,
      escalate,
      explanation: gate.plainExplanation,
      source: gate.source,
    });
  }

  const checked = gates.map((gate) => ({ gateId: gate.id, question: gate.question }));
  const checkedGateIds = checked.map((entry) => entry.gateId);

  const body: EvidenceResponse = {
    docIds: docs.map((entry) => entry.docId),
    findings,
    unclear: output.unclear
      .filter((item) => allowedGateIds.has(item.gateId))
      .map((item) => ({
        gateId: item.gateId,
        question: gateById(item.gateId)?.question ?? "",
        why: item.why,
      }))
      .filter((item) => item.question !== ""),
    provenance: provenanceByGate(checkedGateIds, ranked),
    droppedFindings: dropped,
    checked,
    stubbed: isStubbed(),
  };

  return json<EvidenceResponse>(body);
}

/**
 * Free model text rendered to the claimant is the one surface a hostile
 * document can reach. Bounded, so it cannot become a payload.
 */
const MAX_OBSERVATION_CHARS = 400;

/** Gate ids that currently PASS, so contradictions against them rank first. */
function collectPassedGateIds(
  generalAnswers: Answers,
  categoryId: string | undefined,
  categoryAnswers: Answers | undefined
): Set<string> {
  const passed = new Set<string>();

  const collect = (results: { gateId: string; outcome: string }[]) => {
    for (const result of results) {
      if (result.outcome === "PASS") passed.add(result.gateId);
    }
  };

  if (publishedGeneralGates.length > 0) {
    collect(evaluateGeneral(generalAnswers, publishedGeneralGates).results);
  }
  if (categoryId && categoryAnswers) {
    const gates = publishedCategoryGates(categoryId);
    if (gates.length > 0) collect(evaluateCategory(categoryId, categoryAnswers, gates).results);
  }

  return passed;
}

function json<T>(body: T, status = 200) {
  return NextResponse.json(body, { status });
}
