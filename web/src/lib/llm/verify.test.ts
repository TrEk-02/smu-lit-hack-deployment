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
    origin: "pdf",
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

/*
 * ------------------------------------------------------------
 * Screenshots (Sprint 3)
 *
 * A screenshot's text is transcribed by a model rather than
 * extracted from a file, which is exactly why the duties are
 * split: the transcription call never sees the claim, and by
 * the time the findings model runs, the transcript is just
 * text. These tests pin the consequence — verification does
 * not get weaker because the source was an image.
 * ------------------------------------------------------------
 */

const SCREENSHOT: SourceDoc = {
  docId: "doc_chat",
  name: "whatsapp.png",
  origin: "image",
  pages: [
    {
      page: 1,
      text: [
        "[10:14] Me: the order was meant to arrive last Friday",
        "[11:02] Supplier: we never agreed a fixed price, it was supplied free of charge",
      ].join("\n"),
    },
  ],
};

test("a quote from a screenshot transcript verifies, and carries its origin", () => {
  const result = verifyFindings(
    [finding({ gateId: "boc_consideration", quote: "we never agreed a fixed price" })],
    [SCREENSHOT]
  );

  assert.equal(result.dropped, 0);
  assert.deepEqual(result.kept[0].location, {
    docId: "doc_chat",
    docName: "whatsapp.png",
    page: 1,
    origin: "image",
  });
});

test("a fabricated quote is still dropped when the source is a transcript", () => {
  const result = verifyFindings(
    [finding({ gateId: "boc_consideration", quote: "Supplier: I admit we breached the contract" })],
    [SCREENSHOT]
  );

  assert.equal(result.kept.length, 0);
  assert.equal(result.dropped, 1);
});

test("a transcript quote is not matched against a different document", () => {
  const result = verifyFindings(
    [finding({ gateId: "boc_consideration", quote: "we never agreed a fixed price" })],
    [INVOICE, EMAIL]
  );

  assert.equal(result.kept.length, 0);
  assert.equal(result.dropped, 1);
});

test("a document with no origin is treated as a pdf, not as a transcript", () => {
  const result = verifyFindings([finding()], DOCS);
  assert.equal(result.kept[0].location.origin, "pdf");
});
