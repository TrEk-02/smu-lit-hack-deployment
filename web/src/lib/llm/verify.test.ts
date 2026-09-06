import assert from "node:assert/strict";
import { test } from "node:test";
import { locateQuote, normalise, verifyFindings, type SourceDoc } from "./verify.ts";
import type { Finding } from "./schema.ts";

/*
 * Run with:  npm test
 *
 * verify.ts is pure and imports only types, so it runs directly under
 * Node's type stripping — no test framework, no build step.
 */

const INVOICE: SourceDoc = {
  docId: "doc_invoice",
  name: "invoice.pdf",
  pages: [
    { page: 1, text: "INVOICE 2026-114\nSupply and install kitchen cabinets.\nAgreed price: S$6,500.00" },
    { page: 2, text: "Delivery date: 12 March 2026.\nThe seller’s liability is capped at the price paid." },
  ],
};

const EMAIL: SourceDoc = {
  docId: "doc_email",
  name: "email-thread.pdf",
  pages: [{ page: 1, text: "Sorry for the delay — the cabinets will not arrive until late April." }],
};

const DOCS = [INVOICE, EMAIL];

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

  const result = verifyFindings([fabricated], DOCS);

  assert.equal(result.kept.length, 0, "fabricated finding must not reach the claimant");
  assert.equal(result.dropped, 1);
  assert.deepEqual(result.droppedGateIds, ["boc_price_agreed"]);
});

test("a genuine quote survives and resolves its document and page", () => {
  const result = verifyFindings([finding()], DOCS);

  assert.equal(result.dropped, 0);
  assert.equal(result.kept.length, 1);
  assert.deepEqual(result.kept[0].location, {
    docId: "doc_invoice",
    docName: "invoice.pdf",
    page: 1,
  });
});

test("a quote is found in the second document, not just the first", () => {
  const result = verifyFindings(
    [finding({ gateId: "boc_delivery_date", quote: "the cabinets will not arrive until late April" })],
    DOCS
  );

  assert.equal(result.kept.length, 1);
  assert.equal(result.kept[0].location.docId, "doc_email", "must search the whole bundle");
  assert.equal(result.kept[0].location.docName, "email-thread.pdf");
});

test("the model's page number is corrected, not trusted", () => {
  // Quote really is on page 2 of the invoice; the model claims page 1.
  const misplaced = finding({ quote: "Delivery date: 12 March 2026", page: 1 });

  const result = verifyFindings([misplaced], DOCS);

  assert.equal(result.kept.length, 1);
  assert.equal(result.kept[0].location.page, 2, "location comes from the match, not the model");
});

test("real quotes are not rejected over formatting differences", () => {
  // Smart apostrophe, collapsed whitespace, different case — all cosmetic.
  assert.equal(locateQuote("the seller's liability is capped", DOCS)?.page, 2);
  assert.equal(locateQuote("Supply and install    kitchen cabinets.", DOCS)?.page, 1);
  assert.equal(locateQuote("INVOICE 2026-114 Supply and install kitchen cabinets.", DOCS)?.page, 1);
});

test("an empty quote matches nothing", () => {
  // "".includes("") is true — without an explicit guard this would wave
  // every fabrication straight through.
  assert.equal(locateQuote("", DOCS), null);
  assert.equal(locateQuote("   \n  ", DOCS), null);

  const result = verifyFindings([finding({ quote: "" })], DOCS);
  assert.equal(result.kept.length, 0);
  assert.equal(result.dropped, 1);
});

test("normalise collapses only cosmetic differences", () => {
  assert.equal(normalise("  The  “Price”  is  S$5 — net "), 'the "price" is s$5 - net');
});

test("a mixed batch keeps the real finding and drops the invented one", () => {
  const result = verifyFindings(
    [
      finding({ gateId: "boc_price_agreed" }),
      finding({ gateId: "boc_quality", quote: "goods were faulty on arrival" }),
    ],
    DOCS
  );

  assert.equal(result.kept.length, 1);
  assert.equal(result.kept[0].gateId, "boc_price_agreed");
  assert.equal(result.dropped, 1);
});
