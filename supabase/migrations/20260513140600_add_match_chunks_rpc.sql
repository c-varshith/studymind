-- =============================================================================
-- Ensure pgvector is available for vector operations
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;


-- =============================================================================
-- Add embedding column to document_chunks if it doesn't exist
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'document_chunks' AND column_name = 'embedding'
  ) THEN
    ALTER TABLE public.document_chunks ADD COLUMN embedding vector(768);
  END IF;
END $$;


-- =============================================================================
-- match_chunks RPC for vector search
-- =============================================================================

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
