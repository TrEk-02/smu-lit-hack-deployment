import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { evaluate } from "./evaluate.ts";
import { demoScenarios } from "./scenarios.ts";
import { RulesFileSchema } from "./types.ts";

const rawRules = JSON.parse(readFileSync(new URL("../config/rules.json", import.meta.url), "utf8"));
const rules = RulesFileSchema.parse(rawRules);

test("both editable demo scenarios initially pass their configured checks", () => {
  assert.deepEqual(demoScenarios.map((scenario) => scenario.id), ["scenario-a", "scenario-b"]);

  for (const scenario of demoScenarios) {
    const verdict = evaluate(scenario.generalAnswers, rules.generalGates, {
      categoryId: scenario.categoryId,
      answers: scenario.categoryAnswers,
      gates: rules.categoryGates,
    });
    assert.equal(verdict.general.status, "PASS", scenario.id);
    assert.equal(verdict.category?.status, "PASS", scenario.id);
  }
});
