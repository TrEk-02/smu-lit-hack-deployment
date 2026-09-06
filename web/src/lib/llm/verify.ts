import type { Finding } from "./schema";

/* ============================================================
 * QUOTE VERIFICATION
 *
 * Every finding must carry a verbatim quote from a document.
 * The server checks the quote actually appears in the extracted
 * text; if it doesn't, the finding is dropped before it reaches
 * the claimant. This kills fabricated citations empirically
 * rather than by prompt-begging (DECISIONS.md §Evidence).
 *
 * With several documents in play the verifier also answers
 * *which* one — the model is never asked to track document ids,
 * so the location comes from the match, not from the model.
 *
 * Pure — no I/O, no rules, no LLM. Unit-testable in isolation,
 * which matters: "quote verification demonstrably rejects a
 * fabricated citation" is a named success criterion.
 * ============================================================ */

export type Page = { page: number; text: string };

/** One ingested document: what the verifier searches. */
export type SourceDoc = {
  docId: string;
  name: string;
  pages: Page[];
};

/** Where a quote really is. Resolved by matching, never trusted from the model. */
export type QuoteLocation = {
  docId: string;
  docName: string;
  page: number;
};

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
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Where a quote appears across every uploaded document, or null if it
 * appears nowhere. An empty quote returns null rather than matching
 * everything — that edge case would otherwise wave every fabrication
 * straight through.
 */
export function locateQuote(quote: string, docs: SourceDoc[]): QuoteLocation | null {
  const needle = normalise(quote);
  if (!needle) return null;

  for (const doc of docs) {
    for (const page of doc.pages) {
      if (normalise(page.text).includes(needle)) {
        return { docId: doc.docId, docName: doc.name, page: page.page };
      }
    }
  }
  return null;
}

/** A finding whose quote was found, with its location corrected to where it really is. */
export type VerifiedFinding = Finding & { location: QuoteLocation };

export type VerificationResult = {
  kept: VerifiedFinding[];
  /** Stated to the user and to judges — not silently swallowed. */
  dropped: number;
  /** Gates whose finding was unverifiable, for the "we couldn't check" path. */
  droppedGateIds: string[];
};

export function verifyFindings(findings: Finding[], docs: SourceDoc[]): VerificationResult {
  const kept: VerifiedFinding[] = [];
  const droppedGateIds: string[] = [];

  for (const finding of findings) {
    const location = locateQuote(finding.quote, docs);

    if (location === null) {
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
    kept.push({ ...finding, location });
  }

  if (droppedGateIds.length > 0) {
    console.warn(
      `[evidence] quote verification dropped ${droppedGateIds.length} of ${findings.length} findings`
    );
  }

  return { kept, dropped: droppedGateIds.length, droppedGateIds };
}
