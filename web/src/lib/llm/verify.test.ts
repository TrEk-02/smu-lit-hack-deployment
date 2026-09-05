import assert from "node:assert/strict";
import { test } from "node:test";
import { locateQuote, normalise, verifyFindings, type Page } from "./verify.ts";
import type { Finding } from "./schema.ts";

/*
 * Run with:  node --test src/lib/llm/verify.test.ts
 *
 * verify.ts is pure and imports only types, so it runs directly under
 * Node's type stripping — no test framework, no build step.
 */

const PAGES: Page[] = [
  { page: 1, text: "INVOICE 2026-114\nSupply and install kitchen cabinets.\nAgreed price: S$6,500.00" },
  { page: 2, text: "Delivery date: 12 March 2026.\nThe seller’s liability is capped at the price paid." },
];

function finding(over: Partial<Finding> = {}): Finding {
  return {
    gateId: "boc_price_agreed",
    kind: "CONTRADICTS",
    quote: "Agreed price: S$6,500.00",
    page: 1,
    observation: "The invoice shows a different figure.",
    proposedAnswer: null,
    ...over,
  };
}

test("a fabricated quote is dropped and counted", () => {
  const fabricated = finding({
    quote: "The parties agreed to a full refund within 14 days of any defect.",
  });

  const result = verifyFindings([fabricated], PAGES);

  assert.equal(result.kept.length, 0, "fabricated finding must not reach the claimant");
  assert.equal(result.dropped, 1);
  assert.deepEqual(result.droppedGateIds, ["boc_price_agreed"]);
});

test("a genuine quote survives and resolves its page", () => {
  const result = verifyFindings([finding()], PAGES);

  assert.equal(result.dropped, 0);
  assert.equal(result.kept.length, 1);
  assert.equal(result.kept[0].verifiedPage, 1);
});

test("the model's page number is corrected, not trusted", () => {
  // Quote really is on page 2; the model claims page 1.
  const misplaced = finding({ quote: "Delivery date: 12 March 2026", page: 1 });

  const result = verifyFindings([misplaced], PAGES);

  assert.equal(result.kept.length, 1);
  assert.equal(result.kept[0].verifiedPage, 2, "page must come from the match, not the model");
});

test("real quotes are not rejected over formatting differences", () => {
  // Smart apostrophe, collapsed line break, different case — all cosmetic.
  assert.equal(locateQuote("the seller's liability is capped", PAGES), 2);
  assert.equal(locateQuote("Supply and install    kitchen cabinets.", PAGES), 1);
  assert.equal(locateQuote("INVOICE 2026-114 Supply and install kitchen cabinets.", PAGES), 1);
});

test("an empty quote matches nothing", () => {
  // "".includes("") is true — without an explicit guard this would wave
  // every fabrication straight through.
  assert.equal(locateQuote("", PAGES), null);
  assert.equal(locateQuote("   \n  ", PAGES), null);

  const result = verifyFindings([finding({ quote: "" })], PAGES);
  assert.equal(result.kept.length, 0);
  assert.equal(result.dropped, 1);
});

test("normalise collapses only cosmetic differences", () => {
  assert.equal(normalise("  The  “Price”  is  S$5 — net "), 'the "price" is s$5 - net');
});

test("a mixed batch keeps the real finding and drops the invented one", () => {
  const result = verifyFindings(
    [finding({ gateId: "boc_price_agreed" }), finding({ gateId: "boc_quality", quote: "goods were faulty on arrival" })],
    PAGES
  );

  assert.equal(result.kept.length, 1);
  assert.equal(result.kept[0].gateId, "boc_price_agreed");
  assert.equal(result.dropped, 1);
});
