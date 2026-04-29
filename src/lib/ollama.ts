const OLLAMA_URL_STORAGE_KEY = "studymind.ollamaUrl";
const AI_MODE_STORAGE_KEY = "studymind.aiMode";
const AI_API_KEY_STORAGE_KEY = "studymind.aiApiKey";

export type AiMode = "local" | "api-key";

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

function normalizeApiKey(value: string): string {
  return value.trim();
}

function normalizeAiMode(mode: string): AiMode {
  return mode === "api-key" ? "api-key" : "local";
}

export function getStoredOllamaUrl(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(OLLAMA_URL_STORAGE_KEY) ?? "";
}

export function getStoredAiMode(): AiMode {
  if (typeof window === "undefined") return "local";
  const raw = window.localStorage.getItem(AI_MODE_STORAGE_KEY) ?? "local";
  return normalizeAiMode(raw);
}

export function setStoredAiMode(mode: AiMode): AiMode {
  if (typeof window === "undefined") return "local";
  const normalized = normalizeAiMode(mode);
  window.localStorage.setItem(AI_MODE_STORAGE_KEY, normalized);
  try {
    window.dispatchEvent(new Event("studymind:ai-config-updated"));
  } catch {
    // ignore
  }
  return normalized;
}

export function getStoredApiKey(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(AI_API_KEY_STORAGE_KEY) ?? "";
}

export function setStoredApiKey(rawApiKey: string): string {
  if (typeof window === "undefined") return "";

  const normalized = normalizeApiKey(rawApiKey);
  if (!normalized) {
    window.localStorage.removeItem(AI_API_KEY_STORAGE_KEY);
    try {
      window.dispatchEvent(new Event("studymind:ai-config-updated"));
    } catch {
      // ignore
    }
    return "";
  }

  window.localStorage.setItem(AI_API_KEY_STORAGE_KEY, normalized);
  try {
    window.dispatchEvent(new Event("studymind:ai-config-updated"));
  } catch {
    // ignore
  }
  return normalized;
}

export function setStoredOllamaUrl(rawUrl: string): string {
  if (typeof window === "undefined") return "";

  const normalized = normalize(rawUrl);
  if (!normalized) {
    window.localStorage.removeItem(OLLAMA_URL_STORAGE_KEY);
    return "";
  }

  if (!isValidHttpUrl(normalized)) {
    throw new Error("AI endpoint URL must be a valid http(s) URL.");
  }

  window.localStorage.setItem(OLLAMA_URL_STORAGE_KEY, normalized);
  try {
    window.dispatchEvent(new Event("studymind:ai-config-updated"));
  } catch {
    // ignore
  }
  return normalized;
}

export function getOllamaHeaders(): Record<string, string> {
  const mode = getStoredAiMode();
  const url = getStoredOllamaUrl().trim();
  if (mode === "local") {
    if (!url) return {};
    return { "x-ollama-url": url };
  }

  const apiKey = getStoredApiKey().trim();
  const headers: Record<string, string> = { "x-ai-mode": "api-key" };
  if (url) headers["x-ollama-url"] = url;
  if (apiKey) headers["x-ollama-api-key"] = apiKey;
  return headers;
}
