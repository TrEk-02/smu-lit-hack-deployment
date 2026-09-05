import { describe, it, expect } from "vitest";
import { GET as configGET } from "../app/api/config/route";
import { GET as catGET } from "../app/api/config/BREACH_OF_CONTRACT/route";
import { POST } from "../app/api/evaluate/route";

const post = (body: unknown) =>
  POST(
    new Request("http://x/api/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );

const cat = (categoryId: string) =>
  catGET(new Request("http://x"), { params: Promise.resolve({ categoryId }) });

describe("GET /api/config", () => {
  it("reports ready:false while general gates are unpublished, but still lists the category", async () => {
    const res = configGET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ready).toBe(false);
    expect(body.generalQuestions).toEqual([]);
    expect(body.categories.map((c: { id: string }) => c.id)).toEqual(["BREACH_OF_CONTRACT"]);
  });
});

describe("GET /api/config/[categoryId]", () => {
  it("returns renderable questions for breach of contract", async () => {
    const res = await cat("BREACH_OF_CONTRACT");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.questions.length).toBeGreaterThan(0);
    const q = body.questions.find((q: { field: string }) => q.field === "proofOfAgreement");
    expect(q.answerType).toBe("select");
    expect(q.options).toHaveLength(4);
  });

  it("404s an unknown category", async () => {
    expect((await cat("NOPE")).status).toBe(404);
  });

  it("leaks neither the answer key nor legal's internal notes", async () => {
    const text = JSON.stringify(await (await cat("BREACH_OF_CONTRACT")).json());
    expect(text).not.toContain("operator");
    expect(text).not.toContain("UNVERIFIED");
    expect(text).not.toContain("legal to confirm");
  });
});

describe("POST /api/evaluate", () => {
  it("400s on malformed JSON", async () => {
    const res = await POST(new Request("http://x", { method: "POST", body: "{oops" }));
    expect(res.status).toBe(400);
  });

  it("400s when categoryId arrives without categoryAnswers", async () => {
    expect((await post({ generalAnswers: {}, categoryId: "BREACH_OF_CONTRACT" })).status).toBe(400);
  });

  it("503s, not 500s, while general gates are unpublished", async () => {
    const res = await post({ generalAnswers: { claimAmount: 5000 } });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/not yet published/);
  });
});