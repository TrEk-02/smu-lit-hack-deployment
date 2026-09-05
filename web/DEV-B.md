# Dev B: screens and deployment

- `src/app/page.tsx`: intake form and result view, with edit and reset actions.
- `src/lib/mock-verdict.ts`: isolated UI types and the fixed mock verdict. No dependency on legal rules or Dev A's evaluator.
- Inputs are provisional; agree the final question set with legal and Dev A before integration.
- Optional answers remain blank rather than implying a legal answer. Basic browser validation checks required fields and positive amounts only.
- No API calls, persistence, legal assessment, or actual claim submission are implemented.

Local walkthrough:

1. Run `npm run dev` inside `web`.
2. Submit an empty form: the browser should request the required fields.
3. Enter fictional details and select Preview result: the labelled mock result should appear.
4. Select Edit answers: the values should remain populated.
5. Select Start over from the result: the form should be cleared.
6. Check the layout on a narrow screen and navigate the form using the keyboard.

Vercel deployment:

1. Commit and push the reviewed UI files to your GitHub branch.
2. Sign into Vercel and import `TrEk-02/SMU-LiT-Hack`.
3. Set Root Directory to `web`, with the Next.js framework preset.
4. Keep the detected install/build/output defaults. No environment variables or API keys are needed for this mock.
5. Deploy and repeat the walkthrough on the resulting URL.
6. Save the URL in the team handoff. Deployment is not complete until that URL works.

Integration handoff:

- Agree shared Answers and Verdict schemas with Dev A.
- Convert input strings to the required types at the validated API boundary.
- Replace the fixed mock result in the submit flow with the real evaluator response.
- Add pending/error states when a real asynchronous request is introduced.
- Render all agreed statuses and real source references; keep the mock label until real checking is connected.
