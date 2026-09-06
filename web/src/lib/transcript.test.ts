import assert from "node:assert/strict";
import { test } from "node:test";
import { hasReadableText } from "./transcript.ts";

/*
 * Transcription is allowed to come back saying it could read nothing. That
 * arrives two ways — an empty string, or a transcript made only of the
 * [unreadable] markers the prompt asks for instead of guesses — and both have
 * to be refused. A transcript with no words in it would otherwise reach the
 * verifier, match no quote, and silently drop every finding.
 */

test("an empty transcript is not readable", () => {
  assert.equal(hasReadableText(""), false);
  assert.equal(hasReadableText("   \n  "), false);
});

test("a transcript of only unreadable markers is not readable", () => {
  assert.equal(hasReadableText("[unreadable]"), false);
  assert.equal(hasReadableText("[unreadable]\n[unreadable]\n[UNREADABLE]"), false);
  assert.equal(hasReadableText("— [unreadable] —"), false);
});

test("a partly unreadable transcript is still readable", () => {
  assert.equal(
    hasReadableText("[10:14] Me: the order was [unreadable] last Friday"),
    true
  );
});

test("a normal transcript is readable", () => {
  assert.equal(hasReadableText("[11:02] Supplier: we never agreed a fixed price"), true);
});
