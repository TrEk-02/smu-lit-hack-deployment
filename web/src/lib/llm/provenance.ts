import type { VerifiedFinding } from "./verify";

/* ============================================================
 * PROVENANCE
 *
 * The honesty axis as UI rather than as a slide claim: for every
 * gate in scope, say where its answer actually stands.
 *
 *   Asserted     the claimant said so; no document speaks to it
 *   Corroborated a document backs it up
 *   Contradicted a document disagrees with it
 *
 * Contradicted wins over Corroborated — if any part of the
 * evidence disagrees, that is the thing the claimant needs to see.
 * ============================================================ */

export const PROVENANCE = ["ASSERTED", "CORROBORATED", "CONTRADICTED"] as const;
export type Provenance = (typeof PROVENANCE)[number];

export function provenanceByGate(
  gateIds: string[],
  findings: VerifiedFinding[]
): Record<string, Provenance> {
  const result: Record<string, Provenance> = {};
  for (const gateId of gateIds) result[gateId] = "ASSERTED";

  for (const finding of findings) {
    if (!(finding.gateId in result)) continue;
    if (result[finding.gateId] === "CONTRADICTED") continue; // already the strongest signal
    result[finding.gateId] = finding.kind === "CONTRADICTS" ? "CONTRADICTED" : "CORROBORATED";
  }

  return result;
}
