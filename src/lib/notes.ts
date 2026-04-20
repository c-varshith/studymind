import { supabase } from "@/integrations/supabase/client";

export type AppNote = {
  id: string;
  title: string;
  content: string;
  updated_at: string;
  tags: string[];
};

export function getErrorMessage(error: unknown, fallback = "Request failed.") {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null) {
    if ("message" in error && typeof (error as { message?: unknown }).message === "string") {
      return (error as { message: string }).message;
    }
    if ("details" in error && typeof (error as { details?: unknown }).details === "string") {
      return (error as { details: string }).details;
    }
    if ("hint" in error && typeof (error as { hint?: unknown }).hint === "string") {
      return (error as { hint: string }).hint;
    }
  }
  return fallback;
}

export function isMissingTagsColumnError(error: unknown) {
  const message = getErrorMessage(error, "");

  return message.toLowerCase().includes("could not find the 'tags' column");
}

function normalizeNote(row: Record<string, unknown>): AppNote {
  return {
    id: String(row.id ?? ""),
    title: String(row.title ?? ""),
    content: String(row.content ?? ""),
    updated_at: String(row.updated_at ?? new Date().toISOString()),
    tags: Array.isArray(row.tags) ? row.tags.map((tag) => String(tag)) : [],
  };
}

export async function fetchNotesWithTagSupport() {
  const baseNotes = await supabase
    .from("notes")
    .select("id,title,content,updated_at")
    .order("updated_at", { ascending: false });

  if (baseNotes.error) {
    throw baseNotes.error;
  }

  const normalizedBaseNotes = ((baseNotes.data ?? []) as Record<string, unknown>[]).map(normalizeNote);

  const withTags = await supabase
    .from("notes")
    .select("id,tags")
    .order("updated_at", { ascending: false });

  if (!withTags.error) {
    const tagsById = new Map(
      ((withTags.data ?? []) as Array<{ id?: unknown; tags?: unknown[] }>).map((row) => [
        String(row.id ?? ""),
        Array.isArray(row.tags) ? row.tags.map((tag) => String(tag)) : [],
      ]),
    );

    return {
      notes: normalizedBaseNotes.map((note) => ({
        ...note,
        tags: tagsById.get(note.id) ?? [],
      })),
      tagsSupported: true,
    };
  }

  return {
    notes: normalizedBaseNotes,
    tagsSupported: false,
  };
}

export async function updateNoteWithSchemaFallback({
  noteId,
  title,
  content,
  tags,
  tagsSupported,
}: {
  noteId: string;
  title: string;
  content: string;
  tags: string[];
  tagsSupported: boolean;
}) {
  if (tagsSupported) {
    const result = await supabase
      .from("notes")
      .update({ title, content, tags })
      .eq("id", noteId);

    if (!result.error) {
      return { tagsSupported: true as const };
    }

    if (!isMissingTagsColumnError(result.error)) {
      throw result.error;
    }
  }

  const fallback = await supabase
    .from("notes")
    .update({ title, content })
    .eq("id", noteId);

  if (fallback.error) {
    throw fallback.error;
  }

  return { tagsSupported: false as const };
}
