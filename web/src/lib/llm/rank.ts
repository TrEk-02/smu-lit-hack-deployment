import { MAX_FINDINGS } from "./schema";
import type { VerifiedFinding } from "./verify";

/* ============================================================
 * RANKING
 *
 * A contradiction on a gate the claimant *passed* is the finding
 * that matters: `evaluate()` is deterministic about the rule, not
 * the fact, so a claimant who is confidently wrong hides inside
 * the PASS set. Those surface first (DECISIONS.md §Evidence).
 * ============================================================ */

function priority(finding: VerifiedFinding, passedGateIds: Set<string>): number {
  if (finding.kind === "CONTRADICTS") {
    return passedGateIds.has(finding.gateId) ? 0 : 1;
  }
  return 2; // CORROBORATES — reassuring, but never the headline
}

/**
 * Highest-signal findings first, truncated to the display cap.
 * Truncating here rather than rejecting an over-long response at the
 * schema means an over-eager model degrades gracefully instead of
 * failing the whole request.
 */
export function rankFindings(
  findings: VerifiedFinding[],
  passedGateIds: Set<string>
): VerifiedFinding[] {
  return [...findings]
    .sort((a, b) => priority(a, passedGateIds) - priority(b, passedGateIds))
    .slice(0, MAX_FINDINGS);
}
