-- =============================================================================
-- user_activity — track login/activity independent of content
-- =============================================================================

CREATE TABLE public.user_activity (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_day DATE        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, activity_day)
);

ALTER TABLE public.user_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_activity_select" ON public.user_activity
  FOR SELECT USING ((select auth.uid()) = user_id);
CREATE POLICY "user_activity_insert" ON public.user_activity
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

CREATE INDEX idx_user_activity_user ON public.user_activity(user_id, activity_day DESC);


-- =============================================================================
-- Track user login activity
-- =============================================================================
CREATE OR REPLACE FUNCTION public.track_user_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.user_activity (user_id, activity_day)
  VALUES (NEW.id, now()::date)
  ON CONFLICT (user_id, activity_day) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Track activity on auth state changes (login)
CREATE TRIGGER on_auth_user_activity
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (OLD.last_sign_in_at IS DISTINCT FROM NEW.last_sign_in_at)
  EXECUTE FUNCTION public.track_user_activity();
