// UI-only contracts, independent of Dev A's unfinished schemas and evaluator.
// Reconcile these with shared Answers/Verdict types during integration.
export type IntakeDraft = {
  claimType: string;
  claimAmount: string;
  incidentDate: string;
  description: string;
  evidence: string;
};

export type MockVerdict = {
  status: "needs_review";
  failedGate: string | null;
  provision: string | null;
  plainExplanation: string;
};

export const MOCK_VERDICT: MockVerdict = {
  status: "needs_review",
  failedGate: null,
  provision: null,
  plainExplanation: "Eligibility checking is not connected yet.",
};
