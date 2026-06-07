-- Restore public access to dashboard tables (auth layer removed for now)
DROP POLICY IF EXISTS "Admins manage bikes" ON public.bikes;
DROP POLICY IF EXISTS "Admins manage bike_media" ON public.bike_media;
DROP POLICY IF EXISTS "Admins manage leads" ON public.leads;
DROP POLICY IF EXISTS "Admins manage lead_events" ON public.lead_events;
DROP POLICY IF EXISTS "Admins manage conversations" ON public.conversations;
DROP POLICY IF EXISTS "Admins manage conversation_state" ON public.conversation_state;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bikes TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bike_media TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_events TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_state TO anon, authenticated;

CREATE POLICY "Public access bikes" ON public.bikes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access bike_media" ON public.bike_media FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access leads" ON public.leads FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access lead_events" ON public.lead_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access conversations" ON public.conversations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access conversation_state" ON public.conversation_state FOR ALL USING (true) WITH CHECK (true);

-- Storage: allow public access to bike-media bucket
DROP POLICY IF EXISTS "Admins manage bike-media objects" ON storage.objects;
CREATE POLICY "Public access bike-media" ON storage.objects FOR ALL USING (bucket_id = 'bike-media') WITH CHECK (bucket_id = 'bike-media');