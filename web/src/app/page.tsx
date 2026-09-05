"use client";

import { FormEvent, useEffect, useState } from "react";
import type {
  Disagreement,
  EvaluateResponse,
  EvidenceResponse,
} from "@/lib/api";
import ChallengePanel, { type ChallengeOutcome } from "./challenge-panel";
import EvidencePanel from "./evidence-panel";
import { AnswerInput, type FormQuestion } from "./answer-input";
import type { ChallengeQuestion } from "@/lib/challenge";
import type { Provenance } from "@/lib/llm/provenance";
import { computeFilingFee } from "@/lib/filing-fee";
import type {
  AnswerValue,
  Answers,
  Category,
  PartyQuestion,
  Question,
} from "@/lib/types";

type ConfigResponse = {
  version?: string;
  ready: boolean;
  categories: Category[];
  generalQuestions: Question[];
  partyQuestions: PartyQuestion[];
};

type CategoryConfigResponse = {
  category: Category;
  questions: Question[];
};

type Step = "general" | "category" | "party" | "review" | "evidence" | "challenge";

export default function Home() {
  const [step, setStep] = useState<Step>("general");

  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [categoryConfig, setCategoryConfig] =
    useState<CategoryConfigResponse | null>(null);

  const [answers, setAnswers] = useState<Answers>({});
  const [categoryAnswers, setCategoryAnswers] = useState<Answers>({});
  const [partyAnswers, setPartyAnswers] = useState<Answers>({});

  const [selectedCategory, setSelectedCategory] = useState("");

  const [verdict, setVerdict] = useState<EvaluateResponse | null>(null);

  /*
   * Evidence + challenge state lives here, not in the panels: the challenge
   * round consumes the findings, and the review screen shows the provenance
   * badges, so both outlive the panel that produced them.
   */
  const [evidenceResult, setEvidenceResult] = useState<EvidenceResponse | null>(null);
  const [challengeQuestions, setChallengeQuestions] = useState<ChallengeQuestion[]>([]);
  const [disagreements, setDisagreements] = useState<Disagreement[]>([]);
  const [verdictChanged, setVerdictChanged] = useState(false);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * ------------------------------------------------------------
   * Load the general configuration
   * ------------------------------------------------------------
   */

  useEffect(() => {
    async function loadConfig() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch("/api/config");

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error ?? "Unable to load configuration");
        }

        setConfig(data);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load configuration"
        );
      } finally {
        setLoading(false);
      }
    }

    loadConfig();
  }, []);

  /*
   * ------------------------------------------------------------
   * Generic answer handling
   * ------------------------------------------------------------
   */

  function updateAnswer(
    setter: React.Dispatch<React.SetStateAction<Answers>>,
    field: string,
    value: string | number | boolean | null
  ) {
    setter((previous) => ({
      ...previous,
      [field]: value,
    }));
  }

  /*
   * ------------------------------------------------------------
   * Render one question. The input itself lives in AnswerInput so
   * the challenge round asks a gate the same way this form does.
   * ------------------------------------------------------------
   */

  function renderQuestion(
    question: FormQuestion & { question: string },
    currentAnswers: Answers,
    setter: React.Dispatch<React.SetStateAction<Answers>>
  ) {
    return (
      <div className="field" key={question.field}>
        <label htmlFor={question.field}>{question.question}</label>

        <AnswerInput
          question={question}
          value={currentAnswers[question.field]}
          onChange={(value) => updateAnswer(setter, question.field, value)}
        />
      </div>
    );
  }

  /*
   * ------------------------------------------------------------
   * Phase 1 — General evaluation
   * ------------------------------------------------------------
   */

  async function submitGeneral(event: FormEvent) {
    event.preventDefault();

    try {
      setSubmitting(true);
      setError(null);

      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          generalAnswers: answers,
        }),
      });

      const data: EvaluateResponse | { error?: string } =
        await response.json();

      if (!response.ok) {
        throw new Error(
          "error" in data && data.error
            ? data.error
            : "Evaluation failed"
        );
      }

      const result = data as EvaluateResponse;

      setVerdict(result);

      /*
       * General phase is incomplete.
       * Stay on this page so the user can answer missing
       * questions.
       */
      if (result.nextStep === "ANSWER_FOLLOW_UPS") {
        return;
      }

      /*
       * General phase passed.
       * Now the user chooses a supported category.
       */
      if (result.nextStep === "CHOOSE_CATEGORY") {
        setStep("category");
        return;
      }

      /*
       * In case the backend decides the process should stop
       * immediately.
       */
      setStep("review");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong"
      );
    } finally {
      setSubmitting(false);
    }
  }

  /*
   * ------------------------------------------------------------
   * Load category-specific questions
   * ------------------------------------------------------------
   */

  async function loadCategory(categoryId: string) {
    setSelectedCategory(categoryId);
    setCategoryConfig(null);
    setCategoryAnswers({});
    setError(null);

    if (!categoryId) {
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(
        `/api/config/${encodeURIComponent(categoryId)}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ?? "Unable to load category"
        );
      }

      setCategoryConfig(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load category"
      );
    } finally {
      setLoading(false);
    }
  }

  /*
   * ------------------------------------------------------------
   * Phase 2 — Category evaluation
   * ------------------------------------------------------------
   */

  async function submitCategory(event: FormEvent) {
    event.preventDefault();

    if (!selectedCategory) {
      setError("Please select a category.");
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          generalAnswers: answers,
          categoryId: selectedCategory,
          categoryAnswers,
        }),
      });

      const data: EvaluateResponse | { error?: string } =
        await response.json();

      if (!response.ok) {
        throw new Error(
          "error" in data && data.error
            ? data.error
            : "Evaluation failed"
        );
      }

      const result = data as EvaluateResponse;

      setVerdict(result);

      /*
       * Only move on to party & filing details once the category
       * phase has actually cleared — DECISIONS.md's Sprint 2 feature
       * is gated on "if Sprint 1 form passes". If it's still
       * incomplete, stay here so the claimant can fix their answers.
       */
      if (result.nextStep === "COMPLETE") {
        setStep("party");
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong"
      );
    } finally {
      setSubmitting(false);
    }
  }

  /*
   * ------------------------------------------------------------
   * Party & filing details (Sprint 2) — pure data capture, no
   * eligibility gates. Recorded directly into partyAnswers and
   * shown on review; never sent to /api/evaluate.
   * ------------------------------------------------------------
   */

  function partyFieldVisible(question: PartyQuestion): boolean {
    if (!question.dependsOn) return true;
    return partyAnswers[question.dependsOn.field] === question.dependsOn.value;
  }

  const filingAs = partyAnswers.filingAs;
  const claimAmount = answers.claimAmount;
  const filingFee =
    typeof claimAmount === "number" &&
    (filingAs === "individual" || filingAs === "entity")
      ? computeFilingFee(claimAmount, filingAs)
      : null;

  /*
   * ------------------------------------------------------------
   * Reset
   * ------------------------------------------------------------
   */

  function startOver() {
    setStep("general");
    setAnswers({});
    setCategoryAnswers({});
    setPartyAnswers({});
    setSelectedCategory("");
    setCategoryConfig(null);
    setVerdict(null);
    setEvidenceResult(null);
    setChallengeQuestions([]);
    setDisagreements([]);
    setVerdictChanged(false);
    setError(null);
  }

  /*
   * ------------------------------------------------------------
   * Loading state
   * ------------------------------------------------------------
   */

  if (loading && !config) {
    return (
      <main className="shell">
        <div className="panel">
          <p>Loading eligibility questions...</p>
        </div>
      </main>
    );
  }

  /*
   * ------------------------------------------------------------
   * Error state
   * ------------------------------------------------------------
   */

  if (error && !config) {
    return (
      <main className="shell">
        <div className="panel">
          <h1>Unable to load the assessment</h1>
          <p>{error}</p>
          <button onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </main>
    );
  }

  /*
   * ------------------------------------------------------------
   * CHALLENGE ROUND (Sprint 2, Feature 3)
   *
   * The model proposed; the engine decides. A confirmed correction
   * is merged into answers{} and evaluate() is re-run, so the
   * verdict moves in front of the claimant. A rejected one keeps
   * their answer and records the disagreement for the handoff.
   * ------------------------------------------------------------
   */

  async function startChallenge() {
    try {
      setSubmitting(true);
      setError(null);

      const response = await fetch("/api/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generalAnswers: answers,
          categoryId: selectedCategory,
          categoryAnswers,
          findings: evidenceResult?.findings ?? [],
          unclear: evidenceResult?.unclear ?? [],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not prepare the questions.");

      setChallengeQuestions(data.questions);
      setVerdictChanged(false);
      setStep("challenge");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not prepare the questions.");
    } finally {
      setSubmitting(false);
    }
  }

  /** Re-run the deterministic engine over the corrected answers. */
  async function reEvaluate(nextGeneral: Answers, nextCategory: Answers) {
    const before = verdict?.category?.status ?? verdict?.general.status;

    const response = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generalAnswers: nextGeneral,
        categoryId: selectedCategory,
        categoryAnswers: nextCategory,
      }),
    });
    const data = await response.json();
    if (!response.ok) return;

    const next = data as EvaluateResponse;
    setVerdict(next);

    const after = next.category?.status ?? next.general.status;
    if (before && after !== before) setVerdictChanged(true);
  }

  function applyOutcome(outcome: ChallengeOutcome) {
    const { question } = outcome;

    // Where a confirmed answer lands depends on which phase owns the gate.
    const writeAnswer = (value: AnswerValue) => {
      const next =
        question.scope === "general"
          ? { general: { ...answers, [question.field]: value }, category: categoryAnswers }
          : { general: answers, category: { ...categoryAnswers, [question.field]: value } };

      if (question.scope === "general") setAnswers(next.general);
      else setCategoryAnswers(next.category);

      reEvaluate(next.general, next.category);
    };

    switch (outcome.type) {
      case "CONFIRMED":
      case "ANSWERED":
        writeAnswer(outcome.value);
        break;

      case "UNKNOWN":
        // null is "they said they don't know" — MISSING, never a false clearance.
        writeAnswer(null);
        break;

      case "REJECTED":
        // Their answer stands. We do not silently drop a verified contradiction:
        // a real person should see both sides (DECISIONS.md §Challenge round).
        if (question.evidence) {
          setDisagreements((previous) => [
            ...previous,
            {
              gateId: question.gateId,
              question: question.prompt,
              claimantAnswer: question.currentAnswerLabel,
              observation: question.evidence!.observation,
              quote: question.evidence!.quote,
              page: question.evidence!.page,
              reason: question.kind === "ESCALATED" ? "ESCALATED" : "REJECTED",
            },
          ]);
        }
        break;
    }
  }

  if (step === "challenge") {
    return (
      <main className="shell">
        <header className="brand">
          <strong>Claim guide</strong>
          <span>Hackathon prototype</span>
        </header>

        <nav className="steps">
          <span>01 General details</span>
          <span>02 Claim category</span>
          <span>03 Party &amp; filing</span>
          <span>04 Review</span>
          <span>05 Your documents</span>
          <span className="active">06 Your answers</span>
        </nav>

        <ChallengePanel
          questions={challengeQuestions}
          onOutcome={applyOutcome}
          onFinish={() => setStep("review")}
          verdictBanner={
            verdictChanged && verdict ? (
              <div className="warning">
                Your eligibility result changed to{" "}
                <strong>{verdict.category?.status ?? verdict.general.status}</strong> based
                on what you just confirmed.
              </div>
            ) : null
          }
        />

        <footer>
          Independent student prototype · Not an official court service
        </footer>
      </main>
    );
  }

  /*
   * ------------------------------------------------------------
   * REVIEW
   * ------------------------------------------------------------
   */

  if (step === "review" && verdict) {
    return (
      <main className="shell">
        <header className="brand">
          <strong>Claim guide</strong>
          <span>Hackathon prototype</span>
        </header>

        <nav className="steps">
          <span>01 Claim details</span>
          <span>02 Claim category</span>
          <span>03 Party &amp; filing</span>
          <span className="active">04 Review</span>
          <span>05 Your documents</span>
          <span>06 Your answers</span>
        </nav>

        <section className="panel">
          <p className="eyebrow">
            YOUR REVIEW · ASSESSMENT RESULT
          </p>

          <h1>Review your claim</h1>

          {verdictChanged && (
            <div className="warning">
              This result changed after you answered our questions — it is not the
              result you saw before.
            </div>
          )}

          <div className="verdict">
            <div className="badge">
              {verdict.category
                ? verdict.category.status
                : verdict.general.status}
            </div>

            <h2>
              {getStatusHeading(
                verdict.category?.status ??
                  verdict.general.status
              )}
            </h2>

            <p>
              {getStatusDescription(
                verdict.category?.status ??
                  verdict.general.status
              )}
            </p>
          </div>

          <ResultPhase
            title="General eligibility"
            phase={verdict.general}
          />

          {verdict.category && (
            <ResultPhase
              title="Category-specific eligibility"
              phase={verdict.category}
            />
          )}

          {evidenceResult && (
            <ProvenanceSummary
              evidence={evidenceResult}
              verdict={verdict}
            />
          )}

          {disagreements.length > 0 && (
            <DisagreementSummary disagreements={disagreements} />
          )}

          <PartyDetailsSummary
            partyQuestions={config?.partyQuestions ?? []}
            partyAnswers={partyAnswers}
            claimAmount={claimAmount}
            filingFee={filingFee}
          />

          <div className="actions">
            {verdict.category && !evidenceResult && (
              <button onClick={() => setStep("evidence")}>
                Check my documents →
              </button>
            )}

            {verdict.category && evidenceResult && challengeQuestions.length === 0 && (
              <button disabled={submitting} onClick={startChallenge}>
                {submitting ? "Preparing…" : "Answer our questions →"}
              </button>
            )}

            {evidenceResult && (
              <button className="secondary" onClick={() => setStep("evidence")}>
                Back to documents
              </button>
            )}

            <button
              className="secondary"
              onClick={() => {
                setStep(
                  verdict.category
                    ? "party"
                    : "general"
                );
              }}
            >
              Edit answers
            </button>

            <button
              className="secondary"
              onClick={startOver}
            >
              Start over
            </button>
          </div>
        </section>

        <footer>
          Independent student prototype · Not an official court service
        </footer>
      </main>
    );
  }

  /*
   * ------------------------------------------------------------
   * CATEGORY STEP
   * ------------------------------------------------------------
   */

  if (step === "category") {
    return (
      <main className="shell">
        <header className="brand">
          <strong>Claim guide</strong>
          <span>Hackathon prototype</span>
        </header>

        <nav className="steps">
          <span>01 General details</span>
          <span className="active">
            02 Claim category
          </span>
          <span>03 Party &amp; filing</span>
          <span>04 Review</span>
          <span>05 Your documents</span>
        </nav>

        <section className="panel">
          <p className="eyebrow">
            CLAIM CATEGORY · NEXT STEP
          </p>

          <h1>Tell us what your claim is about</h1>

          <p className="intro">
            Your general eligibility checks have cleared.
            Now answer the questions specific to your claim.
          </p>

          {error && (
            <div className="error">
              {error}
            </div>
          )}

          <div className="field">
            <label htmlFor="category">
              What is your claim about?
            </label>

            <select
              id="category"
              value={selectedCategory}
              onChange={(event) =>
                loadCategory(event.target.value)
              }
            >
              <option value="">
                Select a category
              </option>

              {(config?.categories ?? []).map(
                (category) => (
                  <option
                    key={category.id}
                    value={category.id}
                  >
                    {category.label}
                  </option>
                )
              )}
            </select>
          </div>

          {selectedCategory && categoryConfig && (
            <form onSubmit={submitCategory}>
              {categoryConfig.questions.map(
                (question) =>
                  renderQuestion(
                    question,
                    categoryAnswers,
                    setCategoryAnswers
                  )
              )}

              <button
                type="submit"
                disabled={submitting}
              >
                {submitting
                  ? "Checking..."
                  : "Check eligibility →"}
              </button>
            </form>
          )}

          {selectedCategory &&
            !categoryConfig &&
            !error && (
              <p>Loading category questions...</p>
            )}
        </section>

        <footer>
          Independent student prototype · Not an official court service
        </footer>
      </main>
    );
  }

  /*
   * ------------------------------------------------------------
   * EVIDENCE STEP (Sprint 2, Feature 2)
   * Checks an uploaded document against the answers already given.
   * The model proposes; evaluate() still decides.
   * ------------------------------------------------------------
   */

  if (step === "evidence") {
    return (
      <main className="shell">
        <header className="brand">
          <strong>Claim guide</strong>
          <span>Hackathon prototype</span>
        </header>

        <nav className="steps">
          <span>01 General details</span>
          <span>02 Claim category</span>
          <span>03 Party &amp; filing</span>
          <span>04 Review</span>
          <span className="active">05 Your documents</span>
        </nav>

        <EvidencePanel
          generalAnswers={answers}
          categoryId={selectedCategory}
          categoryAnswers={categoryAnswers}
          result={evidenceResult}
          onResult={setEvidenceResult}
          onChallenge={startChallenge}
          preparing={submitting}
          onBack={() => setStep("review")}
        />

        <footer>
          Independent student prototype · Not an official court service
        </footer>
      </main>
    );
  }

  /*
   * ------------------------------------------------------------
   * PARTY & FILING DETAILS STEP (Sprint 2)
   * Pure data capture — no eligibility gates, no /api/evaluate call.
   * ------------------------------------------------------------
   */

  if (step === "party") {
    const claimAmountQuestion = config?.generalQuestions.find(
      (q) => q.field === "claimAmount"
    );

    return (
      <main className="shell">
        <header className="brand">
          <strong>Claim guide</strong>
          <span>Hackathon prototype</span>
        </header>

        <nav className="steps">
          <span>01 General details</span>
          <span>02 Claim category</span>
          <span className="active">03 Party &amp; filing</span>
          <span>04 Review</span>
          <span>05 Your documents</span>
        </nav>

        <section className="panel">
          <p className="eyebrow">
            PARTY & FILING DETAILS · NEXT STEP
          </p>

          <h1>Tell us who is involved</h1>

          <p className="intro">
            This records who is filing and who the claim is against.
            It does not affect your eligibility result.
          </p>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              setStep("review");
            }}
          >
            {(config?.partyQuestions ?? [])
              .filter(partyFieldVisible)
              .map((question) =>
                renderQuestion(question, partyAnswers, setPartyAnswers)
              )}

            {claimAmountQuestion &&
              renderQuestion(claimAmountQuestion, answers, setAnswers)}

            <div className="field">
              <label>Filing / processing fee</label>
              <p>
                {filingFee !== null
                  ? `S$${filingFee.toFixed(2)}`
                  : "— confirm your claim amount and filing type above"}
              </p>
            </div>

            <button type="submit" disabled={filingFee === null}>
              Continue to review →
            </button>
          </form>
        </section>

        <footer>
          Independent student prototype · Not an official court service
        </footer>
      </main>
    );
  }

  /*
   * ------------------------------------------------------------
   * GENERAL STEP
   * ------------------------------------------------------------
   */

  return (
    <main className="shell">
      <header className="brand">
        <strong>Claim guide</strong>
        <span>Hackathon prototype</span>
      </header>

      <nav className="steps">
        <span className="active">
          01 Claim details
        </span>
        <span>02 Claim category</span>
        <span>03 Party &amp; filing</span>
        <span>04 Review</span>
        <span>05 Your documents</span>
      </nav>

      <div className="content-grid">
        <section className="panel">
          <p className="eyebrow">
            SMALL CLAIMS · PRE-FILING
          </p>

          <h1>Tell us about your claim</h1>

          <p className="intro">
            Start with the facts. We will check your answers
            against the published eligibility rules.
          </p>

          {error && (
            <div className="error">
              {error}
            </div>
          )}

          {!config?.ready && (
            <div className="warning">
              Eligibility rules have not been published yet.
            </div>
          )}

          <form onSubmit={submitGeneral}>
            {(config?.generalQuestions ?? []).map(
              (question) =>
                renderQuestion(
                  question,
                  answers,
                  setAnswers
                )
            )}

            <button
              type="submit"
              disabled={
                submitting || !config?.ready
              }
            >
              {submitting
                ? "Checking..."
                : "Check eligibility →"}
            </button>
          </form>

          {verdict?.general?.missing &&
            verdict.general.missing.length > 0 && (
              <div className="follow-ups">
                <h3>More information needed</h3>

                {verdict.general.missing.map(
                  (result) => (
                    <div
                      key={result.gateId}
                      className="follow-up"
                    >
                      <strong>
                        {result.field}
                      </strong>

                      <p>
                        {result.followUp ??
                          result.explanation}
                      </p>
                    </div>
                  )
                )}
              </div>
            )}
        </section>

        <aside className="eyebrow-panel">
          <p className="eyebrow">
            BEFORE YOU BEGIN
          </p>

          <h2>Start with the facts.</h2>

          <p>
            Answer the questions as accurately as you can.
            If you do not know something, you can leave it
            unanswered.
          </p>

          <hr />

          <h3>Eligibility, not legal advice</h3>

          <p>
            This prototype evaluates the information you
            provide against the configured rules. It does
            not decide whether your claim will succeed.
          </p>

          <hr />

          <h3>A guide, not a filing service</h3>

          <p>
            This prototype does not submit anything to the
            Small Claims Tribunals.
          </p>
        </aside>
      </div>

      <footer>
        Independent student prototype · Not an official court service
      </footer>
    </main>
  );
}

/*
 * ------------------------------------------------------------
 * Provenance (Sprint 2, Feature 2 + 3)
 *
 * Where each answer actually stands: asserted by the claimant,
 * corroborated by a document, or contradicted by one. The honesty
 * axis as UI rather than as a slide claim (DECISIONS.md §Evidence).
 * ------------------------------------------------------------
 */

const PROVENANCE_COPY: Record<Provenance, { label: string; className: string }> = {
  ASSERTED: { label: "You said so", className: "badge" },
  CORROBORATED: { label: "Backed by your document", className: "badge badge-corroborates" },
  CONTRADICTED: { label: "Your document disagrees", className: "badge badge-contradicts" },
};

function ProvenanceSummary({
  evidence,
  verdict,
}: {
  evidence: EvidenceResponse;
  verdict: EvaluateResponse;
}) {
  // Gate id → the question, so a badge is attached to something readable.
  const questions = new Map<string, string>();
  for (const result of [...verdict.general.results, ...(verdict.category?.results ?? [])]) {
    questions.set(result.gateId, result.field);
  }

  return (
    <section className="results">
      <h2>Where your answers stand</h2>

      <p className="hint">
        Checked against {evidence.checkedGateIds.length} points in your claim.
        &ldquo;You said so&rdquo; means no document spoke to it — not that it is wrong.
      </p>

      {evidence.checkedGateIds.map((gateId) => {
        const provenance = evidence.provenance[gateId] ?? "ASSERTED";
        const copy = PROVENANCE_COPY[provenance];
        return (
          <div className="status-row" key={gateId}>
            <strong>{questions.get(gateId) ?? gateId}</strong>
            <span className={copy.className}>{copy.label}</span>
          </div>
        );
      })}
    </section>
  );
}

/*
 * ------------------------------------------------------------
 * Disagreements (Sprint 2, Feature 3)
 *
 * A verified contradiction the claimant rejected is not dropped.
 * Their answer stands, and both sides are carried into the Sprint 3
 * handoff brief so a real person sees them.
 * ------------------------------------------------------------
 */

function DisagreementSummary({ disagreements }: { disagreements: Disagreement[] }) {
  return (
    <section className="results">
      <h2>Where we still disagree</h2>

      <p className="hint">
        You kept your answer on these. We have kept it too — and noted why your
        document appeared to say otherwise, so whoever helps you next sees both.
      </p>

      {disagreements.map((item) => (
        <article className="gate-result" key={`${item.gateId}-${item.reason}`}>
          <div className="gate-header">
            <strong>{item.question}</strong>
            <span className="badge badge-contradicts">
              {item.reason === "ESCALATED" ? "For a person to review" : "You disagreed"}
            </span>
          </div>

          <div className="status-row">
            <strong>Your answer</strong>
            <span>{item.claimantAnswer}</span>
          </div>

          <p>{item.observation}</p>

          <blockquote className="quote">
            “{item.quote}”
            <cite>your document, page {item.page}</cite>
          </blockquote>
        </article>
      ))}
    </section>
  );
}

/*
 * ------------------------------------------------------------
 * Party & filing details summary (Sprint 2)
 * ------------------------------------------------------------
 */

function PartyDetailsSummary({
  partyQuestions,
  partyAnswers,
  claimAmount,
  filingFee,
}: {
  partyQuestions: PartyQuestion[];
  partyAnswers: Answers;
  claimAmount: Answers[string];
  filingFee: number | null;
}) {
  const filingAs = partyAnswers.filingAs;

  function optionLabel(field: string, value: Answers[string]): string {
    if (typeof value !== "string" || !value) return "Not provided";
    const question = partyQuestions.find((q) => q.field === field);
    return (
      question?.options?.find((option) => option.value === value)?.label ??
      value
    );
  }

  return (
    <section className="results">
      <h2>Party & filing details</h2>

      <div className="status-row">
        <strong>Filing as</strong>
        <span>{optionLabel("filingAs", filingAs)}</span>
      </div>

      {filingAs === "entity" && (
        <>
          <div className="status-row">
            <strong>Entity type</strong>
            <span>{optionLabel("entityType", partyAnswers.entityType)}</span>
          </div>

          <div className="status-row">
            <strong>Your role</strong>
            <span>
              {typeof partyAnswers.entityRole === "string" &&
              partyAnswers.entityRole
                ? partyAnswers.entityRole
                : "Not provided"}
            </span>
          </div>
        </>
      )}

      <div className="status-row">
        <strong>Filing against</strong>
        <span>{optionLabel("respondentType", partyAnswers.respondentType)}</span>
      </div>

      <div className="status-row">
        <strong>Respondent name(s)</strong>
        <span>
          {typeof partyAnswers.respondentNames === "string" &&
          partyAnswers.respondentNames
            ? partyAnswers.respondentNames
            : "Not provided"}
        </span>
      </div>

      <div className="status-row">
        <strong>Claim amount</strong>
        <span>
          {typeof claimAmount === "number"
            ? `S$${claimAmount.toFixed(2)}`
            : "Not provided"}
        </span>
      </div>

      <div className="status-row">
        <strong>Filing / processing fee</strong>
        <span>
          {filingFee !== null ? `S$${filingFee.toFixed(2)}` : "Not computed"}
        </span>
      </div>
    </section>
  );
}

/*
 * ------------------------------------------------------------
 * Result components
 * ------------------------------------------------------------
 */

function ResultPhase({
  title,
  phase,
}: {
  title: string;
  phase: EvaluateResponse["general"];
}) {
  return (
    <section className="results">
      <h2>{title}</h2>

      <div className="status-row">
        <strong>Status</strong>
        <span>{phase.status}</span>
      </div>

      {phase.results.map((result) => (
        <article
          className="gate-result"
          key={result.gateId}
        >
          <div className="gate-header">
            <strong>{result.field}</strong>
            <span>{result.outcome}</span>
          </div>

          <p>{result.explanation}</p>

          {result.followUp && (
            <p>
              <strong>Follow-up:</strong>{" "}
              {result.followUp}
            </p>
          )}

          <div className="source">
            <strong>Supporting provision</strong>

            <p>
              {result.source.title}
              {result.source.provision
                ? ` · ${result.source.provision}`
                : ""}
            </p>

            {result.source.url && (
              <a
                href={result.source.url}
                target="_blank"
                rel="noreferrer"
              >
                View source
              </a>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}

/*
 * ------------------------------------------------------------
 * Status helpers
 * ------------------------------------------------------------
 */

function getStatusHeading(
  status: EvaluateResponse["general"]["status"]
) {
  switch (status) {
    case "PASS":
      return "Your claim passed this eligibility check.";

    case "CONDITIONAL":
      return "Your claim may proceed subject to conditions.";

    case "INCOMPLETE":
      return "More information is needed.";

    case "FAIL":
      return "Your claim did not pass this eligibility check.";

    default:
      return "Assessment complete.";
  }
}

function getStatusDescription(
  status: EvaluateResponse["general"]["status"]
) {
  switch (status) {
    case "PASS":
      return "The configured eligibility rules did not identify a failed gate.";

    case "CONDITIONAL":
      return "One or more rules indicate that additional conditions may apply.";

    case "INCOMPLETE":
      return "One or more important questions still need an answer.";

    case "FAIL":
      return "One or more hard eligibility gates were not satisfied.";

    default:
      return "";
  }
}