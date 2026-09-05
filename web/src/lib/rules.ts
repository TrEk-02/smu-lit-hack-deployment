import rulesJson from "../config/rules.json";
import {
  RulesFileSchema,
  isPublished,
  type Category,
  type CategoryGate,
  type Gate,
  type GeneralGate,
  type PartyField,
  type PartyQuestion,
  type Question,
  type RulesFile,
} from "./types";

/**
 * Parsed and validated ONCE at import. If legal breaks rules.json
 * this throws at startup with the gate id and field in the message —
 * not mid-demo. Needs "resolveJsonModule": true in tsconfig.json
 * (create-next-app default).
 */
export const rules: RulesFile = RulesFileSchema.parse(rulesJson);

/** General gates that are ready to evaluate. */
export const publishedGeneralGates: GeneralGate[] = rules.generalGates.filter(isPublished);

/** Category gates for one claim type that are ready to evaluate. */
export function publishedCategoryGates(categoryId: string): CategoryGate[] {
  return rules.categoryGates.filter((g) => g.category === categoryId && isPublished(g));
}

/**
 * Categories the UI may offer. Derived, never declared separately:
 * a category with zero published gates is not offered, so the demo
 * cannot route a claimant into an empty rule set.
 */
export function supportedCategories(): Category[] {
  return rules.categories.filter((c) => publishedCategoryGates(c.id).length > 0);
}

/**
 * Turns gates into the form the UI renders. One question per distinct
 * field — two gates on claimAmount produce one input, not two.
 */
export function toQuestions(gates: Gate[]): Question[] {
  const byField = new Map<string, Question>();
  for (const g of gates.filter(isPublished)) {
    const existing = byField.get(g.field);
    if (existing) {
      existing.gateIds.push(g.id);
      continue;
    }
    byField.set(g.field, {
      field: g.field,
      question: g.question,
      answerType: g.answerType,
      options: g.options,
      gateIds: [g.id],
    });
  }
  return [...byField.values()];
}

export const generalQuestions: Question[] = toQuestions(publishedGeneralGates);
export function categoryQuestions(categoryId: string): Question[] {
  return toQuestions(publishedCategoryGates(categoryId));
}

/** Party & filing intake fields ready to show (Sprint 2). */
export const publishedPartyFields: PartyField[] = rules.partyFields.filter((f) => f.status === "published");

/** Turns published party fields into what the UI renders. */
export function partyQuestions(): PartyQuestion[] {
  return publishedPartyFields.map((f) => ({
    field: f.field,
    question: f.question,
    answerType: f.answerType,
    options: f.options,
    dependsOn: f.dependsOn,
  }));
}