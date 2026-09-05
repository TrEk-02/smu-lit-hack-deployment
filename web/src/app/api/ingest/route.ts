import { NextResponse } from "next/server";
import { IngestError, extractFromPdf, extractFromText } from "@/lib/ingest";
import type { ApiError } from "@/lib/api";

/**
 * POST /api/ingest
 *
 * Accepts multipart form-data with either a `file` (text-layer PDF) or
 * a `text` field (pasted). Returns the extracted text, page by page.
 *
 * The bytes are never stored — they exist only for the length of this
 * request. The response is what the claimant can see we read, and the
 * only thing that later goes to the model (DECISIONS.md §12).
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json<ApiError>({ error: "Expected a file or pasted text." }, { status: 400 });
  }

  const file = form.get("file");
  const text = form.get("text");

  try {
    if (file instanceof File && file.size > 0) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await extractFromPdf(bytes, file.name || "Uploaded document");
      return NextResponse.json(doc);
    }

    if (typeof text === "string" && text.trim()) {
      return NextResponse.json(extractFromText(text));
    }

    return NextResponse.json<ApiError>(
      { error: "Upload a PDF or paste some text to check." },
      { status: 400 }
    );
  } catch (error) {
    if (error instanceof IngestError) {
      return NextResponse.json<ApiError>({ error: error.message }, { status: 422 });
    }
    return NextResponse.json<ApiError>({ error: "That document could not be read." }, { status: 500 });
  }
}
