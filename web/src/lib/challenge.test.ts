import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_QUESTIONS, buildQuestions, type BuildInput, type FindingLike, type GateLike } from "./challenge.ts";

/* Run with: npm test */

const SOURCE = { title: "Test Act", provision: "s 1", url: "" };

function gate(id: string, over: Partial<GateLike> = {}): GateLike {
  return {
    id,
    scope: "category",
    field: `${id}_field`,
    question: `Question for ${id}?`,
    missingMessage: `Follow-up for ${id}?`,
    answerType: "boolean",
    plainExplanation: "Because.",
    source: SOURCE,
    ...over,
  };
}

const GATES: Record<string, GateLike> = {
  passed_correctable: gate("passed_correctable"),
  passed_escalate: gate("passed_escalate"),
  failed_gate: gate("failed_gate"),
  unclear_gate: gate("unclear_gate"),
  weak_gate: gate("weak_gate"),
  extra_a: gate("extra_a"),
  extra_b: gate("extra_b"),
  extra_c: gate("extra_c"),
};
const lookup = (id: string) => GATES[id];

function finding(gateId: string, over: Partial<FindingLike> = {}): FindingLike {
  return {
    gateId,
    kind: "CONTRADICTS",
    quote: "the agreed price was S$8,900",
    page: 1,
    observation: "You said one figure; the invoice shows another.",
    proposedAnswer: false,
    correctable: true,
    escalate: false,
    ...over,
  };
}

function input(over: Partial<BuildInput> = {}): BuildInput {
  return {
    findings: [],
    unclear: [],
    passedGateIds: new Set<string>(),
    weakOrIncompleteGateIds: [],
    answers: {},
    ...over,
  };
}

test("contradictions on passed gates come first, correctable before escalated", () => {
  const questions = buildQuestions(
    input({
      findings: [
        finding("failed_gate"),
        finding("passed_escalate", { escalate: true, correctable: false }),
        finding("passed_correctable"),
      ],
      passedGateIds: new Set(["passed_correctable", "passed_escalate"]),
      weakOrIncompleteGateIds: ["weak_gate"],
      unclear: [{ gateId: "unclear_gate", why: "ambiguous" }],
    }),
    lookup
  );

  assert.deepEqual(
    questions.map((q) => q.gateId),
    ["passed_correctable", "passed_escalate", "failed_gate", "unclear_gate", "weak_gate"],
    "a claimant who is confidently wrong hides in the PASS set — those rank first"
  );
  assert.deepEqual(
    questions.map((q) => q.kind),
    ["CONFIRM_CORRECTION", "ESCALATED", "CONFIRM_CORRECTION", "UNCLEAR", "FOLLOW_UP"]
  );
});

test("the round is never empty with no document at all", () => {
  // No findings, no unclear — rules.json alone must still produce questions,
  // which is what makes the round work with the LLM stubbed.
  const questions = buildQuestions(
    input({ weakOrIncompleteGateIds: ["weak_gate", "extra_a"] }),
    lookup
  );

  assert.equal(questions.length, 2);
  assert.ok(questions.every((q) => q.kind === "FOLLOW_UP"));
  assert.equal(questions[0].prompt, "Follow-up for weak_gate?", "prompt is legal's own if-unknown question");
  assert.equal(questions[0].evidence, null, "no document drove it, so no quote is claimed");
});

test("the queue is capped so the round terminates", () => {
  const questions = buildQuestions(
    input({
      weakOrIncompleteGateIds: [
        "weak_gate", "extra_a", "extra_b", "extra_c",
        "unclear_gate", "failed_gate", "passed_correctable", "passed_escalate",
      ],
    }),
    lookup
  );

  assert.equal(questions.length, MAX_QUESTIONS);
});

test("a gate is only ever asked about once", () => {
  const questions = buildQuestions(
    input({
      findings: [finding("weak_gate")],
      unclear: [{ gateId: "weak_gate", why: "also unclear" }],
      weakOrIncompleteGateIds: ["weak_gate"],
      passedGateIds: new Set(["weak_gate"]),
    }),
    lookup
  );

  assert.equal(questions.length, 1);
  assert.equal(questions[0].kind, "CONFIRM_CORRECTION", "highest-priority source wins");
});

test("escalated contradictions offer no correction", () => {
  const [question] = buildQuestions(
    input({
      findings: [finding("passed_escalate", { escalate: true, correctable: false, proposedAnswer: true })],
      passedGateIds: new Set(["passed_escalate"]),
    }),
    lookup
  );

  assert.equal(question.kind, "ESCALATED");
  assert.equal(question.proposedAnswer, null, "judgement calls do not flip an answer");
  assert.equal(question.proposedAnswerLabel, null);
});

test("every document-driven question carries its verified quote", () => {
  const questions = buildQuestions(
    input({
      findings: [finding("passed_correctable")],
      passedGateIds: new Set(["passed_correctable"]),
      weakOrIncompleteGateIds: ["weak_gate"],
    }),
    lookup
  );

  const fromDocument = questions.filter((q) => q.evidence !== null);
  assert.equal(fromDocument.length, 1);
  assert.equal(fromDocument[0].evidence?.quote, "the agreed price was S$8,900");
  assert.equal(fromDocument[0].evidence?.page, 1);
});

test("corroborations never become questions", () => {
  const questions = buildQuestions(
    input({
      findings: [finding("passed_correctable", { kind: "CORROBORATES" })],
      passedGateIds: new Set(["passed_correctable"]),
    }),
    lookup
  );

  assert.deepEqual(questions, [], "agreeing with the claimant is not a challenge");
});

test("answers and proposals are labelled the way the claimant sees them", () => {
  const options = [
    { value: "exact", label: "Yes — an exact date" },
    { value: "none", label: "No date or timeframe was agreed" },
  ];
  const GATE = gate("select_gate", { answerType: "select", options, field: "deliveryDateAgreed" });

  const [question] = buildQuestions(
    input({
      findings: [finding("select_gate", { proposedAnswer: "none" })],
      passedGateIds: new Set(["select_gate"]),
      answers: { deliveryDateAgreed: "exact" },
    }),
    (id) => (id === "select_gate" ? GATE : undefined)
  );

  assert.equal(question.currentAnswerLabel, "Yes — an exact date");
  assert.equal(question.proposedAnswerLabel, "No date or timeframe was agreed");
});

test("findings for gates that are not published are dropped", () => {
  const questions = buildQuestions(input({ findings: [finding("no_such_gate")] }), lookup);
  assert.deepEqual(questions, []);
});
