
CREATE POLICY "bike-media read (phase 1)" ON storage.objects FOR SELECT USING (bucket_id = 'bike-media');
CREATE POLICY "bike-media insert (phase 1)" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'bike-media');
CREATE POLICY "bike-media update (phase 1)" ON storage.objects FOR UPDATE USING (bucket_id = 'bike-media');
CREATE POLICY "bike-media delete (phase 1)" ON storage.objects FOR DELETE USING (bucket_id = 'bike-media');
