CREATE POLICY "Trusted backend can manage video analysis jobs"
ON public.video_analysis_jobs
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);