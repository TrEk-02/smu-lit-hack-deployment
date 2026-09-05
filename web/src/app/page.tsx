"use client";

import { FormEvent, useEffect, useState } from "react";
import type { EvaluateResponse } from "@/lib/api";
import { computeFilingFee } from "@/lib/filing-fee";
import type {
  AnswerType,
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

type Step = "general" | "category" | "party" | "review";

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
   * Shared shape for anything renderQuestion/renderInput can draw —
   * both eligibility Questions and party-field PartyQuestions.
   */
  type FormQuestion = Pick<Question, "field" | "question" | "answerType" | "options">;

  /*
   * Convert HTML input values into the type expected by the
   * backend.
   *
   * <input> values arrive as strings, but a number rule expects
   * a number.
   */

  function handleInputChange(
    setter: React.Dispatch<React.SetStateAction<Answers>>,
    question: FormQuestion,
    rawValue: string
  ) {
    if (rawValue === "") {
      updateAnswer(setter, question.field, null);
      return;
    }

    if (question.answerType === "number") {
      const numberValue = Number(rawValue);

      updateAnswer(
        setter,
        question.field,
        Number.isNaN(numberValue) ? null : numberValue
      );

      return;
    }

    updateAnswer(setter, question.field, rawValue);
  }

  /*
   * ------------------------------------------------------------
   * Render one question
   * ------------------------------------------------------------
   */

  function renderQuestion(
    question: FormQuestion,
    currentAnswers: Answers,
    setter: React.Dispatch<React.SetStateAction<Answers>>
  ) {
    const value = currentAnswers[question.field];

    return (
      <div className="field" key={question.field}>
        <label htmlFor={question.field}>
          {question.question}
        </label>

        {renderInput(question, value, setter)}
      </div>
    );
  }

  function renderInput(
    question: FormQuestion,
    value: Answers[string],
    setter: React.Dispatch<React.SetStateAction<Answers>>
  ) {
    switch (question.answerType as AnswerType) {
      case "text":
        return (
          <textarea
            id={question.field}
            value={typeof value === "string" ? value : ""}
            rows={2}
            onChange={(event) =>
              handleInputChange(
                setter,
                question,
                event.target.value
              )
            }
          />
        );

      case "number":
        return (
          <input
            id={question.field}
            type="number"
            step="0.01"
            value={typeof value === "number" ? value : ""}
            placeholder="Enter a number"
            onChange={(event) =>
              handleInputChange(
                setter,
                question,
                event.target.value
              )
            }
          />
        );

      case "select":
        return (
          <select
            id={question.field}
            value={typeof value === "string" ? value : ""}
            onChange={(event) =>
              handleInputChange(
                setter,
                question,
                event.target.value
              )
            }
          >
            <option value="">Select an option</option>

            {(question.options ?? []).map((option) => (
              <option
                key={option.value}
                value={option.value}
              >
                {option.label}
              </option>
            ))}
          </select>
        );

      case "boolean":
        return (
          <select
            id={question.field}
            value={
              typeof value === "boolean"
                ? String(value)
                : ""
            }
            onChange={(event) => {
              if (event.target.value === "") {
                updateAnswer(
                  setter,
                  question.field,
                  null
                );
              } else {
                updateAnswer(
                  setter,
                  question.field,
                  event.target.value === "true"
                );
              }
            }}
          >
            <option value="">Select an answer</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        );

      default:
        return null;
    }
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
          <span>03 Party & filing</span>
          <span className="active">04 Review</span>
        </nav>

        <section className="panel">
          <p className="eyebrow">
            YOUR REVIEW · ASSESSMENT RESULT
          </p>

          <h1>Review your claim</h1>

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

          <PartyDetailsSummary
            partyQuestions={config?.partyQuestions ?? []}
            partyAnswers={partyAnswers}
            claimAmount={claimAmount}
            filingFee={filingFee}
          />

          <div className="actions">
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
          <span>03 Party & filing</span>
          <span>04 Review</span>
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
          <span className="active">03 Party & filing</span>
          <span>04 Review</span>
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
        <span>03 Party & filing</span>
        <span>04 Review</span>
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