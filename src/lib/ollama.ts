const OLLAMA_URL_STORAGE_KEY = "studymind.ollamaUrl";

function normalize(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function getStoredOllamaUrl(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(OLLAMA_URL_STORAGE_KEY) ?? "";
}

export function setStoredOllamaUrl(rawUrl: string): string {
  if (typeof window === "undefined") return "";

  const normalized = normalize(rawUrl);
  if (!normalized) {
    window.localStorage.removeItem(OLLAMA_URL_STORAGE_KEY);
    return "";
  }

  if (!isValidHttpUrl(normalized)) {
    throw new Error("Ollama URL must be a valid http(s) URL.");
  }

  window.localStorage.setItem(OLLAMA_URL_STORAGE_KEY, normalized);
  return normalized;
}

export function getOllamaHeaders(): Record<string, string> {
  const url = getStoredOllamaUrl().trim();
  if (!url) return {};
  return { "x-ollama-url": url };
}
