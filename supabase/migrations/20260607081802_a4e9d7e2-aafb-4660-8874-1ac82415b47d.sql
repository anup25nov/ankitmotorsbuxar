
-- 1) Role system
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own roles" ON public.user_roles;
CREATE POLICY "Users can read their own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 2) Security-definer helpers (avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'admin');
$$;

-- 3) Auto-grant admin to the very first signup (bootstrap the owner)
CREATE OR REPLACE FUNCTION public.bootstrap_first_admin()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_assign_role ON auth.users;
CREATE TRIGGER on_auth_user_created_assign_role
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.bootstrap_first_admin();

-- 4) Drop wide-open public policies on every app table
DROP POLICY IF EXISTS "Public can manage bikes (phase 1)" ON public.bikes;
DROP POLICY IF EXISTS "Public can manage bike_media (phase 1)" ON public.bike_media;
DROP POLICY IF EXISTS "Public can manage leads (phase 2)" ON public.leads;
DROP POLICY IF EXISTS "Public can manage lead_events (phase 2)" ON public.lead_events;
DROP POLICY IF EXISTS "Public can manage conversations (phase 3)" ON public.conversations;
DROP POLICY IF EXISTS "Public can manage conversation_state (phase 3)" ON public.conversation_state;

-- 5) Admin-only policies on every app table.
--    Background server code uses the service role and bypasses RLS.
CREATE POLICY "Admins manage bikes"
  ON public.bikes FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Admins manage bike_media"
  ON public.bike_media FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Admins manage leads"
  ON public.leads FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Admins manage lead_events"
  ON public.lead_events FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Admins manage conversations"
  ON public.conversations FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Admins manage conversation_state"
  ON public.conversation_state FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 6) Revoke any lingering anon privileges, ensure authenticated/service_role can reach tables
REVOKE ALL ON public.bikes, public.bike_media, public.leads, public.lead_events,
              public.conversations, public.conversation_state FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bikes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bike_media TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_state TO authenticated;

GRANT ALL ON public.bikes, public.bike_media, public.leads, public.lead_events,
             public.conversations, public.conversation_state TO service_role;

-- 7) Lock down bike-media storage to admins only.
--    Server signed URLs are issued via service role, which bypasses these policies.
DROP POLICY IF EXISTS "bike-media read (phase 1)" ON storage.objects;
DROP POLICY IF EXISTS "bike-media insert (phase 1)" ON storage.objects;
DROP POLICY IF EXISTS "bike-media update (phase 1)" ON storage.objects;
DROP POLICY IF EXISTS "bike-media delete (phase 1)" ON storage.objects;

CREATE POLICY "bike-media admin read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'bike-media' AND public.is_admin());

CREATE POLICY "bike-media admin insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'bike-media' AND public.is_admin());

CREATE POLICY "bike-media admin update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'bike-media' AND public.is_admin())
  WITH CHECK (bucket_id = 'bike-media' AND public.is_admin());

CREATE POLICY "bike-media admin delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'bike-media' AND public.is_admin());
