
CREATE TYPE public.bike_status AS ENUM ('Available', 'Reserved', 'Sold');
CREATE TYPE public.media_type AS ENUM ('photo', 'video');

CREATE TABLE public.bikes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER NOT NULL,
  km_covered INTEGER NOT NULL DEFAULT 0,
  rto_number TEXT NOT NULL,
  display_price NUMERIC(12,2) NOT NULL,
  negotiation_percentage NUMERIC(5,2) NOT NULL DEFAULT 3,
  status public.bike_status NOT NULL DEFAULT 'Available',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bikes TO anon, authenticated;
GRANT ALL ON public.bikes TO service_role;
ALTER TABLE public.bikes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can manage bikes (phase 1)" ON public.bikes FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE public.bike_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bike_id UUID NOT NULL REFERENCES public.bikes(id) ON DELETE CASCADE,
  media_type public.media_type NOT NULL,
  file_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bike_media TO anon, authenticated;
GRANT ALL ON public.bike_media TO service_role;
ALTER TABLE public.bike_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can manage bike_media (phase 1)" ON public.bike_media FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_bike_media_bike_id ON public.bike_media(bike_id);
CREATE INDEX idx_bikes_status ON public.bikes(status);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_bikes_updated_at BEFORE UPDATE ON public.bikes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
