import { NextResponse } from "next/server";
import {
  ACCEPTED_MIME,
  IngestError,
  MAX_DOCS,
  capBundle,
  extractFromImage,
  extractFromPdf,
  extractFromText,
  isImage,
  type ExtractedDoc,
} from "@/lib/ingest";
import { LlmBadOutputError, LlmUnavailableError } from "@/lib/llm/openrouter";
import type { ApiError } from "@/lib/api";

/**
 * POST /api/ingest
 *
 * Accepts multipart form-data with any number of `file` entries — text-layer
 * PDFs and screenshots (PNG/JPEG/WebP), up to MAX_DOCS in total — and/or a
 * `text` field (pasted). Returns the text, document by document, page by page,
 * each labelled with how it was obtained.
 *
 * A PDF's text layer is extracted mechanically, and that is always preferred.
 * Where there is none — a screenshot, or the image-only PDF you get from
 * printing or exporting a chat thread — the words are transcribed by a
 * separate model call that is shown the file and nothing else: no gates, no
 * answers, no claim. It cannot fabricate toward a useful answer, and quote
 * verification downstream still checks findings against text the finding model
 * did not write.
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
    // Reject the whole bundle on an unreadable type before doing any work.
    // Validating inside the read loop meant paying for four transcriptions and
    // then throwing them away because the fifth file was a .docx.
    const rejected = files.find(
      (file) => !(ACCEPTED_MIME as readonly string[]).includes(file.type)
    );
    if (rejected) {
      return NextResponse.json<ApiError>(
        {
          error: `"${rejected.name || "That file"}" is not a file type we can read. Upload a PDF or a screenshot (PNG, JPEG or WebP), or paste the text.`,
        },
        { status: 415 }
      );
    }

    // Concurrently, not one after another. Transcription is a ~8s model call
    // per file and the files are independent, so five screenshots read
    // serially is forty seconds of the claimant watching nothing happen.
    // Promise.all preserves input order, which capBundle depends on.
    const docs: ExtractedDoc[] = await Promise.all(
      files.map(async (file) => {
        const name = file.name || "Uploaded document";
        const bytes = new Uint8Array(await file.arrayBuffer());
        return isImage(file.type)
          ? extractFromImage(bytes, file.type, name)
          : extractFromPdf(bytes, name);
      })
    );

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
    // Transcription needs the model; extracting a text layer does not. A PDF
    // reaches here too when it turned out to be a picture in a PDF wrapper.
    // Say the service failed — do not blame the claimant's file.
    if (error instanceof LlmUnavailableError) {
      console.error("[ingest] transcription unavailable:", error.message);
      return NextResponse.json<ApiError>(
        {
          error:
            "That file has no text in it, so we had to read the words off the page — and the service that does that is unavailable right now. Try a text-based PDF, or paste the messages as text.",
        },
        { status: 503 }
      );
    }
    if (error instanceof LlmBadOutputError) {
      console.error("[ingest] transcription failed:", error.message);
      return NextResponse.json<ApiError>(
        { error: "The words could not be read off that file. Try a clearer image, or paste the messages as text." },
        { status: 502 }
      );
    }
    return NextResponse.json<ApiError>({ error: "That document could not be read." }, { status: 500 });
  }
}
