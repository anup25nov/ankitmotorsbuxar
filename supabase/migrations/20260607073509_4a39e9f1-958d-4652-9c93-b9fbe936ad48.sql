
CREATE TYPE public.lead_status AS ENUM ('New','Store Visit Scheduled','Visited','Sold','Lost');

CREATE TABLE public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT NOT NULL,
  bike_id UUID REFERENCES public.bikes(id) ON DELETE SET NULL,
  bike_name TEXT,
  last_offered_price NUMERIC(12,2),
  conversation_summary TEXT,
  status public.lead_status NOT NULL DEFAULT 'New',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO anon, authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can manage leads (phase 2)" ON public.leads FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_leads_status ON public.leads(status);
CREATE INDEX idx_leads_created_at ON public.leads(created_at DESC);
CREATE INDEX idx_leads_phone ON public.leads(phone_number);

CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.lead_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_events TO anon, authenticated;
GRANT ALL ON public.lead_events TO service_role;
ALTER TABLE public.lead_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can manage lead_events (phase 2)" ON public.lead_events FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_lead_events_lead ON public.lead_events(lead_id, created_at DESC);

-- Auto-log status changes to timeline
CREATE OR REPLACE FUNCTION public.log_lead_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.lead_events (lead_id, event_type, description)
    VALUES (NEW.id, 'created', 'Lead created with status ' || NEW.status);
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.lead_events (lead_id, event_type, description)
    VALUES (NEW.id, 'status_change', 'Status changed from ' || OLD.status || ' to ' || NEW.status);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lead_status_change
AFTER INSERT OR UPDATE OF status ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.log_lead_status_change();
