/* ============================================================
 * TRANSCRIPT TEXT
 *
 * Pure — no I/O, no model, no rules. Split out of ingest.ts for
 * the same reason verify.ts is split out: ingest.ts reaches the
 * network, and a rule this load-bearing should be testable
 * without one.
 * ============================================================ */

/**
 * Whether a transcript contains anything worth checking.
 *
 * "Nothing was read" arrives in two shapes. An empty string is the obvious
 * one. The other is a transcript made only of [unreadable] markers — the
 * transcription prompt asks for those instead of letting the model guess at
 * blurred or cropped text, so a blank or illegible screenshot comes back
 * marked rather than empty.
 *
 * Both have to be refused at ingest. A transcript with no words in it would
 * otherwise reach the verifier, match no quote, and silently drop every
 * finding — which reads to the claimant as "your document showed nothing"
 * when the truth is "we could not read your document".
 */
export function hasReadableText(transcript: string): boolean {
  return /[a-z0-9]/i.test(transcript.replace(/\[unreadable\]/gi, ""));
}
