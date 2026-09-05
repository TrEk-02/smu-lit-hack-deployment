import { NextResponse } from "next/server";
import { categoryQuestions, publishedCategoryGates, supportedCategories } from "@/lib/rules";
import type { ApiError, CategoryConfigResponse } from "@/lib/api";

/**
 * GET /api/config/[categoryId]
 * The category-specific question set, fetched after the claimant picks
 * their claim type. Separate from /api/config so the UI doesn't
 * download every category's questions up front.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ categoryId: string }> }
) {
  const { categoryId } = await params; // Next 15: params is a Promise

  const category = supportedCategories().find((c) => c.id === categoryId);
  if (!category) {
    // Unsupported OR has no published gates — same answer either way,
    // and deliberately not "we don't have rules for that yet", which
    // would invite the claimant to proceed anyway.
    const body: ApiError = { error: `Unknown or unsupported category: ${categoryId}` };
    return NextResponse.json(body, { status: 404 });
  }

  const body: CategoryConfigResponse = {
    category,
    questions: categoryQuestions(categoryId),
  };
  void publishedCategoryGates; // (kept explicit: questions derive from published gates only)

  return NextResponse.json(body, { headers: { "Cache-Control": "public, max-age=60" } });
}