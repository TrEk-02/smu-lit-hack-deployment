"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { MOCK_VERDICT, type IntakeDraft } from "@/lib/mock-verdict";

const EMPTY: IntakeDraft = { claimType: "", claimAmount: "", incidentDate: "", description: "", evidence: "" };

export default function Home() {
  const [answers, setAnswers] = useState<IntakeDraft>(EMPTY);
  const [review, setReview] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const initial = useRef(true);
  useEffect(() => {
    if (initial.current) { initial.current = false; return; }
    heading.current?.focus();
  }, [review]);
  function update(key: keyof IntakeDraft, value: string) {
    setAnswers((previous) => ({ ...previous, [key]: value }));
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Replace the mock with Dev A's validated Verdict at integration time.
    setReview(true);
  }
  return (
    <div className="shell">
      <header><strong className="brand">Claim guide<span>.</span></strong><span>Hackathon prototype</span></header>
      <main>
        <p className="notice"><strong>Demo only.</strong> This shows a fixed sample result. It does not assess eligibility or submit a claim. Use fictional details.</p>
        <ol className="steps" aria-label="Progress"><li aria-current={!review ? "step" : undefined}>01 &nbsp; Claim details</li><li aria-current={review ? "step" : undefined}>02 &nbsp; Review</li></ol>
        {!review ? <div className="workspace">
          <section className="panel" aria-labelledby="title">
            <p className="eyebrow">SMALL CLAIMS · PRE-FILING</p>
            <h1 id="title" ref={heading} tabIndex={-1}>Tell us about your claim</h1>
            <p className="intro">Start with what happened and the information you have.</p>
            <form onSubmit={submit}>
              <label htmlFor="type">What is your claim about? <span>(required)</span></label>
              <select id="type" required value={answers.claimType} onChange={(e) => update("claimType", e.target.value)}>
                <option value="">Select a category</option><option>Goods or a purchase</option><option>A service</option><option>A tenancy</option><option>Other / I’m not sure</option>
              </select>
              <p className="hint">These intake categories do not confirm SCT coverage.</p>
              <div className="row"><div><label htmlFor="amount">Amount claimed (SGD) <span>(optional)</span></label><input id="amount" type="number" min="0.01" step="0.01" placeholder="e.g. 250.00" value={answers.claimAmount} onChange={(e) => update("claimAmount", e.target.value)} /></div><div><label htmlFor="date">Date of incident <span>(optional)</span></label><input id="date" type="date" value={answers.incidentDate} onChange={(e) => update("incidentDate", e.target.value)} /></div></div>
              <label htmlFor="description">What happened? <span>(required)</span></label><textarea id="description" required maxLength={3000} rows={4} placeholder="Describe what was agreed, what happened, and what you are asking for." value={answers.description} onChange={(e) => update("description", e.target.value)} />
              <label htmlFor="evidence">What evidence do you have? <span>(optional)</span></label><textarea id="evidence" maxLength={3000} rows={3} placeholder="Describe any receipts, agreements, or messages you have." value={answers.evidence} onChange={(e) => update("evidence", e.target.value)} />
              <p className="hint">Answers stay in this page’s memory. Refreshing clears them.</p><button type="submit">Preview result →</button>
            </form>
          </section>
          <aside><p className="eyebrow">BEFORE YOU BEGIN</p><h2>Start with the facts.</h2><p>Leave optional details blank if you don’t know them yet.</p><hr /><h3>Keep evidence separate</h3><p>Describe what each document shows, as well as what you believe happened.</p><h3>A guide, not a filing service</h3><p>This prototype does not send anything to the Small Claims Tribunals.</p></aside>
        </div> : <section className="panel results" aria-labelledby="title">
          <p className="eyebrow">YOUR REVIEW · SAMPLE OUTPUT</p><h1 id="title" ref={heading} tabIndex={-1}>Review your claim details</h1>
          <div className="verdict"><span className="badge">Needs review · Demo</span><h2>{MOCK_VERDICT.plainExplanation}</h2><p>Every submission receives this mock verdict. Your answers have not been checked against legal rules.</p><dl><dt>Gate requiring attention</dt><dd>{MOCK_VERDICT.failedGate ?? "Not evaluated"}</dd><dt>Supporting provision</dt><dd>{MOCK_VERDICT.provision ?? "No legal source attached to this mock"}</dd></dl></div>
          <h2>Your entered details</h2><dl className="summary">
            <div><dt>Claim category</dt><dd>{answers.claimType}</dd></div><div><dt>Amount claimed</dt><dd>{answers.claimAmount ? `SGD ${Number(answers.claimAmount).toFixed(2)}` : "Not provided"}</dd></div><div><dt>Date of incident</dt><dd>{answers.incidentDate || "Not provided"}</dd></div><div><dt>What happened</dt><dd>{answers.description}</dd></div><div><dt>Evidence described</dt><dd>{answers.evidence || "Not provided"}</dd></div>
          </dl><div className="actions"><button onClick={() => setReview(false)}>Edit answers</button><button className="secondary" onClick={() => { setAnswers(EMPTY); setReview(false); }}>Start over</button></div>
        </section>}
      </main><footer>Independent student prototype · Not an official court service</footer>
    </div>
  );
}
