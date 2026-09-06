import { NextResponse } from "next/server";
import {
  IngestError,
  MAX_DOCS,
  capBundle,
  extractFromPdf,
  extractFromText,
  type ExtractedDoc,
} from "@/lib/ingest";
import type { ApiError } from "@/lib/api";

/**
 * POST /api/ingest
 *
 * Accepts multipart form-data with any number of `file` entries (text-layer
 * PDFs, up to MAX_DOCS) and/or a `text` field (pasted). Returns the extracted
 * text, document by document, page by page.
 *
 * The bytes are never stored — they exist only for the length of this request.
 * The response is what the claimant can see we read, and the only thing that
 * later goes to the model (DECISIONS.md §12).
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json<ApiError>({ error: "Expected files or pasted text." }, { status: 400 });
  }

  const files = form.getAll("file").filter((entry): entry is File => entry instanceof File && entry.size > 0);
  const text = form.get("text");

  if (files.length > MAX_DOCS) {
    return NextResponse.json<ApiError>(
      { error: `You can upload up to ${MAX_DOCS} documents at a time. You selected ${files.length}.` },
      { status: 400 }
    );
  }

  try {
    const docs: ExtractedDoc[] = [];

    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      docs.push(await extractFromPdf(bytes, file.name || "Uploaded document"));
    }

    if (typeof text === "string" && text.trim()) {
      docs.push(extractFromText(text));
    }

    if (docs.length === 0) {
      return NextResponse.json<ApiError>(
        { error: "Upload a PDF or paste some text to check." },
        { status: 400 }
      );
    }

    return NextResponse.json({ docs: capBundle(docs) });
  } catch (error) {
    if (error instanceof IngestError) {
      return NextResponse.json<ApiError>({ error: error.message }, { status: 422 });
    }
    return NextResponse.json<ApiError>({ error: "That document could not be read." }, { status: 500 });
  }
}
