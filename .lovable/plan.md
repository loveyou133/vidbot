# Long-running video analysis: queue + polling

## Problem
The current `analyzeVideo` server function calls Gemini synchronously. Long YouTube videos take 60s+ and exceed the Cloudflare Worker request budget on the published site, so the client sees "No response from server."

## Solution overview
Replace the synchronous call with:
1. **Submit**: client POSTs the URL → server creates a `jobs` row in Lovable Cloud and triggers an Inngest event → returns `jobId` immediately.
2. **Process**: an Inngest function (durable, runs outside the request) calls Gemini, writes the result (or error) back to the `jobs` row.
3. **Poll**: client polls `getJobStatus(jobId)` every ~3 s until status is `done` or `error`, then renders notes.

## Why this stack
- **Lovable Cloud** (already the recommended DB) stores job status/results — durable across worker restarts.
- **Inngest** (Lovable connector) provides durable background execution with retries; perfect for "kick off something that takes minutes."
- No worker timeout: the user's HTTP request returns in <1 s; the long work happens server-side in Inngest's runtime.

## Steps

1. **Enable Lovable Cloud** and create a `video_jobs` table:
   - `id uuid pk`, `url text`, `status text` (`pending`|`running`|`done`|`error`), `notes text null`, `error text null`, `created_at`, `updated_at`.
   - RLS: anyone can read/insert their own jobs (site is gated by the existing unlock mechanism, so a permissive policy is acceptable here — same trust model as today).
   - GRANTs to `anon` + `authenticated`.

2. **Connect Inngest** via the standard connectors flow. Gives us `LOVABLE_API_KEY` + `INNGEST_API_KEY` + `INNGEST_SIGNING_KEY` automatically.

3. **Create `/api/inngest` server route** (`src/routes/api/inngest.ts`) that serves the Inngest function `analyze-video`:
   - Triggered by event `app/video.analyze`.
   - Reads `jobId` + `url` from event data.
   - Updates job to `running`.
   - Calls Gemini API (existing logic, lifted from `video-analysis.functions.ts`).
   - Writes `notes` or `error` back to the row, status → `done`/`error`.

4. **Rewrite `video-analysis.functions.ts`**:
   - `startVideoAnalysis({ url })`: validates URL, inserts a `pending` job row, sends Inngest event, returns `{ jobId }`.
   - `getVideoAnalysisStatus({ jobId })`: returns `{ status, notes, error }`.
   - Delete the old synchronous `analyzeVideo` export.

5. **Update `src/routes/index.tsx`**:
   - On submit, call `startVideoAnalysis`, store `jobId`.
   - Poll `getVideoAnalysisStatus` every 3 s using `setInterval` (cleared on done/error/unmount).
   - Keep the "Analyzing…" UI while polling; render notes when `done`.

6. **Sync Inngest app**: tell the user to visit `/api/inngest` once after deploy so Inngest discovers the function.

## Technical notes
- Inngest function timeout is far longer than a CF worker request, so Gemini's 60–120 s latency is fine.
- Failure handling: if Gemini returns 400/429/etc., catch and write to `error` column so the client surfaces it just like today.
- The existing site-unlock check moves into `startVideoAnalysis` (gate job creation), not into the Inngest function (which runs server-side with no user context).
- Polling: cap at e.g. 5 minutes (100 polls) to avoid infinite loops; show timeout error after that.

## What stays the same
- `GEMINI_API_KEY` secret and the prompt.
- All UI/markdown rendering.
- Unlock flow.

## Confirmation needed
This requires:
- **Enabling Lovable Cloud** (one click).
- **Linking the Inngest connector** (one click — workspace-level).
- After first deploy, you'll need to visit `https://<your-site>/api/inngest` once so Inngest registers the function.

Confirm and I'll execute steps 1–6.
