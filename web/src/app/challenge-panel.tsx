"use client";

import { useState } from "react";
import { AnswerInput } from "./answer-input";
import { isMismatch, type ChallengeQuestion } from "@/lib/challenge";
import type { Answers, AnswerValue } from "@/lib/types";
import { applicability } from "@/lib/applicability";

/*
 * ------------------------------------------------------------
 * The challenge round.
 *
 * Bounded, gate-anchored, finite — one question at a time from a
 * queue fixed before the round starts, so it provably ends.
 *
 * Non-negotiables encoded here:
 *  - Reject is always available and always ends that question.
 *  - "I don't know" is a valid answer, not a forced guess.
 *  - Every document-driven question shows its verified quote.
 *  - Copy questions the match, never accuses the claimant.
 *  - Nothing here writes a verdict; confirmed answers go back
 *    through evaluate() (DECISIONS.md §Challenge round).
 * ------------------------------------------------------------
 */

export type ChallengeOutcome =
  | { type: "CONFIRMED"; question: ChallengeQuestion; value: AnswerValue }
  | { type: "REJECTED"; question: ChallengeQuestion }
  | { type: "UNKNOWN"; question: ChallengeQuestion }
  | { type: "ANSWERED"; question: ChallengeQuestion; value: AnswerValue };

type Props = {
  generalAnswers: Answers;
  categoryAnswers: Answers;
  questions: ChallengeQuestion[];
  /** Applied as each question is answered, so the verdict moves live. */
  onOutcome: (outcome: ChallengeOutcome) => Promise<void>;
  onFinish: () => void;
  /** Rendered above the question so a changing verdict is visible in place. */
  verdictBanner?: React.ReactNode;
};

export default function ChallengePanel({ generalAnswers, categoryAnswers, questions, onOutcome, onFinish, verdictBanner }: Props) {
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<AnswerValue>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeIndex = questions.findIndex((candidate, candidateIndex) =>
    candidateIndex >= index && applicability(candidate.appliesWhen,
      candidate.scope === "general" ? generalAnswers : categoryAnswers) === "APPLIES"
  );
  const question = questions[activeIndex];
  const done = activeIndex === -1;

  async function advance(outcome: ChallengeOutcome) {
    try {
      setSaving(true);
      setError(null);
      await onOutcome(outcome);
      setDraft(null);
      setIndex(activeIndex + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save your answer. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <section className="panel">
        <p className="eyebrow">CHECKING YOUR ANSWERS · DONE</p>
        <h1>Thanks — that&apos;s everything we wanted to ask.</h1>
        <p className="intro">
          Your answers have been re-checked against the eligibility rules. Where you
          stood by an answer we disagreed with, we have kept your answer and noted the
          disagreement for whoever looks at this next — your account and your document
          both stay on the record.
        </p>
        <p className="hint">If a correction introduced a new eligibility question, use Edit answers on your review to complete it.</p>
        <div className="actions">
          <button onClick={onFinish}>See your updated result →</button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <p className="eyebrow">
        CHECKING YOUR ANSWERS · {activeIndex + 1} OF {questions.length}
      </p>

      <h1>{headline(question)}</h1>

      {/* The ranking is deliberate, so say so. Without this the round reads as
          arbitrary, which is the fastest way to lose the point of it. */}
      <p className="intro">{whyAsking(question)}</p>

      {verdictBanner}

      <article className="gate-result">
        <div className="gate-header">
          <strong>{question.prompt}</strong>
        </div>

        {/* Every document-driven question shows its verified quote.
            No quote, no question — it was dropped at verification. */}
        {question.evidence && (
          <>
            <p>{question.evidence.observation}</p>
            <blockquote className="quote">
              “{question.evidence.quote}”
              <cite>
                {question.evidence.docName || "your document"}, page {question.evidence.page}
              </cite>
            </blockquote>
          </>
        )}

        <div className="status-row">
          <strong>You told us</strong>
          <span>{question.currentAnswerLabel}</span>
        </div>

        {question.proposedAnswerLabel && (
          <div className="status-row">
            <strong>Your document suggests</strong>
            <span>{question.proposedAnswerLabel}</span>
          </div>
        )}

        {error && <div className="error" role="alert">{error}</div>}
        <fieldset disabled={saving} className="challenge-responses">
          {renderResponses()}
        </fieldset>
        {saving && <p role="status">Re-checking your answers...</p>}

        <div className="source">
          <strong>Supporting provision</strong>
          <p>
            {question.source.title}
            {question.source.provision ? ` · ${question.source.provision}` : ""}
          </p>
        </div>
      </article>
    </section>
  );

  function renderResponses() {
    // A judgement call: no correction is offered, so there is nothing to confirm.
    if (question.kind === "ESCALATED") {
      return (
        <>
          <p className="hint">
            We are not going to change your answer on this one — it needs a person&apos;s
            judgement. It will be included in your handoff notes.
          </p>
          <div className="actions">
            <button onClick={() => advance({ type: "REJECTED", question })}>
              Got it — keep my answer
            </button>
          </div>
        </>
      );
    }

    // A document contradicts them and legal allows a correction.
    if (question.kind === "CONFIRM_CORRECTION" && question.proposedAnswer !== null) {
      return (
        <>
          <p className="hint">
            This doesn&apos;t look like it matches what you told us — is your document
            right?
          </p>
          <div className="actions">
            <button
              onClick={() =>
                advance({ type: "CONFIRMED", question, value: question.proposedAnswer! })
              }
            >
              Yes — use my document
            </button>
            <button className="secondary" onClick={() => advance({ type: "REJECTED", question })}>
              No — my answer stands
            </button>
            <button className="secondary" onClick={() => advance({ type: "UNKNOWN", question })}>
              I don&apos;t know
            </button>
          </div>
        </>
      );
    }

    // Unclear, follow-up, or a contradiction with no usable proposal:
    // ask them directly, with the control the gate would normally use.
    return (
      <>
        <div className="field">
          <label htmlFor={`challenge-${question.gateId}`}>Your answer</label>
          <AnswerInput
            question={question}
            value={draft}
            onChange={setDraft}
            id={`challenge-${question.gateId}`}
          />
        </div>
        <div className="actions">
          <button
            disabled={draft === null}
            onClick={() => advance({ type: "ANSWERED", question, value: draft })}
          >
            Save this answer
          </button>
          <button className="secondary" onClick={() => advance({ type: "UNKNOWN", question })}>
            I don&apos;t know
          </button>
        </div>
      </>
    );
  }
}

/** Which of the two groups this question belongs to. */
function groupLabel(question: ChallengeQuestion): string {
  return isMismatch(question.kind) ? "THINGS THAT DON'T MATCH" : "THINGS WE STILL NEED";
}

/**
 * Why this question, in the claimant's terms. The queue is ranked — a
 * contradiction on an answer they passed outranks a blank field — but none of
 * that is visible unless we say it.
 */
function whyAsking(question: ChallengeQuestion): string {
  switch (question.kind) {
    case "CONFIRM_CORRECTION":
      return "We are asking because one of your own documents appears to disagree with what you told us — and you are the only person who can say which is right.";
    case "ESCALATED":
      return "We are asking because your document points the other way, but deciding this needs judgement we are not going to make for you.";
    case "UNCLEAR":
      return "We are asking because your document seemed to touch on this, but not clearly enough for us to tell either way.";
    case "FOLLOW_UP":
      return "We are asking because this part of your claim is still thin or unanswered — it is not a mark against you.";
  }
}

/** Framing per question type. Questions the match; never accuses. */
function headline(question: ChallengeQuestion): string {
  switch (question.kind) {
    case "CONFIRM_CORRECTION":
      return "This doesn't look like it matches";
    case "ESCALATED":
      return "This one needs a person to look at it";
    case "UNCLEAR":
      return "We couldn't tell from your document";
    case "FOLLOW_UP":
      return "One more thing we need to ask";
  }
}
