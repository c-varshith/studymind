
-- updated_at helper
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

-- profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles viewable by everyone" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE TRIGGER profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)));
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- notes
CREATE TABLE public.notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  source_file_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own notes select" ON public.notes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Own notes insert" ON public.notes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own notes update" ON public.notes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Own notes delete" ON public.notes FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER notes_updated BEFORE UPDATE ON public.notes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_notes_user ON public.notes(user_id, updated_at DESC);

-- conversations
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New chat',
  note_id UUID REFERENCES public.notes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own conv select" ON public.conversations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Own conv insert" ON public.conversations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own conv update" ON public.conversations FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Own conv delete" ON public.conversations FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER conv_updated BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- messages
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own msg select" ON public.messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Own msg insert" ON public.messages FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own msg delete" ON public.messages FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_messages_conv ON public.messages(conversation_id, created_at);

-- quizzes
CREATE TABLE public.quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_id UUID REFERENCES public.notes(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own quiz select" ON public.quizzes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Own quiz insert" ON public.quizzes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own quiz update" ON public.quizzes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Own quiz delete" ON public.quizzes FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER quiz_updated BEFORE UPDATE ON public.quizzes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- flashcard decks + cards
CREATE TABLE public.flashcard_decks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_id UUID REFERENCES public.notes(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.flashcard_decks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own deck select" ON public.flashcard_decks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Own deck insert" ON public.flashcard_decks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own deck update" ON public.flashcard_decks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Own deck delete" ON public.flashcard_decks FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER deck_updated BEFORE UPDATE ON public.flashcard_decks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.flashcards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id UUID NOT NULL REFERENCES public.flashcard_decks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.flashcards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own card select" ON public.flashcards FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Own card insert" ON public.flashcards FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own card update" ON public.flashcards FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Own card delete" ON public.flashcards FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_cards_deck ON public.flashcards(deck_id, position);

-- storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('study-files','study-files', false);
CREATE POLICY "Users read own study files" ON storage.objects FOR SELECT
USING (bucket_id = 'study-files' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users upload own study files" ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'study-files' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users update own study files" ON storage.objects FOR UPDATE
USING (bucket_id = 'study-files' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users delete own study files" ON storage.objects FOR DELETE
USING (bucket_id = 'study-files' AND auth.uid()::text = (storage.foldername(name))[1]);
