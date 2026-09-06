import { extractText, getDocumentProxy } from "unpdf";
import { TRANSCRIBABLE_MIME, transcribeDocument } from "./llm/openrouter";
import { hasReadableText } from "./transcript";
import type { DocOrigin, Page } from "./llm/verify";

/* ============================================================
 * DOCUMENT INGESTION — text-layer PDFs and pasted text only.
 *
 * Persistence: none. Text is extracted and the bytes are dropped;
 * nothing is written to disk. Vercel functions have no persistent
 * filesystem, and storing uploads would mean blob storage + a DB +
 * env vars and three new live failure modes (DECISIONS.md §12).
 * Only text crosses the wire.
 * ============================================================ */

export type ExtractedDoc = {
  docId: string;
  name: string;
  pages: Page[];
  /**
   * How the text was obtained. "pdf" and "text" are mechanical — the words
   * came from the file. "image" means they were transcribed from a picture,
   * which is a reading rather than an extraction. Carried all the way to the
   * quote display so an image-derived quote is never shown as if it came off
   * a document (DECISIONS.md §Evidence).
   */
  origin: DocOrigin;
};

export type { DocOrigin };

/** Up to five documents per claim, stated explicitly in the UI. */
export const MAX_DOCS = 5;
/** Per file. Guards against a 300-page PDF eating the request. */
export const MAX_BYTES = 10 * 1024 * 1024;
/**
 * Per image. Lower than MAX_BYTES because an image is base64-encoded into the
 * request body (~1.33x) and then billed as vision tokens. A phone screenshot
 * is well under this; a 12MP photo of a laptop screen is not, and should be
 * cropped rather than silently costing four times as much.
 */
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
/**
 * Pages we will transcribe from one PDF that turned out to have no text layer.
 * Each page is billed to the model as an image, so a 40-page scan is a real
 * bill arriving quietly. A chat export is one or two pages.
 */
export const MAX_TRANSCRIBE_PAGES = 10;

/** What the file picker offers, and what the route will accept. */
export const ACCEPTED_MIME = ["application/pdf", ...TRANSCRIBABLE_MIME] as const;

export function isImage(mime: string): boolean {
  return (TRANSCRIBABLE_MIME as readonly string[]).includes(mime);
}
/**
 * Across the whole bundle, not per file — five documents at a per-file cap
 * would be five times the prompt and five times the spend.
 */
export const MAX_BUNDLE_CHARS = 200_000;

export class IngestError extends Error {}

function makeDocId(): string {
  return `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function extractFromText(text: string, name = "Pasted text"): ExtractedDoc {
  const trimmed = text.trim();
  if (!trimmed) throw new IngestError("There was no text to read.");
  return { docId: makeDocId(), name, pages: [{ page: 1, text: trimmed }], origin: "text" };
}

export async function extractFromPdf(bytes: Uint8Array, name: string): Promise<ExtractedDoc> {
  if (bytes.byteLength > MAX_BYTES) {
    throw new IngestError(`"${name}" is larger than 10MB. Try a smaller file, or paste the relevant text.`);
  }

  let pageTexts: string[];
  try {
    // pdf.js takes ownership of the array it is given and detaches the
    // underlying buffer. Hand it a copy: `bytes` has to survive this call,
    // because a PDF with no text layer is transcribed from those same bytes
    // below, and a detached array base64-encodes to an empty string.
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    pageTexts = Array.isArray(text) ? text : [text];
  } catch {
    throw new IngestError(`"${name}" could not be read. If it is a scan or a photo, paste the text instead.`);
  }

  const pages = pageTexts
    .map((text, index) => ({ page: index + 1, text: text.trim() }))
    .filter((page) => page.text.length > 0);

  // A text-layer PDF yields text. One with none is a picture in a PDF wrapper
  // — which is exactly what a printed or exported WhatsApp thread is, and the
  // commonest way a chat actually reaches us. Rather than refuse it, hand it to
  // the same transcription path a screenshot takes. The text layer is still
  // preferred wherever it exists: it is mechanical, free, and a stronger
  // guarantee than a reading.
  if (pages.length === 0) {
    return transcribePdf(bytes, name, pageTexts.length);
  }

  return { docId: makeDocId(), name, pages, origin: "pdf" };
}

/** An image-only PDF: no text to extract, so the text is read off the pages. */
async function transcribePdf(
  bytes: Uint8Array,
  name: string,
  pageCount: number
): Promise<ExtractedDoc> {
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new IngestError(
      `"${name}" has no text in it, so we would have to read it as a picture — and at over 6MB it is too large for that. Paste the text instead.`
    );
  }
  if (pageCount > MAX_TRANSCRIBE_PAGES) {
    throw new IngestError(
      `"${name}" has no text in it and is ${pageCount} pages long. We can read up to ${MAX_TRANSCRIBE_PAGES} pages from a picture — upload just the pages that matter, or paste the text.`
    );
  }

  return transcribeInto(bytes, "application/pdf", name);
}

/**
 * A screenshot becomes a one-page document whose text was transcribed, not
 * extracted. Everything downstream — quote verification, ranking, the
 * challenge round — treats it exactly like any other document, which is the
 * point: the transcript is just text by the time it gets there, and a
 * fabricated quote against it is dropped by the same check as any other.
 */
export async function extractFromImage(
  bytes: Uint8Array,
  mime: string,
  name: string
): Promise<ExtractedDoc> {
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new IngestError(
      `"${name}" is larger than 6MB. Crop it to just the messages that matter, or paste the text instead.`
    );
  }

  return transcribeInto(bytes, mime, name);
}

/**
 * The shared tail of both transcription paths. Whatever came in, what comes
 * out is an ordinary one-page document whose text happens to have been read
 * rather than extracted — which is why `origin` is set, and why every surface
 * that shows a quote checks it.
 */
async function transcribeInto(
  bytes: Uint8Array,
  mime: string,
  name: string
): Promise<ExtractedDoc> {
  const base64 = Buffer.from(bytes).toString("base64");
  const transcript = (await transcribeDocument(base64, mime, name)).trim();

  // No text read is a refusal, not a silent pass. An unreadable transcript
  // reaching the verifier would match nothing and drop every finding without
  // ever saying why. Note that "nothing was read" arrives in two shapes: an
  // empty string, and a transcript that is only [unreadable] markers — the
  // prompt asks for those rather than letting the model guess, so a blurred
  // or blank image comes back marked, not empty.
  if (!hasReadableText(transcript)) {
    throw new IngestError(
      `No text could be read from "${name}". Try a clearer or larger screenshot, or paste the messages as text.`
    );
  }

  return { docId: makeDocId(), name, pages: [{ page: 1, text: transcript }], origin: "image" };
}

/**
 * Trim a whole bundle to the shared character budget, in order, so an early
 * document is never silently truncated in favour of a later one.
 */
export function capBundle(docs: ExtractedDoc[]): ExtractedDoc[] {
  let budget = MAX_BUNDLE_CHARS;
  const kept: ExtractedDoc[] = [];

  for (const doc of docs) {
    if (budget <= 0) break;
    const pages: Page[] = [];
    for (const page of doc.pages) {
      if (budget <= 0) break;
      pages.push({ page: page.page, text: page.text.slice(0, budget) });
      budget -= page.text.length;
    }
    if (pages.length > 0) kept.push({ ...doc, pages });
  }

  return kept;
}
