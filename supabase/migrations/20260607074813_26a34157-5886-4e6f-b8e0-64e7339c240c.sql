CREATE TYPE public.conversation_sender AS ENUM ('customer', 'bot');

CREATE TABLE public.conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone_number text NOT NULL,
  sender public.conversation_sender NOT NULL,
  message text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated, anon;
GRANT ALL ON public.conversations TO service_role;

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can manage conversations (phase 3)"
ON public.conversations FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_conversations_phone ON public.conversations (phone_number, created_at DESC);

CREATE TABLE public.conversation_state (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phone_number text NOT NULL UNIQUE,
  state_verified boolean NOT NULL DEFAULT false,
  current_bike_id uuid,
  negotiation_progress text,
  interested boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_state TO authenticated, anon;
GRANT ALL ON public.conversation_state TO service_role;

ALTER TABLE public.conversation_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can manage conversation_state (phase 3)"
ON public.conversation_state FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_conversation_state_updated_at
BEFORE UPDATE ON public.conversation_state
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();