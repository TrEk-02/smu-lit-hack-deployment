import { extractText, getDocumentProxy } from "unpdf";
import type { Page } from "./llm/verify";

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
};

/** Up to five documents per claim, stated explicitly in the UI. */
export const MAX_DOCS = 5;
/** Per file. Guards against a 300-page PDF eating the request. */
export const MAX_BYTES = 10 * 1024 * 1024;
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
  return { docId: makeDocId(), name, pages: [{ page: 1, text: trimmed }] };
}

export async function extractFromPdf(bytes: Uint8Array, name: string): Promise<ExtractedDoc> {
  if (bytes.byteLength > MAX_BYTES) {
    throw new IngestError(`"${name}" is larger than 10MB. Try a smaller file, or paste the relevant text.`);
  }

  let pageTexts: string[];
  try {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: false });
    pageTexts = Array.isArray(text) ? text : [text];
  } catch {
    throw new IngestError(`"${name}" could not be read. If it is a scan or a photo, paste the text instead.`);
  }

  const pages = pageTexts
    .map((text, index) => ({ page: index + 1, text: text.trim() }))
    .filter((page) => page.text.length > 0);

  // A text-layer PDF yields text; a scan yields nothing. Say which, plainly —
  // this is a refusal, not a failure.
  if (pages.length === 0) {
    throw new IngestError(
      `No text could be read from "${name}" — it looks like a scan or a photo. Paste the text instead.`
    );
  }

  return { docId: makeDocId(), name, pages };
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
