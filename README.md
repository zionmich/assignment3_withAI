# Logical Fallacy Classification Study — With AI

This is a **separate React + Vite website** for Assignment 3's `with_ai` condition. It reuses the exact layout, task instructions, 1–5 human confidence slider, timing logic, and resume behavior from the existing Without-AI website. The only task-related UI addition is a **visible AI-predicted category** for each comment. The participant still makes the final choice.

**This project does not replace or alter your working Without-AI React site.** Deploy it as a separate website and create a second Supabase Edge Function named `study-ai`.

## Existing tables — no new SQL required

The With-AI website uses the SAME three Supabase tables as the existing baseline:

| Table | Purpose |
| --- | --- |
| `public."200_Tests"` | Original 200 comments plus `model_prediction`, `model_confidence`, and `ground_truth`. |
| `public.study_condition_sessions` | Enrollment and 8 assigned comments for each `(uniqname, condition)`; this site uses `with_ai`. |
| `public.study_responses` | Participant classification, confidence (1–5), trial number, and elapsed milliseconds; this site writes `condition = 'with_ai'`. |

**Do not run a SQL migration again** if these three tables already work with your existing baseline. No SQL migration is included or needed for the AI website.

Your existing uniqueness constraint on `(uniqname, condition)` means the **same uniqname can participate once in each condition**. No separate `study_participants` table is needed.

## 1. Deploy the new Edge Function in Supabase

Use **Supabase Dashboard → Edge Functions → Deploy a new function → Via Editor**:

1. Name the function exactly **`study-ai`**.
2. Keep the filename **`index.ts`**.
3. Replace its default contents with all of `supabase/functions/study-ai/index.ts` from this ZIP.
4. Deploy it.
5. Under the function's settings/details, **turn off Verify JWT**. This implementation uses a private random study-session token, not Supabase Auth.

Alternatively, from your project folder with the Supabase CLI configured:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy study-ai
```

The endpoint will be:

```
https://YOUR_PROJECT_REF.supabase.co/functions/v1/study-ai
```

The function must have `SUPABASE_URL` and a server-side `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY` configured in Supabase's Edge Function environment. These are NEVER placed in React `.env` or browser code.

### What the AI endpoint does

- Registers a uniqname in `study_condition_sessions` as `with_ai`, allowing only one session per uniqname per condition.
- Samples **8 distinct** comments randomly from `200_Tests` and saves those assignments.
- If the participant has already enrolled in `without_ai`, excludes *all eight comments assigned there* before sampling (see optional baseline update below).
- Returns the article headline and parent comment when available, target comment, and BERT's **saved `model_prediction`** (no live model inference).
- Never returns `ground_truth` (correct answers) to the browser.
- Accepts and records final classifications, human-confidence ratings, and elapsed time in `study_responses`.
- Restores in-progress sessions using the browser's saved token after refresh.

### Optional model-confidence display

**Default:** Only the AI's suggested class is displayed. The participant separately rates *their own* confidence.

If you want to display BERT's numerical confidence score too, go to **Supabase → Edge Functions → Secrets** and add:

```
STUDY_SHOW_AI_CONFIDENCE=true
```

Then redeploy `study-ai` if necessary. The backend includes `model_confidence` in trial responses only when that setting is enabled; React will automatically display it as `Model confidence score: XX.X%`.

BERT's softmax score is not a calibrated probability of being correct. If you change this setting during data collection, record when it changed because the experimental treatment will differ across participants.

## 2. Run the React website

This website is its own Vite project. Extract it into **its own folder**, separate from your existing `assignment3` baseline folder.

Create `.env` in the same folder as `package.json` (or copy `.env.example` to `.env`):

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
```

Do **not** add a service-role or secret key. An optional public `VITE_SUPABASE_PUBLISHABLE_KEY` may be used, but the current endpoint does not require it.

Then:

```bash
npm install
npm run dev
```

Open the URL Vite prints. If your baseline site is also running on port 5173, you can use:

```bash
npm run dev -- --port 5174
```

To deploy a public version, run `npm run build`, and host `dist/` separately from the baseline site (for example, a second Vercel project). Set `VITE_SUPABASE_URL` in the host's environment before building.

## 3. Optional: patch your existing Without-AI Edge Function to avoid repeated comments

The **new AI function** always tries to exclude comments that were assigned previously in the baseline. This is enough if every participant does **Without AI first**.

Your assignment counterbalances order: some participants take **With AI first**. To prevent repeated comments in *both* orders, update the existing baseline Edge Function as well:

1. Supabase → Edge Functions → `study-baseline` → Edit Code (`index.ts`).
2. Replace the code with `supabase/functions/study-baseline/index.ts` from this ZIP.
3. Redeploy it. Keep the name `study-baseline` and Verify JWT off.

That is the same baseline function as before, with **only one behavioral change**: on new enrollment it excludes comments already assigned in `with_ai`. It preserves the original website, interface, and data storage. Already-created sessions keep their assignments, even when this patch is deployed.

Neither function needs a new SQL table or column.

## 4. Verify before classmates use the studies

1. Complete With AI using a **throwaway test uniqname**. The instruction screen should explain the AI's role.
2. Confirm the headline and parent comment only appear when present.
3. Each trial should show an AI suggested **category** before the radio choices, but must **not pre-select** a radio button.
4. Check the 1–5 *participant* confidence slider and its `?` definitions.
5. Submit 8 questions. Supabase `study_responses` should contain eight rows with `condition = 'with_ai'`, trial numbers 1–8, and a `time_spent_ms` value.
6. Verify `study_condition_sessions` contains one row for that uniqname and `with_ai` with a non-null `completed_at` after the last trial.
7. Refresh midway through another test session to confirm it resumes and does not lose saved answers. As in the baseline, refreshing **resets the current question timer**.
8. Re-register the same uniqname in the AI site from a new browser session; it should show the duplicate-registration message.
9. Try the same uniqname in the Without-AI site: it should still be allowed once in the other condition.
10. If you deployed the baseline patch, inspect `assigned_comment_ids` across both conditions for the same uniqname and confirm no overlap.
11. Confirm the browser never receives the `ground_truth` column.

### Important limitations

- The site does **not** authenticate uniqnames through UMich SSO. A typed uniqname can be impersonated.
- If a user loses local browser storage after registration, they cannot self-enroll again; an administrator must help recover or reset their incomplete session.
- The duplicate-enrollment message says 'already completed' even if the participant registered but exited before completing; it matches the existing baseline behavior.
- The timer is based on the participant's browser and resets for the current trial after refresh. As in baseline, it is not a tamper-proof stopwatch.
- Do not share the Supabase service-role key or secret key in the frontend.
- The code is included for you to deploy and test. It is not a live, hosted website.
