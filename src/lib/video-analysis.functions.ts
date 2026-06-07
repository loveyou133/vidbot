import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { waitUntil } from "./request-context.server";

const InputSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, "URL is required")
    .refine((v) => {
      try {
        const u = new URL(v.startsWith("http") ? v : `https://${v}`);
        const host = u.hostname.toLowerCase().replace(/^www\./, "");
        return (
          host === "youtube.com" ||
          host === "m.youtube.com" ||
          host === "youtu.be" ||
          host.endsWith(".youtube.com")
        );
      } catch {
        return false;
      }
    }, "Please paste a valid YouTube link"),
});

function normalizeYouTubeUrl(value: string) {
  const input = value.trim();
  const url = new URL(input.startsWith("http") ? input : `https://${input}`);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const videoId =
    host === "youtu.be" ? url.pathname.slice(1).split("/")[0] : url.searchParams.get("v");

  if (!videoId) return input;
  return `https://www.youtube.com/watch?v=${videoId}`;
}

const SYSTEM_PROMPT = `ROLE:
You are an Expert Video Analyst and Content Strategist. Your job is to meticulously reverse-engineer successful YouTube videos so a creator can replicate them step-by-step.

TASK:
Analyze the provided video and generate a comprehensive "Recreation Guide". You must transcribe, describe, and format the entire video into a detailed script, prop list, and production notes.

LANGUAGE:
The output must be entirely in Czech, matching the tone and vocabulary of the reference notes.

OUTPUT STRUCTURE & FORMATTING RULES:
You must strictly follow this exact document structure. Use Markdown for formatting (bolding, bullet points).

1. Název Videa (nebo víc variant názvu)
   - Propose 1-3 catchy YouTube titles based on the video's concept.

2. Příprava (odkazy, myšlenkový pochody, praktická příprava, rizika a příprava na jejich řešení)
   - List logistics to arrange (e.g., "-autobus domluvit", "-učitele domluvit").
   - List the specific outfits required under a sub-header "Outfit [Character Name] ať si vezme na sebe:" (e.g., shirts, ties, suits, glasses).
   - Detail the locations needed (e.g., "-na škole - jídelna, tělocvična, knihovna...").

3. S sebou vzít, ke každé věci napsat, kdo to bere, včetně techniky - seznam
   - Create an exhaustive, bulleted list of EVERY single prop, piece of equipment, and wardrobe item seen in the video.
   - Append a checkmark emoji (✅) to items.
   - Group specific items logically (e.g., "-Špagety s omáčkou vzít z domu v krabičce").

4. Koupit
   - Items that specifically need to be purchased beforehand.

5. Domluvení účastníci a jejich záloha
   - Notes on participants and backup plans (e.g., "zálohu alespoň tak, kdyby to 50 % lidí zrušilo, tak točíme i tak").

6. Trasa a časový harmonogram
   - Note to map out locations logically.

7. SCENE-BY-SCENE SCRIPT BREAKDOWN
   - Break the video down chronologically using headers like **INTRO**, **ZAČÁTEK VIDEA**, followed by specific location/scene headers (e.g., **UKLÍZEČ A TĚLOCVIČNA**).
   - Action & Camera: Describe every cut, camera movement, and character action in detail. Use terms like "(Rychlý střih)", "Střih na...", "(zpomaleny zaber)".
   - Dialogue: Write out the exact spoken dialogue in quotes.
   - Visuals: Note on-screen text, facial expressions ("vypada nervozne", "zacne se smat"), and precise physical interactions. Do not summarize; write it as a literal play-by-play.

8. ZÁVĚR
   - Describe the closing scene, how the winner/loser is announced, and the final call to action/outro.

9. [NAME] SEZNAM OBJEDNÁVÁNÍ
   - Repeat a consolidated bulleted list of the most critical props and items needed for the shoot to act as a final shopping/packing checklist.

RULES:
- The ENTIRE output must be in Czech.
- No summarizing — provide recreation-grade detail.
- If the video cannot be analyzed, return a clear error message in Czech starting with "ERROR:".
- Do not add any preamble or outro outside the structure above. No "Here is the analysis:". Just the markdown itself.`;

const MODEL = "gemini-2.5-flash";

type AnalysisResult = { notes: string | null; error: string | null };
type JobStatus = "queued" | "processing" | "completed" | "failed";
type DbRow = Record<string, unknown>;
type QueryResult = Promise<{ data: DbRow | null; error: unknown }>;
type JobQueryBuilder = {
  insert: (values: DbRow) => JobQueryBuilder;
  update: (values: DbRow) => JobQueryBuilder;
  select: (columns: string) => JobQueryBuilder;
  eq: (column: string, value: unknown) => JobQueryBuilder;
  single: () => QueryResult;
};
type JobsDb = { from: (table: "video_analysis_jobs") => JobQueryBuilder };

function getJobsDb() {
  return supabaseAdmin as unknown as JobsDb;
}

function isStaleQueuedJob(createdAt: string | null, updatedAt: string | null) {
  const timestamp = Date.parse(updatedAt ?? createdAt ?? "");
  return Number.isFinite(timestamp) && Date.now() - timestamp > 15_000;
}

async function generateVideoAnalysis(videoUrl: string): Promise<AnalysisResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      notes: null,
      error: "API key is not configured. Add it in Project Settings → Secrets.",
    };
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Analyze this YouTube video and produce a complete recreation guide per the system instructions. Video URL: ${videoUrl}`,
          },
          {
            file_data: {
              file_uri: videoUrl,
              mime_type: "video/mp4",
            },
          },
        ],
      },
    ],
    generationConfig: {
      maxOutputTokens: 8192,
      temperature: 0.7,
    },
  };

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("AI API error:", res.status, errText);
      if (res.status === 401 || res.status === 403) {
        return {
          notes: null,
          error: "Invalid API key. Please check your API key configuration.",
        };
      }
      if (res.status === 429) {
        return { notes: null, error: "Too many requests. Please try again in a moment." };
      }
      if (res.status === 400) {
        return {
          notes: null,
          error:
            "This video could not be processed. It may be private, age-restricted, region-blocked, or too long.",
        };
      }
      return {
        notes: null,
        error: "Video analysis failed. Please try again or contact support.",
      };
    }

    const result = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
      promptFeedback?: { blockReason?: string };
    };

    if (result.promptFeedback?.blockReason) {
      return {
        notes: null,
        error: `Video was blocked by safety filters (${result.promptFeedback.blockReason}).`,
      };
    }

    const candidate = result.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

    if (!text.trim()) {
      console.error("AI returned empty response:", JSON.stringify(result));
      return {
        notes: null,
        error: "The AI returned an empty response. The video may be unavailable.",
      };
    }

    const truncated = candidate?.finishReason === "MAX_TOKENS";
    const notes = truncated
      ? `${text}\n\n---\n\n*Note: Output was truncated due to length limits.*`
      : text;

    return { notes, error: null };
  } catch (err) {
    console.error("generateVideoAnalysis failed:", err);
    return { notes: null, error: "Video analysis failed. Please try again or contact support." };
  }
}

async function processVideoAnalysisJob(jobId: string, videoUrl: string) {
  const db = getJobsDb();

  const { data: claimedJob, error: claimError } = await db
    .from("video_analysis_jobs")
    .update({ status: "processing", error: null })
    .eq("id", jobId)
    .eq("status", "queued")
    .select("id")
    .single();

  if (claimError || !claimedJob?.id) {
    return;
  }

  const result = await generateVideoAnalysis(videoUrl);

  await db
    .from("video_analysis_jobs")
    .update({
      status: result.error ? "failed" : "completed",
      notes: result.notes,
      error: result.error,
    })
    .eq("id", jobId);
}

export const startVideoAnalysis = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const { isUnlockedServer } = await import("./site-lock.server");
    if (!isUnlockedServer()) {
      return { jobId: null, error: "Locked. Please unlock the site first." };
    }
    const videoUrl = normalizeYouTubeUrl(data.url);
    const db = getJobsDb();
    const { data: job, error } = await db
      .from("video_analysis_jobs")
      .insert({ video_url: videoUrl, status: "queued" })
      .select("id")
      .single();

    if (error || !job?.id) {
      console.error("Failed to create video analysis job:", error);
      return { jobId: null, error: "Could not start video analysis. Please try again." };
    }

    const jobId = String(job.id);
    waitUntil(processVideoAnalysisJob(jobId, videoUrl));
    return { jobId, error: null };
  });

export const getVideoAnalysisStatus = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { isUnlockedServer } = await import("./site-lock.server");
    if (!isUnlockedServer()) {
      return { status: "failed", notes: null, error: "Locked. Please unlock the site first." };
    }

    const db = getJobsDb();
    const { data: job, error } = await db
      .from("video_analysis_jobs")
      .select("status, notes, error, video_url, created_at, updated_at")
      .eq("id", data.jobId)
      .single();

    if (error || !job) {
      console.error("Failed to fetch video analysis job:", error);
      return {
        status: "failed",
        notes: null,
        error: "Analysis job was not found. Please try again.",
      };
    }

    const status = job.status as JobStatus;
    if (
      status === "queued" &&
      isStaleQueuedJob(job.created_at as string | null, job.updated_at as string | null)
    ) {
      waitUntil(processVideoAnalysisJob(data.jobId, job.video_url as string));
      return { status: "processing" as const, notes: null, error: null };
    }

    return {
      status,
      notes: (job.notes as string | null) ?? null,
      error: (job.error as string | null) ?? null,
    };
  });
