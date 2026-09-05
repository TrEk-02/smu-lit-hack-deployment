import { z } from "zod";
import scenarioJson from "../config/scenarios.json" with { type: "json" };
import { AnswersSchema } from "./types.ts";

const ScenarioSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  categoryId: z.string().min(1),
  generalAnswers: AnswersSchema,
  categoryAnswers: AnswersSchema,
  partyAnswers: AnswersSchema,
});

const parsed = z.array(ScenarioSchema).safeParse(scenarioJson);
export type DemoScenario = z.infer<typeof ScenarioSchema>;

// Fixture errors remove the shortcuts; they never make legal rules unavailable.
if (!parsed.success) console.error("[scenarios] invalid demo fixture data", parsed.error.flatten());
export const demoScenarios: DemoScenario[] = parsed.success ? parsed.data : [];
