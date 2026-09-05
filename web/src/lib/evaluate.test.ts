import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applicability } from "./applicability.ts";
import { evaluate, evaluateGeneral } from "./evaluate.ts";
import { reviewStatus } from "./review-status.ts";
import { RulesFileSchema, type Answers } from "./types.ts";

const rawRules = JSON.parse(readFileSync(new URL("../config/rules.json", import.meta.url), "utf8"));
const rules = RulesFileSchema.parse(rawRules);
const baseline: Answers = {
  claimAmount: 1000,
  withinTwoYears: true,
  claimantIs18OrOlder: true,
  respondentInSingapore: true,
  respondentBankruptOrInsolvent: false,
  hasExistingCourtProceedings: false,
};
const assess = (overrides: Answers = {}) => evaluateGeneral({ ...baseline, ...overrides }, rules.generalGates);
const consent = rules.generalGates.find((gate) => gate.id === "gen_claim_amount_consent")!;
const representation = rules.generalGates.find((gate) => gate.id === "gen_minor_representation")!;

test("adult baseline passes and hidden follow-ups are not assessed", () => {
  const verdict = assess({ memorandumSigned: false, hasParentOrGuardianRepresentation: false });
  assert.equal(verdict.status, "PASS");
  assert.equal(
    verdict.results.find((result) => result.gateId === "gen_claim_amount_max")?.question,
    "How much are you claiming, in Singapore dollars?"
  );
  assert.ok(!verdict.results.some((r) => r.gateId === consent.id || r.gateId === representation.id));
});

for (const amount of [20000, 20000.01, 30000, 30000.01]) {
  test(`memorandum visibility and evaluation agree at S$${amount}`, () => {
    const applies = amount > 20000 && amount <= 30000;
    assert.equal(applicability(consent.appliesWhen, { claimAmount: amount }), applies ? "APPLIES" : "SKIP");
    const verdict = assess({ claimAmount: amount });
    assert.equal(verdict.status, amount > 30000 ? "FAIL" : applies ? "INCOMPLETE" : "PASS");
    assert.equal(verdict.results.some((r) => r.gateId === consent.id), applies);
  });
}

test("unsigned memorandum is conditional, signed memorandum passes", () => {
  assert.equal(assess({ claimAmount: 25000, memorandumSigned: false }).status, "CONDITIONAL");
  const signed = assess({ claimAmount: 25000, memorandumSigned: true });
  assert.equal(signed.status, "PASS");
  assert.match(signed.results.find((r) => r.gateId === consent.id)!.explanation, /confirmed/);
});

test("under-18 branch requires representation, not adulthood", () => {
  assert.equal(assess({ claimantIs18OrOlder: false }).status, "INCOMPLETE");
  assert.equal(assess({ claimantIs18OrOlder: false, hasParentOrGuardianRepresentation: false }).status, "FAIL");
  assert.equal(assess({ claimantIs18OrOlder: false, hasParentOrGuardianRepresentation: true }).status, "PASS");
  assert.equal(applicability(representation.appliesWhen, { claimantIs18OrOlder: false }), "APPLIES");
  assert.equal(applicability(representation.appliesWhen, { claimantIs18OrOlder: true }), "SKIP");
});

test("unknown prerequisites block through their own questions without evaluating hidden answers", () => {
  const verdict = assess({ claimantIs18OrOlder: null, claimAmount: null, memorandumSigned: true, hasParentOrGuardianRepresentation: true });
  assert.equal(verdict.status, "INCOMPLETE");
  assert.deepEqual(verdict.missing.map((r) => r.field).sort(), ["claimAmount", "claimantIs18OrOlder"]);
  assert.equal(applicability(representation.appliesWhen, {}), "UNKNOWN");
});

test("every unanswered unconditional hard or conditional input blocks", () => {
  for (const field of Object.keys(baseline)) {
    const verdict = assess({ [field]: null });
    assert.equal(verdict.status, "INCOMPLETE", field);
  }
});

test("wrong boolean types cannot produce clearance", () => {
  for (const field of Object.keys(baseline).filter((field) => field !== "claimAmount")) {
    assert.equal(assess({ [field]: "false" }).status, "INCOMPLETE", field);
  }
});

test("respondent outside Singapore and existing proceedings each fail", () => {
  assert.equal(assess({ respondentInSingapore: false }).status, "FAIL");
  assert.equal(assess({ hasExistingCourtProceedings: true }).status, "FAIL");
});

test("insolvency is conditional and preserves the requested permission message", () => {
  const verdict = assess({ respondentBankruptOrInsolvent: true });
  assert.equal(verdict.status, "CONDITIONAL");
  assert.equal(verdict.conditional[0].explanation,
    "You need to obtain permission from the Official Assignee to file the claim / Official Receiver or Liquidator to file the claim (Corporate Entity).");
});

test("hard failure takes precedence over permission conditions", () => {
  assert.equal(assess({ respondentInSingapore: false, respondentBankruptOrInsolvent: true }).status, "FAIL");
});

test("a category PASS does not hide a general condition in review", () => {
  assert.equal(reviewStatus({ general: { status: "CONDITIONAL" }, category: { status: "PASS" } }), "CONDITIONAL");
  assert.equal(reviewStatus({ general: { status: "CONDITIONAL" }, category: { status: "FAIL" } }), "FAIL");
  assert.equal(reviewStatus({ general: { status: "INCOMPLETE" } }), "INCOMPLETE");
});

test("category evaluation is blocked by missing representation or general failure", () => {
  const cases: Answers[] = [{ claimantIs18OrOlder: false }, { respondentInSingapore: false }];
  for (const overrides of cases) {
    const verdict = evaluate({ ...baseline, ...overrides }, rules.generalGates, {
      categoryId: "BREACH_OF_CONTRACT", answers: {}, gates: rules.categoryGates,
    });
    assert.equal(verdict.category, undefined);
  }
});

test("amount changes introduce and remove the memorandum requirement", () => {
  assert.equal(assess().status, "PASS");
  assert.equal(assess({ claimAmount: 25000 }).status, "INCOMPLETE");
  assert.equal(assess({ claimAmount: 25000, memorandumSigned: false }).status, "CONDITIONAL");
  assert.equal(assess({ claimAmount: 1000, memorandumSigned: false }).status, "PASS");
});

test("rule schema rejects missing, mistyped and circular applicability dependencies", () => {
  for (const appliesWhen of [
    [{ field: "notAQuestion", operator: "eq", value: false }],
    [{ field: "claimantIs18OrOlder", operator: "eq", value: "false" }],
    [{ field: "hasParentOrGuardianRepresentation", operator: "eq", value: false }],
  ]) {
    const candidate = structuredClone(rawRules);
    candidate.generalGates.find((gate: { id: string }) => gate.id === representation.id).appliesWhen = appliesWhen;
    assert.equal(RulesFileSchema.safeParse(candidate).success, false);
  }
});
