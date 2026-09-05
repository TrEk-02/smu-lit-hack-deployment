import { describe, it, expect } from "vitest";
import { EvaluateRequestSchema } from "../lib/api";

describe("EvaluateRequestSchema", () => {
  it("accepts general answers alone", () => {
    expect(EvaluateRequestSchema.safeParse({ generalAnswers: { claimAmount: 5000 } }).success).toBe(true);
  });
  it("accepts a full two-phase body", () => {
    const r = EvaluateRequestSchema.safeParse({
      generalAnswers: { claimAmount: 5000 },
      categoryId: "BREACH_OF_CONTRACT",
      categoryAnswers: { proofOfAgreement: "written" },
    });
    expect(r.success).toBe(true);
  });
  it("rejects categoryId without categoryAnswers", () => {
    const r = EvaluateRequestSchema.safeParse({ generalAnswers: {}, categoryId: "BREACH_OF_CONTRACT" });
    expect(r.success).toBe(false);
  });
  it("rejects a non-scalar answer value", () => {
    const r = EvaluateRequestSchema.safeParse({ generalAnswers: { x: { nested: 1 } } });
    expect(r.success).toBe(false);
  });
  it("accepts null as 'don't know'", () => {
    expect(EvaluateRequestSchema.safeParse({ generalAnswers: { claimAmount: null } }).success).toBe(true);
  });
});