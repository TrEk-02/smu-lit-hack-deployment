"use client";

import { useState } from "react";
import type { EvidenceFinding, EvidenceResponse } from "@/lib/api";
import type { Answers } from "@/lib/types";

type ExtractedDoc = {
  docId: string;
  name: string;
  pages: { page: number; text: string }[];
};

const MAX_DOCS = 5;

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
 * Evidence layer (Sprint 2 Feature 2; Sprint 3 F3 + F7)
 *
 * Two steps, deliberately separate: ingest shows the claimant
 * exactly what text was read before anything is sent to a model,
 * then the check compares that text against their own answers.
 *
 * Contradictions lead; corroborations are collapsed behind them.
 * Agreeing with the claimant is reassurance, never the headline.
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
  const [docs, setDocs] = useState<ExtractedDoc[]>([]);

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
      setDocs(data.docs as ExtractedDoc[]);
    } catch (err) {
      setDocs([]);
      setError(err instanceof Error ? err.message : "That document could not be read.");
    } finally {
      setReading(false);
    }
  }

  function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (files.length > MAX_DOCS) {
      setError(`You can upload up to ${MAX_DOCS} documents at a time. You selected ${files.length}.`);
      return;
    }
    const body = new FormData();
    for (const file of Array.from(files)) body.append("file", file);
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
    if (docs.length === 0) return;

    try {
      setChecking(true);
      setError(null);

      const response = await fetch("/api/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ generalAnswers, categoryId, categoryAnswers, docs }),
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error ?? "Your documents could not be checked.");
      onResult(data as EvidenceResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your documents could not be checked.");
    } finally {
      setChecking(false);
    }
  }

  const contradictions = result?.findings.filter((f) => f.kind === "CONTRADICTS") ?? [];
  const corroborations = result?.findings.filter((f) => f.kind === "CORROBORATES") ?? [];
  const pageCount = docs.reduce((total, doc) => total + doc.pages.length, 0);

  return (
    <section className="panel">
      <p className="eyebrow">YOUR DOCUMENTS · CHECKING YOUR ANSWERS</p>

      <h1>Do your documents agree with you?</h1>

      <p className="intro">
        Your answers so far are your own account. This checks them against your documents —
        and tells you where the two do not match. Nothing here changes your eligibility
        result.
      </p>

      {error && <div className="error">{error}</div>}

      {/* ---- Step 1: get the text ---- */}
      <div className="field">
        <label htmlFor="evidence-file">Upload up to {MAX_DOCS} PDFs</label>
        <input
          id="evidence-file"
          type="file"
          accept="application/pdf"
          multiple
          disabled={reading}
          onChange={(event) => onFiles(event.target.files)}
        />
        <p className="hint">
          Text-based PDFs only — a scan or a photo has no text to read. Select all of them
          at once. Your files are not stored: the text is extracted and the files are
          discarded.
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
      {docs.length > 0 && (
        <div className="results">
          <h2>What we read</h2>

          {docs.map((doc) => (
            <div className="status-row" key={doc.docId}>
              <strong>{doc.name}</strong>
              <span>
                {doc.pages.length} page{doc.pages.length === 1 ? "" : "s"} of text
              </span>
            </div>
          ))}

          <p className="hint">
            This text — {pageCount} page{pageCount === 1 ? "" : "s"} across{" "}
            {docs.length} document{docs.length === 1 ? "" : "s"}, and nothing else about
            your claim — is what gets checked.
          </p>

          <button type="button" disabled={checking} onClick={check}>
            {checking ? "Checking your documents…" : "Check against my answers →"}
          </button>
        </div>
      )}

      {/* ---- Step 3: findings, contradictions first ---- */}
      {result && (
        <div className="results">
          <h2>What your documents show</h2>

          {result.stubbed && (
            <div className="warning">
              Demo fixture — these findings are pre-recorded, not a live assessment.
            </div>
          )}

          <p className="intro">
            {contradictions.length > 0
              ? `${contradictions.length} thing${contradictions.length === 1 ? " does" : "s do"} not match what you told us.`
              : "Nothing in your documents contradicts your answers."}
          </p>

          {result.droppedFindings > 0 && (
            <div className="notice">
              {result.droppedFindings} suggested finding
              {result.droppedFindings === 1 ? " was" : "s were"} discarded because the
              quoted words could not be found in your documents.
            </div>
          )}

          {result.findings.length === 0 && (
            <p>
              We could not verify anything in these documents against your answers. That is
              not the same as your answers being right — try a document that speaks
              directly to the points above.
            </p>
          )}

          {contradictions.map((finding) => (
            <FindingCard key={`${finding.gateId}-${finding.quote}`} finding={finding} />
          ))}

          {/* Reassurance, collapsed: it should never outweigh the mismatches. */}
          {corroborations.length > 0 && (
            <details className="collapsible">
              <summary>
                {corroborations.length} thing{corroborations.length === 1 ? "" : "s"} your
                documents back up
              </summary>
              {corroborations.map((finding) => (
                <FindingCard key={`${finding.gateId}-${finding.quote}`} finding={finding} />
              ))}
            </details>
          )}

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
        <cite>
          {finding.docName}, page {finding.page}
        </cite>
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
