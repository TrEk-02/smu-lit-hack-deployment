import type { Finding } from "./schema";

/* ============================================================
 * QUOTE VERIFICATION
 *
 * Every finding must carry a verbatim quote from the document.
 * The server checks the quote actually appears in the extracted
 * text; if it doesn't, the finding is dropped before it reaches
 * the claimant. This kills fabricated citations empirically
 * rather than by prompt-begging (DECISIONS.md §Evidence).
 *
 * Pure — no I/O, no rules, no LLM. Unit-testable in isolation,
 * which matters: "quote verification demonstrably rejects a
 * fabricated citation" is a named success criterion.
 * ============================================================ */

export type Page = { page: number; text: string };

/**
 * Collapse the differences that make a genuine quote look fabricated:
 * smart quotes, dash variants, non-breaking spaces, line wrapping from
 * PDF extraction, and case. Anything beyond this is a real mismatch.
 */
export function normalise(text: string): string {
  return text
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * The page a quote actually appears on, or null if it appears nowhere.
 * An empty quote returns null rather than matching everything — that
 * edge case would otherwise wave every fabrication straight through.
 */
export function locateQuote(quote: string, pages: Page[]): number | null {
  const needle = normalise(quote);
  if (!needle) return null;

  for (const page of pages) {
    if (normalise(page.text).includes(needle)) return page.page;
  }
  return null;
}

/** A finding whose quote was found, with `page` corrected to where it really is. */
export type VerifiedFinding = Finding & { verifiedPage: number };

export type VerificationResult = {
  kept: VerifiedFinding[];
  /** Stated to the user and to judges — not silently swallowed. */
  dropped: number;
  /** Gates whose only finding was unverifiable, for the "we couldn't check" path. */
  droppedGateIds: string[];
};

export function verifyFindings(findings: Finding[], pages: Page[]): VerificationResult {
  const kept: VerifiedFinding[] = [];
  const droppedGateIds: string[] = [];

  for (const finding of findings) {
    const verifiedPage = locateQuote(finding.quote, pages);

    if (verifiedPage === null) {
      droppedGateIds.push(finding.gateId);
      // Server-side only: the fabricated text is never shown to the claimant.
      console.warn(
        `[evidence] dropped unverifiable quote for gate ${finding.gateId}: ${JSON.stringify(
          finding.quote.slice(0, 120)
        )}`
      );
      continue;
    }

    // The model's own page number is advisory; trust the match.
    kept.push({ ...finding, verifiedPage });
  }

  if (droppedGateIds.length > 0) {
    console.warn(
      `[evidence] quote verification dropped ${droppedGateIds.length} of ${findings.length} findings`
    );
  }

  return { kept, dropped: droppedGateIds.length, droppedGateIds };
}
