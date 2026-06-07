CREATE TABLE public.video_analysis_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  notes TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.video_analysis_jobs TO service_role;

ALTER TABLE public.video_analysis_jobs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.update_video_analysis_jobs_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_video_analysis_jobs_updated_at
BEFORE UPDATE ON public.video_analysis_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_video_analysis_jobs_updated_at();