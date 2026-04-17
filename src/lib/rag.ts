const BACKEND = import.meta.env.DEV
  ? "/api/rag"
  : (import.meta.env.VITE_RAG_BACKEND_URL ?? "http://127.0.0.1:8000");

export async function uploadPdf(
  file: File,
  userId: string,
  noteId: string,
  onProgress?: (msg: string) => void,
): Promise<{ text: string; chunks: number }> {
  onProgress?.("Uploading PDF…");
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(
    `${BACKEND}/upload?user_id=${encodeURIComponent(userId)}&note_id=${encodeURIComponent(noteId)}`,
    { method: "POST", body: form },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Upload failed");
  }

  return res.json();
}

export async function queryRag(
  question: string,
  noteId: string,
  userId: string,
  model?: string,
): Promise<{ answer: string; sources: string[] }> {
  const res = await fetch(`${BACKEND}/query`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ question, note_id: noteId, user_id: userId, model: model ?? "" }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Query failed");
  }

  return res.json();
}

export async function checkBackend(): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}