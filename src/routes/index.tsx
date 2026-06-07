import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { Link2, Zap, Loader2, Lock } from "lucide-react";
import { getVideoAnalysisStatus, startVideoAnalysis } from "@/lib/video-analysis.functions";
import { lockSite } from "@/lib/site-lock.functions";

const markdownSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), "mark"],
};

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Creator Video Assistant" },
      {
        name: "description",
        content:
          "Paste a YouTube link and generate a complete script, prop list, and production notes.",
      },
    ],
  }),
  component: Index,
});

function PStarsLogo() {
  return (
    <div className="relative h-20 w-20">
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full text-foreground">
        {[
          [50, 8],
          [76, 18],
          [88, 42],
          [82, 68],
          [60, 84],
          [40, 84],
          [18, 68],
          [12, 42],
          [24, 18],
        ].map(([cx, cy], i) => (
          <polygon
            key={i}
            points="0,-3 0.9,-0.9 3,-0.9 1.2,0.6 1.9,3 0,1.5 -1.9,3 -1.2,0.6 -3,-0.9 -0.9,-0.9"
            fill="currentColor"
            transform={`translate(${cx} ${cy})`}
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-serif text-3xl font-black italic text-foreground">P</span>
      </div>
    </div>
  );
}

const LOADING_MESSAGES = [
  "Fetching the video…",
  "Watching the footage…",
  "Transcribing dialogue…",
  "Identifying scenes and props…",
  "Drafting the recreation guide…",
  "Polishing the final notes…",
  "Almost there — long videos take a bit longer…",
];

function isValidYouTubeUrl(url: string): boolean {
  if (!url.trim()) return false;
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      return parsed.searchParams.has("v") && /^[A-Za-z0-9_-]{11}$/.test(parsed.searchParams.get("v") || "");
    }
    if (host === "youtu.be") {
      const id = parsed.pathname.slice(1).split("/")[0];
      return /^[A-Za-z0-9_-]{11}$/.test(id);
    }
    return false;
  } catch {
    return false;
  }
}

function Index() {
  const startAnalysis = useServerFn(startVideoAnalysis);
  const getAnalysisStatus = useServerFn(getVideoAnalysisStatus);
  const lock = useServerFn(lockSite);
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [msgIdx, setMsgIdx] = useState(0);
  const startRef = useRef<number>(0);

  useEffect(() => {
    if (!loading) return;
    startRef.current = Date.now();
    setElapsed(0);
    setMsgIdx(0);
    const tick = setInterval(() => {
      const s = Math.floor((Date.now() - startRef.current) / 1000);
      setElapsed(s);
      setMsgIdx(Math.min(LOADING_MESSAGES.length - 1, Math.floor(s / 15)));
    }, 1000);
    return () => clearInterval(tick);
  }, [loading]);

  async function handleLock() {
    await lock();
    await navigate({ to: "/unlock" });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || loading) return;
    setLoading(true);
    setError(null);
    setNotes(null);
    try {
      const start = await startAnalysis({ data: { url: url.trim() } });
      if (!start?.jobId) {
        setError(start?.error ?? "Could not start video analysis. Please try again.");
        return;
      }

      let attempt = 0;
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1500 : 3000));
        attempt += 1;
        const status = await getAnalysisStatus({ data: { jobId: start.jobId } });

        if (status.status === "completed") {
          setNotes(status.notes);
          return;
        }

        if (status.status === "failed") {
          setError(status.error ?? "Video analysis failed. Please try again.");
          return;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "An unknown error occurred.";
      // Zod validation errors arrive as a JSON string; show a friendly message
      setError(
        msg.includes("valid YouTube link") || msg.includes("ZodError")
          ? "Please paste a valid YouTube link (youtube.com/watch?v=... or youtu.be/...)."
          : msg,
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen px-4 py-10 md:py-16">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={handleLock}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
          >
            <Lock className="h-3.5 w-3.5" />
            Lock
          </button>
        </div>
        <section className="overflow-hidden rounded-3xl border border-border bg-surface shadow-2xl">
          <div className="flex flex-col items-center px-6 py-12 text-center md:px-12 md:py-16">
            <PStarsLogo />
            <h1 className="mt-8 text-3xl font-bold tracking-tight text-foreground md:text-4xl">
              Creator Video Assistant
            </h1>
            <p className="mt-3 max-w-md text-sm text-muted-foreground md:text-base">
              Process videos into scripts, prop lists, and production notes.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-3 border-t border-border bg-surface-elevated p-4 sm:flex-row sm:items-start sm:p-6"
          >
            <div className="relative flex-1">
              <Link2 className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste YouTube Link..."
                disabled={loading}
                className={`h-12 w-full rounded-xl border bg-input pl-11 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 disabled:opacity-50 ${
                  url.trim() && !isValidYouTubeUrl(url)
                    ? "border-destructive focus:border-destructive focus:ring-destructive/40"
                    : "border-border focus:border-ring focus:ring-ring/40"
                }`}
              />
              {url.trim() && !isValidYouTubeUrl(url) && (
                <p className="mt-1.5 text-xs text-destructive">
                  Please enter a valid YouTube URL.
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={loading || !isValidYouTubeUrl(url)}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  Generate Structure
                  <Zap className="h-4 w-4 fill-current" />
                </>
              )}
            </button>
          </form>
        </section>

        {error && (
          <div className="mt-6 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive-foreground">
            {error}
          </div>
        )}

        {loading && !notes && (
          <div className="mt-6 rounded-2xl border border-border bg-surface p-6 text-center">
            <div className="mx-auto mb-3 flex items-center justify-center gap-2 text-sm font-medium text-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {LOADING_MESSAGES[msgIdx]}
            </div>
            <div className="mb-3 text-xs tabular-nums text-muted-foreground">
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} elapsed
            </div>
            <div className="mx-auto h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-primary transition-all duration-1000 ease-linear"
                style={{ width: `${Math.min(95, (elapsed / 180) * 100)}%` }}
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Long videos can take 20+ minutes. Please keep this tab open.
            </p>
          </div>
        )}

        {notes && (
          <article
            className="prose prose-invert mt-6 max-w-none rounded-2xl border border-border bg-surface p-6 md:p-10
            prose-headings:text-foreground prose-p:text-foreground/90 prose-strong:text-foreground
            prose-li:text-foreground/90 prose-a:text-foreground prose-code:text-foreground
            prose-h1:text-3xl prose-h2:mt-8 prose-h2:text-xl prose-h2:uppercase prose-h2:tracking-wide
            prose-mark:bg-yellow-400/20 prose-mark:text-foreground prose-mark:px-1 prose-mark:rounded"
          >
            <ReactMarkdown
              rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSchema]]}
              components={{
                mark: ({ children }) => (
                  <mark className="rounded bg-yellow-400/20 px-1 text-foreground">{children}</mark>
                ),
              }}
            >
              {notes}
            </ReactMarkdown>
          </article>
        )}
      </div>
    </main>
  );
}
