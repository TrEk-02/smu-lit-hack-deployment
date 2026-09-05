/**
 * Official Small Claims Tribunals filing/processing fee schedule.
 * Source: provided directly by the team's legal member, not derived
 * or inferred — do not adjust the tiers without a DECISIONS.md entry.
 */
export function computeFilingFee(claimAmount: number, filingAs: "individual" | "entity"): number {
  const isIndividual = filingAs === "individual";

  if (claimAmount <= 5000) return isIndividual ? 10 : 50;
  if (claimAmount <= 10000) return isIndividual ? 20 : 100;
  return claimAmount * (isIndividual ? 0.01 : 0.03);
}
