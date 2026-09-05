import { NextResponse } from "next/server";
import { generalQuestions, partyQuestions, publishedGeneralGates, rules, supportedCategories } from "@/lib/rules";
import type { ConfigResponse } from "@/lib/api";

/**
 * GET /api/config
 * Everything the UI needs to render the general-eligibility form and
 * the category picker. No input, no side effects — hence GET, not POST.
 *
 * `ready: false` means legal hasn't published the general gates yet.
 * The UI should show "not configured", not an empty form that looks
 * like it works.
 */
export function GET() {
  const body: ConfigResponse = {
    version: rules.version,
    ready: publishedGeneralGates.length > 0,
    categories: supportedCategories(),
    generalQuestions,
    partyQuestions: partyQuestions(),
  };

  return NextResponse.json(body, {
    // rules.json is read at build/import time, so this is safe to cache
    // for the length of a demo. Drop to no-store if legal is editing live.
    headers: { "Cache-Control": "public, max-age=60" },
  });
}