"use client";

import { useState } from "react";
import type { EvidenceFinding, EvidenceResponse } from "@/lib/api";
import type { Answers } from "@/lib/types";

type ExtractedDoc = {
  docId: string;
  name: string;
  pages: { page: number; text: string }[];
};

type Props = {
  generalAnswers: Answers;
  categoryId: string;
  categoryAnswers: Answers;
  /** Owned by the page: the challenge round and the review screen both need it. */
  result: EvidenceResponse | null;
  onResult: (result: EvidenceResponse | null) => void;
  onChallenge: () => void;
  preparing: boolean;
  onBack: () => void;
};

/*
 * ------------------------------------------------------------
 * Evidence layer (Sprint 2, Feature 2)
 *
 * Two steps, deliberately separate: ingest shows the claimant
 * exactly what text was read before anything is sent to a model,
 * then the check compares that text against their own answers.
 *
 * Nothing here writes a verdict. Findings are proposals.
 * ------------------------------------------------------------
 */
export default function EvidencePanel({
  generalAnswers,
  categoryId,
  categoryAnswers,
  result,
  onResult,
  onChallenge,
  preparing,
  onBack,
}: Props) {
  const [pasted, setPasted] = useState("");
  const [doc, setDoc] = useState<ExtractedDoc | null>(null);

  const [reading, setReading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ingest(body: FormData) {
    try {
      setReading(true);
      setError(null);
      onResult(null);

      const response = await fetch("/api/ingest", { method: "POST", body });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error ?? "That document could not be read.");
      setDoc(data as ExtractedDoc);
    } catch (err) {
      setDoc(null);
      setError(err instanceof Error ? err.message : "That document could not be read.");
    } finally {
      setReading(false);
    }
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    const body = new FormData();
    body.append("file", file);
    ingest(body);
  }

  function onPaste() {
    if (!pasted.trim()) {
      setError("Paste some text first.");
      return;
    }
    const body = new FormData();
    body.append("text", pasted);
    ingest(body);
  }

  async function check() {
    if (!doc) return;

    try {
      setChecking(true);
      setError(null);

      const response = await fetch("/api/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generalAnswers, categoryId, categoryAnswers, doc }),
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error ?? "Your document could not be checked.");
      onResult(data as EvidenceResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your document could not be checked.");
    } finally {
      setChecking(false);
    }
  }

  const contradictions = result?.findings.filter((f) => f.kind === "CONTRADICTS") ?? [];

  return (
    <section className="panel">
      <p className="eyebrow">YOUR DOCUMENTS · CHECKING YOUR ANSWERS</p>

      <h1>Do your documents agree with you?</h1>

      <p className="intro">
        Your answers so far are your own account. This checks them against a document —
        and tells you where the two do not match. Nothing here changes your eligibility
        result.
      </p>

      {error && <div className="error">{error}</div>}

      {/* ---- Step 1: get the text ---- */}
      <div className="field">
        <label htmlFor="evidence-file">Upload a PDF</label>
        <input
          id="evidence-file"
          type="file"
          accept="application/pdf"
          disabled={reading}
          onChange={(event) => onFile(event.target.files?.[0])}
        />
        <p className="hint">
          Text-based PDFs only — a scan or a photo has no text to read. Your file is not
          stored: the text is extracted and the file is discarded.
        </p>
      </div>

      <div className="field">
        <label htmlFor="evidence-text">Or paste the text</label>
        <textarea
          id="evidence-text"
          rows={5}
          value={pasted}
          placeholder="Paste an invoice, quotation, contract or message thread…"
          onChange={(event) => setPasted(event.target.value)}
        />
        <button type="button" className="secondary" disabled={reading} onClick={onPaste}>
          {reading ? "Reading…" : "Use this text"}
        </button>
      </div>

      {/* ---- Step 2: show what we read, then check it ---- */}
      {doc && (
        <div className="results">
          <h2>What we read</h2>

          <div className="status-row">
            <strong>{doc.name}</strong>
            <span>
              {doc.pages.length} page{doc.pages.length === 1 ? "" : "s"} of text
            </span>
          </div>

          <p className="hint">
            This text — and nothing else about your claim — is what gets checked.
          </p>

          <button type="button" disabled={checking} onClick={check}>
            {checking ? "Checking your document…" : "Check against my answers →"}
          </button>
        </div>
      )}

      {/* ---- Step 3: findings ---- */}
      {result && (
        <div className="results">
          <h2>What your document shows</h2>

          {result.stubbed && (
            <div className="warning">
              Demo fixture — these findings are pre-recorded, not a live assessment.
            </div>
          )}

          <p className="intro">
            {contradictions.length > 0
              ? `${contradictions.length} thing${contradictions.length === 1 ? " does" : "s do"} not match what you told us.`
              : "Nothing in this document contradicts your answers."}
          </p>

          {result.droppedFindings > 0 && (
            <div className="notice">
              {result.droppedFindings} suggested finding
              {result.droppedFindings === 1 ? " was" : "s were"} discarded because the
              quoted words could not be found in your document.
            </div>
          )}

          {result.findings.length === 0 && (
            <p>
              We could not verify anything in this document against your answers. That is
              not the same as your answers being right — try a document that speaks
              directly to the points above.
            </p>
          )}

          {result.findings.map((finding) => (
            <FindingCard key={`${finding.gateId}-${finding.quote}`} finding={finding} />
          ))}

          {result.unclear.length > 0 && (
            <div className="follow-ups">
              <h3>Could not tell</h3>
              {result.unclear.map((item) => (
                <div key={item.gateId} className="follow-up">
                  <strong>{item.question}</strong>
                  <p>{item.why}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="actions">
        {/* A contradiction that changes nothing is just a red box. The round
            is offered whether or not a document produced findings — weak and
            unanswered gates always have something worth asking. */}
        {result && (
          <button type="button" disabled={preparing} onClick={onChallenge}>
            {preparing ? "Preparing…" : "Answer our questions →"}
          </button>
        )}

        <button type="button" className="secondary" onClick={onBack}>
          Back to review
        </button>
      </div>
    </section>
  );
}

function FindingCard({ finding }: { finding: EvidenceFinding }) {
  const contradicts = finding.kind === "CONTRADICTS";

  return (
    <article className="gate-result">
      <div className="gate-header">
        <strong>{finding.question}</strong>
        <span className={contradicts ? "badge badge-contradicts" : "badge badge-corroborates"}>
          {contradicts ? "Contradicted" : "Corroborated"}
        </span>
      </div>

      <p>{finding.observation}</p>

      {/* No quote, no finding — it was dropped at verification. */}
      <blockquote className="quote">
        “{finding.quote}”
        <cite>your document, page {finding.page}</cite>
      </blockquote>

      {finding.proposedAnswer !== null && (
        <p className="hint">
          Your document suggests this answer should be:{" "}
          <strong>{String(finding.proposedAnswer)}</strong>. You will be asked to confirm
          or reject this — it has not been changed.
        </p>
      )}

      {finding.escalate && (
        <p className="hint">
          This one is a judgement call, so no correction is offered. It goes into your
          handoff notes for a person to look at.
        </p>
      )}

      <div className="source">
        <strong>Supporting provision</strong>
        <p>
          {finding.source.title}
          {finding.source.provision ? ` · ${finding.source.provision}` : ""}
        </p>
      </div>
    </article>
  );
}
