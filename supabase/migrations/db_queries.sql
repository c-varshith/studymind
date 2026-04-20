-- =============================================================================
-- StudyMind — full schema migration
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (true);
CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE USING ((select auth.uid()) = user_id);

CREATE TRIGGER profiles_updated
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- -----------------------------------------------------------------------------
-- auto-create profile on signup
-- FIX: SET search_path = '' + fully-qualified table names
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- -----------------------------------------------------------------------------
-- notes
-- -----------------------------------------------------------------------------
CREATE TABLE public.notes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title            TEXT        NOT NULL,
  content          TEXT        NOT NULL DEFAULT '',
  tags             TEXT[]      DEFAULT '{}',
  source_file_path TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notes_select" ON public.notes
  FOR SELECT USING ((select auth.uid()) = user_id);
CREATE POLICY "notes_insert" ON public.notes
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "notes_update" ON public.notes
  FOR UPDATE USING ((select auth.uid()) = user_id);
CREATE POLICY "notes_delete" ON public.notes
  FOR DELETE USING ((select auth.uid()) = user_id);

CREATE TRIGGER notes_updated
  BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_notes_user ON public.notes(user_id, updated_at DESC);


-- -----------------------------------------------------------------------------
-- conversations
-- -----------------------------------------------------------------------------
CREATE TABLE public.conversations (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      TEXT        NOT NULL DEFAULT 'New chat',
  note_id    UUID        REFERENCES public.notes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conversations_select" ON public.conversations
  FOR SELECT USING ((select auth.uid()) = user_id);
CREATE POLICY "conversations_insert" ON public.conversations
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "conversations_update" ON public.conversations
  FOR UPDATE USING ((select auth.uid()) = user_id);
CREATE POLICY "conversations_delete" ON public.conversations
  FOR DELETE USING ((select auth.uid()) = user_id);

CREATE TRIGGER conv_updated
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- FIX: indexes on foreign keys
CREATE INDEX idx_conversations_user    ON public.conversations(user_id);
CREATE INDEX idx_conversations_note_id ON public.conversations(note_id);


-- -----------------------------------------------------------------------------
-- messages
-- -----------------------------------------------------------------------------
CREATE TABLE public.messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID        NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role            TEXT        NOT NULL CHECK (role IN ('user','assistant','system')),
  content         TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messages_select" ON public.messages
  FOR SELECT USING ((select auth.uid()) = user_id);
CREATE POLICY "messages_insert" ON public.messages
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "messages_delete" ON public.messages
  FOR DELETE USING ((select auth.uid()) = user_id);

-- FIX: indexes on foreign keys
CREATE INDEX idx_messages_conv ON public.messages(conversation_id, created_at);
CREATE INDEX idx_messages_user ON public.messages(user_id);


-- -----------------------------------------------------------------------------
-- quizzes
-- -----------------------------------------------------------------------------
CREATE TABLE public.quizzes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_id    UUID        REFERENCES public.notes(id) ON DELETE SET NULL,
  title      TEXT        NOT NULL,
  difficulty TEXT        NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  question_count INT     NOT NULL DEFAULT 5 CHECK (question_count IN (5, 10, 15)),
  questions  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quizzes_select" ON public.quizzes
  FOR SELECT USING ((select auth.uid()) = user_id);
CREATE POLICY "quizzes_insert" ON public.quizzes
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "quizzes_update" ON public.quizzes
  FOR UPDATE USING ((select auth.uid()) = user_id);
CREATE POLICY "quizzes_delete" ON public.quizzes
  FOR DELETE USING ((select auth.uid()) = user_id);

CREATE TRIGGER quiz_updated
  BEFORE UPDATE ON public.quizzes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- FIX: indexes on foreign keys
CREATE INDEX idx_quizzes_user    ON public.quizzes(user_id);
CREATE INDEX idx_quizzes_note_id ON public.quizzes(note_id);


-- -----------------------------------------------------------------------------
-- quiz_results
-- -----------------------------------------------------------------------------
CREATE TABLE public.quiz_results (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quiz_id          UUID        NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  note_id          UUID        REFERENCES public.notes(id) ON DELETE SET NULL,
  total_questions  INT         NOT NULL CHECK (total_questions > 0),
  correct_answers  INT         NOT NULL CHECK (correct_answers >= 0),
  score_percent    NUMERIC(5,2) NOT NULL CHECK (score_percent >= 0 AND score_percent <= 100),
  answers          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (correct_answers <= total_questions)
);
ALTER TABLE public.quiz_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quiz_results_select" ON public.quiz_results
  FOR SELECT USING ((select auth.uid()) = user_id);
CREATE POLICY "quiz_results_insert" ON public.quiz_results
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "quiz_results_delete" ON public.quiz_results
  FOR DELETE USING ((select auth.uid()) = user_id);

CREATE INDEX idx_quiz_results_user ON public.quiz_results(user_id, created_at DESC);
CREATE INDEX idx_quiz_results_quiz ON public.quiz_results(quiz_id, created_at DESC);


-- -----------------------------------------------------------------------------
-- flashcard decks
-- -----------------------------------------------------------------------------
CREATE TABLE public.flashcard_decks (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_id    UUID        REFERENCES public.notes(id) ON DELETE SET NULL,
  title      TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.flashcard_decks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flashcard_decks_select" ON public.flashcard_decks
  FOR SELECT USING ((select auth.uid()) = user_id);
CREATE POLICY "flashcard_decks_insert" ON public.flashcard_decks
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "flashcard_decks_update" ON public.flashcard_decks
  FOR UPDATE USING ((select auth.uid()) = user_id);
CREATE POLICY "flashcard_decks_delete" ON public.flashcard_decks
  FOR DELETE USING ((select auth.uid()) = user_id);

CREATE TRIGGER deck_updated
  BEFORE UPDATE ON public.flashcard_decks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- FIX: indexes on foreign keys
CREATE INDEX idx_flashcard_decks_user    ON public.flashcard_decks(user_id);
CREATE INDEX idx_flashcard_decks_note_id ON public.flashcard_decks(note_id);


-- -----------------------------------------------------------------------------
-- flashcards
-- -----------------------------------------------------------------------------
CREATE TABLE public.flashcards (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id    UUID        NOT NULL REFERENCES public.flashcard_decks(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  front      TEXT        NOT NULL,
  back       TEXT        NOT NULL,
  position   INT         NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.flashcards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flashcards_select" ON public.flashcards
  FOR SELECT USING ((select auth.uid()) = user_id);
CREATE POLICY "flashcards_insert" ON public.flashcards
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY "flashcards_update" ON public.flashcards
  FOR UPDATE USING ((select auth.uid()) = user_id);
CREATE POLICY "flashcards_delete" ON public.flashcards
  FOR DELETE USING ((select auth.uid()) = user_id);

-- FIX: indexes on foreign keys
CREATE INDEX idx_cards_deck      ON public.flashcards(deck_id, position);
CREATE INDEX idx_flashcards_user ON public.flashcards(user_id);


-- -----------------------------------------------------------------------------
-- storage bucket
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
  VALUES ('study-files', 'study-files', false);

CREATE POLICY "storage_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'study-files' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "storage_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'study-files' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "storage_update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'study-files' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "storage_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'study-files' AND auth.uid()::text = (storage.foldername(name))[1]);


-- -----------------------------------------------------------------------------
-- RAG: document chunks
-- -----------------------------------------------------------------------------
CREATE TABLE public.document_chunks (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id     UUID        NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  content     TEXT        NOT NULL,
  chunk_index INT         NOT NULL DEFAULT 0,
  embedding   vector(768),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "document_chunks_select" ON public.document_chunks
  FOR SELECT USING ((select auth.uid()) = user_id);
CREATE POLICY "document_chunks_delete" ON public.document_chunks
  FOR DELETE USING ((select auth.uid()) = user_id);

-- FIX: indexes on foreign keys
CREATE INDEX idx_chunks_note          ON public.document_chunks(note_id);
CREATE INDEX idx_document_chunks_user ON public.document_chunks(user_id);


-- -----------------------------------------------------------------------------
-- match_chunks RPC
-- FIX: SET search_path = public (required for pgvector <=> operator)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_chunks(
  query_embedding vector,
  match_note_id   uuid,
  match_count     int DEFAULT 5
)
RETURNS TABLE (
  id          uuid,
  content     text,
  chunk_index int,
  similarity  float
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    dc.id,
    dc.content,
    dc.chunk_index,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM public.document_chunks dc
  WHERE dc.note_id = match_note_id
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$$;

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

-- Add quiz generation metadata and persisted quiz results

ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard'));

ALTER TABLE public.quizzes
  ADD COLUMN IF NOT EXISTS question_count INT NOT NULL DEFAULT 5 CHECK (question_count IN (5, 10, 15));

CREATE TABLE IF NOT EXISTS public.quiz_results (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quiz_id          UUID         NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  note_id          UUID         REFERENCES public.notes(id) ON DELETE SET NULL,
  total_questions  INT          NOT NULL CHECK (total_questions > 0),
  correct_answers  INT          NOT NULL CHECK (correct_answers >= 0),
  score_percent    NUMERIC(5,2) NOT NULL CHECK (score_percent >= 0 AND score_percent <= 100),
  answers          JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (correct_answers <= total_questions)
);

ALTER TABLE public.quiz_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quiz_results_select" ON public.quiz_results;
CREATE POLICY "quiz_results_select" ON public.quiz_results
  FOR SELECT USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "quiz_results_insert" ON public.quiz_results;
CREATE POLICY "quiz_results_insert" ON public.quiz_results
  FOR INSERT WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "quiz_results_delete" ON public.quiz_results;
CREATE POLICY "quiz_results_delete" ON public.quiz_results
  FOR DELETE USING ((select auth.uid()) = user_id);

CREATE INDEX IF NOT EXISTS idx_quiz_results_user ON public.quiz_results(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_results_quiz ON public.quiz_results(quiz_id, created_at DESC);
