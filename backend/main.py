from fastapi import FastAPI, UploadFile, File, HTTPException, Query, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import fitz  # PyMuPDF
import httpx
import os
import json
import re
import tempfile
from urllib.parse import urlparse
from pathlib import Path
import shutil
from functools import lru_cache
from supabase import create_client
from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))

app = FastAPI(title="StudyMind RAG Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to your frontend URL in production
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPABASE_URL      = os.getenv("SUPABASE_URL")
SUPABASE_KEY      = os.getenv("SUPABASE_SERVICE_KEY")   # service-role key (bypasses RLS)
OLLAMA_URL        = os.getenv("OLLAMA_URL", "http://localhost:11434")
EMBED_MODEL       = os.getenv("EMBED_MODEL", "nomic-embed-text")
CHAT_MODEL        = os.getenv("CHAT_MODEL", "llama3.2")
QUIZ_MODEL        = os.getenv("QUIZ_MODEL", CHAT_MODEL)
FLASHCARD_MODEL   = os.getenv("FLASHCARD_MODEL", CHAT_MODEL)
TTS_MAX_CHARS     = int(os.getenv("TTS_MAX_CHARS", "12000"))
TTS_ENGINE        = os.getenv("TTS_ENGINE", "espeak-ng")
TTS_VOICE         = os.getenv("TTS_VOICE", "en-us")
TTS_DEFAULT_SPEED  = float(os.getenv("TTS_DEFAULT_SPEED", "1.0"))
CHUNK_SIZE        = int(os.getenv("CHUNK_SIZE", "400"))   # words per chunk
CHUNK_OVERLAP     = int(os.getenv("CHUNK_OVERLAP", "50")) # word overlap between chunks


def parse_csv_env(name: str) -> set[str]:
    raw = os.getenv(name, "")
    return {item.strip().lower() for item in raw.split(",") if item.strip()}


OLLAMA_ALLOWED_HOSTS = parse_csv_env("OLLAMA_ALLOWED_HOSTS")
OLLAMA_ALLOWED_SUFFIXES = parse_csv_env("OLLAMA_ALLOWED_SUFFIXES")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in backend/.env")

sb = create_client(SUPABASE_URL, SUPABASE_KEY)


# ── helpers ──────────────────────────────────────────────────────────────────

def chunk_text(text: str) -> list[str]:
    """Split text into overlapping word-based chunks."""
    words = text.split()
    chunks, i = [], 0
    while i < len(words):
        chunk = " ".join(words[i : i + CHUNK_SIZE])
        if chunk.strip():
            chunks.append(chunk)
        i += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks


@lru_cache(maxsize=1)
def get_espeak_voice_names() -> set[str]:
    """Return the set of installed espeak voice names."""
    espeak_bin = shutil.which("espeak-ng") or shutil.which("espeak")
    if not espeak_bin:
        return set()

    try:
        import subprocess

        result = subprocess.run([espeak_bin, "--voices"], check=False, capture_output=True, text=True)
    except Exception:
        return set()

    voices: set[str] = set()
    for line in result.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 4 and parts[0].isdigit():
            voices.add(parts[3])
    return voices


def parse_json_block(text: str) -> dict:
    """Extract the first JSON object from a model response."""
    cleaned = text.strip().replace("```json", "").replace("```", "")
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    start = cleaned.find("{")
    if start == -1:
        raise ValueError("Model did not return JSON")

    decoder = json.JSONDecoder()
    try:
        parsed, _ = decoder.raw_decode(cleaned[start:])
    except json.JSONDecodeError as e:
        # Fallback: try a broad object slice if model wrapped JSON with prose.
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if not match:
            raise ValueError("Model did not return parseable JSON") from e
        parsed = json.loads(match.group(0))

    if not isinstance(parsed, dict):
        raise ValueError("Model returned non-object JSON")
    return parsed


def normalize_ollama_url(url: str) -> str:
    normalized = (url or "").strip().rstrip("/")
    if not normalized:
        raise ValueError("Ollama URL cannot be empty")

    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Ollama URL must be a valid http(s) URL")

    return normalized


def is_allowed_ollama_host(hostname: str) -> bool:
    host = (hostname or "").strip().lower()
    if not host:
        return False

    if not OLLAMA_ALLOWED_HOSTS and not OLLAMA_ALLOWED_SUFFIXES:
        return True

    if host in OLLAMA_ALLOWED_HOSTS:
        return True

    return any(host == suffix or host.endswith(f".{suffix}") for suffix in OLLAMA_ALLOWED_SUFFIXES)


def validate_ollama_endpoint(url: str) -> str:
    normalized = normalize_ollama_url(url)
    parsed = urlparse(normalized)
    hostname = (parsed.hostname or "").strip().lower()

    if not is_allowed_ollama_host(hostname):
        raise ValueError(
            "Host is not in allowlist. Configure OLLAMA_ALLOWED_HOSTS or OLLAMA_ALLOWED_SUFFIXES."
        )

    # Force HTTPS for non-localhost endpoints to avoid sending prompts to cleartext endpoints.
    if hostname not in {"localhost", "127.0.0.1", "::1"} and parsed.scheme != "https":
        raise ValueError("Non-local Ollama endpoints must use https")

    return normalized


def resolve_ollama_url(request: Request) -> str:
    # Allow users to supply a per-request endpoint so each user can target
    # their own local Ollama tunnel without changing global Render env vars.
    header_url = request.headers.get("x-ollama-url")
    if not header_url:
        try:
            return validate_ollama_endpoint(OLLAMA_URL)
        except ValueError as exc:
            raise HTTPException(500, f"Invalid backend OLLAMA_URL configuration: {exc}") from exc
    try:
        return validate_ollama_endpoint(header_url)
    except ValueError as exc:
        raise HTTPException(400, f"Invalid x-ollama-url header: {exc}") from exc


async def get_embedding(text: str, ollama_url: str) -> list[float]:
    """Call Ollama embeddings API."""
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                f"{ollama_url}/api/embeddings",
                json={"model": EMBED_MODEL, "prompt": text},
            )
            r.raise_for_status()
            return r.json()["embedding"]
    except httpx.RequestError as e:
        raise HTTPException(503, f"Could not reach Ollama at {ollama_url}: {e}") from e
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, f"Ollama embeddings failed ({e.response.status_code}): {e.response.text[:300]}") from e

def synthesize_with_espeak(text: str, speed: float = 1.0, voice: str = "default") -> bytes:
    """Generate speech audio from text using espeak-ng."""
    if TTS_ENGINE not in {"espeak", "espeak-ng"}:
        raise HTTPException(500, f"Unsupported TTS_ENGINE '{TTS_ENGINE}'. Use espeak-ng.")

    espeak_bin = shutil.which("espeak-ng") or shutil.which("espeak")
    if not espeak_bin:
        raise HTTPException(500, "espeak-ng binary not found on the system")

    speed_value = max(80, min(450, int(175 * speed)))
    voice_value = voice if voice and voice != "default" else TTS_VOICE
    available_voices = get_espeak_voice_names()
    if available_voices and voice_value not in available_voices:
        voice_value = TTS_VOICE if TTS_VOICE in available_voices else "en-us"

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        wav_path = tmp.name

    try:
        import subprocess

        result = subprocess.run(
            [espeak_bin, "-v", voice_value, "-s", str(speed_value), "-w", wav_path, text],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise HTTPException(500, f"espeak-ng synthesis failed: {result.stderr.strip() or result.stdout.strip() or 'unknown error'}")

        with open(wav_path, "rb") as f:
            audio = f.read()

        if not audio:
            raise HTTPException(500, "espeak-ng returned no audio")

        return audio
    finally:
        try:
            os.unlink(wav_path)
        except Exception:
            pass


# ── routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    espeak_bin = shutil.which("espeak-ng") or shutil.which("espeak")
    return {
        "status": "ok",
        "embed_model": EMBED_MODEL,
        "chat_model": CHAT_MODEL,
        "default_ollama_url": OLLAMA_URL,
        "ollama_allowed_hosts": sorted(OLLAMA_ALLOWED_HOSTS),
        "ollama_allowed_suffixes": sorted(OLLAMA_ALLOWED_SUFFIXES),
        "tts_engine": TTS_ENGINE,
        "tts_binary": espeak_bin,
        "tts_voice": TTS_VOICE,
        "tts_default_speed": TTS_DEFAULT_SPEED,
    }


@app.post("/upload")
async def upload_pdf(
    request: Request,
    file: UploadFile = File(...),
    user_id: str = Query(...),
    note_id: str = Query(...),
):
    """
    1. Extract text from PDF
    2. Chunk it
    3. Embed each chunk via Ollama
    4. Store chunks in Supabase document_chunks table
    Returns the full extracted text so the frontend can fill the note body.
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are supported")

    contents = await file.read()

    # Extract text
    try:
        doc = fitz.open(stream=contents, filetype="pdf")
        pages_text = [page.get_text() for page in doc]
        doc.close()
        full_text = "\n\n".join(pages_text).strip()
    except Exception as e:
        raise HTTPException(500, f"PDF parsing failed: {e}")

    if not full_text:
        raise HTTPException(400, "No extractable text found in this PDF (it may be scanned/image-based)")

    chunks = chunk_text(full_text)
    ollama_url = resolve_ollama_url(request)

    # Delete any existing chunks for this note (re-upload scenario)
    try:
        sb.table("document_chunks").delete().eq("note_id", note_id).execute()
    except Exception as e:
        raise HTTPException(500, f"Failed to clear existing chunks: {e}") from e

    # Embed + store chunks
    rows = []
    for i, chunk in enumerate(chunks):
        embedding = await get_embedding(chunk, ollama_url)
        rows.append({
            "note_id":     note_id,
            "user_id":     user_id,
            "content":     chunk,
            "chunk_index": i,
            "embedding":   embedding,
        })

    # Insert in batches of 50 to stay within payload limits
    batch_size = 50
    try:
        for start in range(0, len(rows), batch_size):
            sb.table("document_chunks").insert(rows[start : start + batch_size]).execute()
    except Exception as e:
        raise HTTPException(500, f"Failed to store chunk embeddings in Supabase: {e}") from e

    return {
        "ok":     True,
        "chunks": len(chunks),
        "text":   full_text,
    }


class QueryRequest(BaseModel):
    question: str
    note_id:  str = ""
    user_id:  str
    model:    str = ""   # optional override; falls back to CHAT_MODEL


class QuizRequest(BaseModel):
    content: str
    count: int = 5
    difficulty: str = "medium"
    model: str = ""  # optional override; falls back to QUIZ_MODEL


class FlashcardsRequest(BaseModel):
    content: str
    count: int = 10
    model: str = ""  # optional override; falls back to FLASHCARD_MODEL


class SummaryRequest(BaseModel):
    content: str
    max_points: int = 8
    mode: str = "standard"
    model: str = ""  # optional override; falls back to CHAT_MODEL


class TTSRequest(BaseModel):
    text: str
    voice: str = "default"
    speed: float = 1.0


@app.post("/query")
async def query_rag(req: QueryRequest, request: Request):
    """
    1. Embed the question
    2. Similarity-search document_chunks via pgvector RPC
    3. Build prompt with top-k context
    4. Call Ollama chat model
    Returns the answer + source chunks.
    """
    model = req.model or CHAT_MODEL
    ollama_url = resolve_ollama_url(request)

    sources = []

    if req.note_id:
        q_embedding = await get_embedding(req.question, ollama_url)

        # Vector search
        try:
            result = sb.rpc("match_chunks", {
                "query_embedding": q_embedding,
                "match_note_id":   req.note_id,
                "match_count":     5,
            }).execute()
        except Exception as e:
            raise HTTPException(500, f"Vector search failed: {e}") from e

        if result.data:
            sources = [r["content"] for r in result.data]

    if sources:
        context = "\n\n---\n\n".join(sources)
        prompt = f"""You are a helpful study assistant. Answer the question using ONLY the context below from the user's document.
If the answer isn't in the context, say so clearly.

Context:
{context}

Question: {req.question}

Answer:"""
    else:
        prompt = f"""You are a helpful study assistant. Answer clearly and concisely.

Question: {req.question}

Answer:"""

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(
                f"{ollama_url}/api/generate",
                json={"model": model, "prompt": prompt, "stream": False},
            )
            r.raise_for_status()
            answer = r.json()["response"]
    except httpx.RequestError as e:
        raise HTTPException(503, f"Could not reach Ollama at {ollama_url}: {e}") from e
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, f"Ollama generation failed ({e.response.status_code}): {e.response.text[:300]}") from e

    return {"answer": answer, "sources": sources}


@app.post("/quiz-generate")
async def generate_quiz(req: QuizRequest, request: Request):
    content = (req.content or "").strip()
    if not content:
        raise HTTPException(400, "content required")

    count = max(1, min(20, int(req.count)))
    difficulty = (req.difficulty or "medium").strip().lower()
    if difficulty not in {"easy", "medium", "hard"}:
        difficulty = "medium"

    model = req.model or QUIZ_MODEL
    ollama_url = resolve_ollama_url(request)

    prompt = f"""Generate {count} multiple-choice quiz questions from the study material below.
Return ONLY valid JSON in this exact shape:
{{
  "title": "short quiz title",
  "questions": [
    {{
      "question": "...",
      "options": ["A", "B", "C", "D"],
      "correctIndex": 0,
      "explanation": "..."
    }}
  ]
}}

Rules:
- Exactly 4 options per question.
- correctIndex must be 0..3.
- Difficulty must be {difficulty}.
- Easy: recall and direct understanding.
- Medium: application and comparison.
- Hard: multi-step reasoning and edge cases.
- No markdown, no comments, JSON only.

Study material:
{content[:12000]}
"""

    try:
        async with httpx.AsyncClient(timeout=180) as client:
            r = await client.post(
                f"{ollama_url}/api/generate",
                json={"model": model, "prompt": prompt, "stream": False},
            )
            r.raise_for_status()
            raw = r.json().get("response", "")
    except httpx.RequestError as e:
        raise HTTPException(503, f"Could not reach Ollama at {ollama_url}: {e}") from e
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, f"Ollama quiz generation failed ({e.response.status_code}): {e.response.text[:300]}") from e

    try:
        parsed = parse_json_block(raw)
    except Exception as e:
        raise HTTPException(502, f"Could not parse quiz JSON from model response: {e}") from e

    title = parsed.get("title") or "Generated Quiz"
    questions = parsed.get("questions")
    if not isinstance(questions, list) or not questions:
        raise HTTPException(502, "Model response missing questions array")

    normalized_questions = []
    for idx, q in enumerate(questions):
        if not isinstance(q, dict):
            continue
        question = str(q.get("question", "")).strip()
        options = q.get("options")
        explanation = str(q.get("explanation", "")).strip()
        if not question:
            continue

        # Accept multiple option formats from smaller/local models.
        normalized_options: list[str] = []
        if isinstance(options, list):
            normalized_options = [str(o).strip() for o in options if str(o).strip()]
        elif isinstance(options, dict):
            ordered_keys = ["A", "B", "C", "D", "a", "b", "c", "d", "1", "2", "3", "4"]
            for key in ordered_keys:
                if key in options and str(options[key]).strip():
                    normalized_options.append(str(options[key]).strip())
            if not normalized_options:
                normalized_options = [str(v).strip() for v in options.values() if str(v).strip()]
        elif isinstance(options, str):
            lines = [line.strip(" -\t") for line in options.splitlines()]
            normalized_options = [line for line in lines if line]

        if len(normalized_options) < 2:
            continue

        # Enforce exactly 4 options for the frontend contract.
        if len(normalized_options) > 4:
            normalized_options = normalized_options[:4]
        while len(normalized_options) < 4:
            normalized_options.append(f"Option {len(normalized_options) + 1}")

        correct_index = q.get("correctIndex", q.get("correct_index", q.get("answerIndex", q.get("answer"))))

        try:
            ci = int(correct_index)
        except Exception:
            if isinstance(correct_index, str):
                answer_token = correct_index.strip()
                letter_map = {"A": 0, "B": 1, "C": 2, "D": 3, "a": 0, "b": 1, "c": 2, "d": 3}
                if answer_token in letter_map:
                    ci = letter_map[answer_token]
                else:
                    match_idx = next((i for i, opt in enumerate(normalized_options) if opt.lower() == answer_token.lower()), -1)
                    ci = match_idx if match_idx >= 0 else 0
            else:
                ci = 0

        if ci < 0 or ci > 3:
            ci = 0

        normalized_questions.append({
            "question": question,
            "options": normalized_options,
            "correctIndex": ci,
            "explanation": explanation or f"Review the key idea behind question {idx + 1}.",
        })

    if not normalized_questions:
        raise HTTPException(502, "Model returned invalid quiz question format")

    return {"title": str(title), "questions": normalized_questions[:count]}


@app.post("/flashcards-generate")
async def generate_flashcards(req: FlashcardsRequest, request: Request):
    content = (req.content or "").strip()
    if not content:
        raise HTTPException(400, "content required")

    count = max(1, min(50, int(req.count)))
    model = req.model or FLASHCARD_MODEL
    ollama_url = resolve_ollama_url(request)

    prompt = f"""Generate {count} high-quality study flashcards from the material below.
Return ONLY valid JSON in this exact shape:
{{
  "title": "short deck title",
  "cards": [
    {{
      "front": "clear question or prompt",
      "back": "concise answer"
    }}
  ]
}}

Rules:
- Keep each front and back concise and factual.
- Avoid duplicates.
- No markdown, no comments, JSON only.

Study material:
{content[:12000]}
"""

    try:
        async with httpx.AsyncClient(timeout=180) as client:
            r = await client.post(
                f"{ollama_url}/api/generate",
                json={"model": model, "prompt": prompt, "stream": False},
            )
            r.raise_for_status()
            raw = r.json().get("response", "")
    except httpx.RequestError as e:
        raise HTTPException(503, f"Could not reach Ollama at {ollama_url}: {e}") from e
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, f"Ollama flashcard generation failed ({e.response.status_code}): {e.response.text[:300]}") from e

    try:
        parsed = parse_json_block(raw)
    except Exception as e:
        raise HTTPException(502, f"Could not parse flashcards JSON from model response: {e}") from e

    title = parsed.get("title") or "Generated Flashcards"
    cards = parsed.get("cards")
    if not isinstance(cards, list) or not cards:
        raise HTTPException(502, "Model response missing cards array")

    normalized_cards = []
    for c in cards:
        if not isinstance(c, dict):
            continue
        front = str(c.get("front", "")).strip()
        back = str(c.get("back", "")).strip()
        if front and back:
            normalized_cards.append({"front": front, "back": back})

    if not normalized_cards:
        raise HTTPException(502, "Model returned invalid flashcard format")

    return {"title": str(title), "cards": normalized_cards[:count]}


@app.post("/summarize-note")
async def summarize_note(req: SummaryRequest, request: Request):
    content = (req.content or "").strip()
    if not content:
        raise HTTPException(400, "content required")

    max_points = max(3, min(15, int(req.max_points)))
    model = req.model or CHAT_MODEL
    mode = (req.mode or "standard").strip().lower()
    ollama_url = resolve_ollama_url(request)

    if mode == "eli5":
        prompt = f"""You are helping a student understand a topic like they are 10 years old.

Return ONLY valid JSON in this exact shape:
{{
  "title": "short friendly title",
  "summary": "2-4 sentence plain-language explanation",
  "analogy": "one simple analogy",
  "bullets": ["short point", "..."],
  "key_terms": ["term", "..."] ,
  "visual_flow": [
    {{ "label": "step name", "note": "short explanation" }}
  ]
}}

Rules:
- Keep language simple and concrete.
- visual_flow should have 3 to 6 connected steps.
- bullets should have up to {max_points} items.
- No markdown code blocks.

Study material:
{content[:15000]}
"""

        try:
            async with httpx.AsyncClient(timeout=180) as client:
                r = await client.post(
                    f"{ollama_url}/api/generate",
                    json={"model": model, "prompt": prompt, "stream": False},
                )
                r.raise_for_status()
                raw = str(r.json().get("response", "")).strip()
        except httpx.RequestError as e:
            raise HTTPException(503, f"Could not reach Ollama at {ollama_url}: {e}") from e
        except httpx.HTTPStatusError as e:
            raise HTTPException(502, f"Ollama summarization failed ({e.response.status_code}): {e.response.text[:300]}") from e

        try:
            parsed = parse_json_block(raw)
        except Exception:
            # Fallback to plain summary if the model returns malformed JSON.
            return {
                "mode": "eli5",
                "title": "ELI5 Summary",
                "summary": raw or "No summary generated.",
                "analogy": "",
                "bullets": [],
                "key_terms": [],
                "visual_flow": [],
            }

        visual_flow = parsed.get("visual_flow") if isinstance(parsed.get("visual_flow"), list) else []
        normalized_flow = []
        for item in visual_flow[:6]:
            if not isinstance(item, dict):
                continue
            label = str(item.get("label", "")).strip()
            note = str(item.get("note", "")).strip()
            if label:
                normalized_flow.append({"label": label, "note": note})

        bullets = parsed.get("bullets") if isinstance(parsed.get("bullets"), list) else []
        key_terms = parsed.get("key_terms") if isinstance(parsed.get("key_terms"), list) else []

        normalized_bullets = [str(b).strip() for b in bullets[:max_points] if str(b).strip()]

        # Guarantee visual output in ELI5 mode even if the model omits visual_flow.
        if not normalized_flow:
            seed_points = normalized_bullets[:4]
            if not seed_points:
                seed_points = [s.strip() for s in str(parsed.get("summary", "")).split(".") if s.strip()][:4]

            for idx, point in enumerate(seed_points, start=1):
                normalized_flow.append({
                    "label": f"Step {idx}",
                    "note": point,
                })

        return {
            "mode": "eli5",
            "title": str(parsed.get("title", "ELI5 Summary")).strip() or "ELI5 Summary",
            "summary": str(parsed.get("summary", "")).strip() or raw,
            "analogy": str(parsed.get("analogy", "")).strip(),
            "bullets": normalized_bullets,
            "key_terms": [str(k).strip() for k in key_terms[:12] if str(k).strip()],
            "visual_flow": normalized_flow,
        }

    prompt = f"""Summarize the study material below for a student.

Output format:
- Start with a one-line title.
- Then provide up to {max_points} concise bullet points.
- End with a short "Key terms:" line listing the most important terms.

Rules:
- Keep it clear and factual.
- Avoid markdown code blocks.
- Do not invent details that are not present in the material.

Study material:
{content[:15000]}
"""

    try:
        async with httpx.AsyncClient(timeout=180) as client:
            r = await client.post(
                f"{ollama_url}/api/generate",
                json={"model": model, "prompt": prompt, "stream": False},
            )
            r.raise_for_status()
            summary = str(r.json().get("response", "")).strip()
    except httpx.RequestError as e:
        raise HTTPException(503, f"Could not reach Ollama at {ollama_url}: {e}") from e
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, f"Ollama summarization failed ({e.response.status_code}): {e.response.text[:300]}") from e

    if not summary:
        raise HTTPException(502, "Model returned an empty summary")

    return {
        "mode": "standard",
        "title": "Summary",
        "summary": summary,
        "analogy": "",
        "bullets": [],
        "key_terms": [],
        "visual_flow": [],
    }


@app.post("/tts-generate")
async def tts_generate(req: TTSRequest):
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(400, "text required")

    clipped = text[:TTS_MAX_CHARS]
    audio = synthesize_with_espeak(clipped, req.speed or TTS_DEFAULT_SPEED, req.voice)
    return Response(content=audio, media_type="audio/wav")
