import type { PhaseStatus } from "./types";

/** A category PASS must never conceal a general permission condition. */
export function reviewStatus(verdict: { general: { status: PhaseStatus }; category?: { status: PhaseStatus } }): PhaseStatus {
  const statuses = [verdict.general.status, verdict.category?.status];
  return (["FAIL", "INCOMPLETE", "CONDITIONAL", "PASS"] as const)
    .find((status) => statuses.includes(status))!;
}
