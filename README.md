# 🧠 StudyMind — AI-Powered Study Assistant

StudyMind is a full-stack RAG (Retrieval-Augmented Generation) application that lets you upload PDFs, chat with your notes, generate quizzes and flashcards, and get AI-powered summaries.

By default, StudyMind uses **local models via Ollama**. Users can now also switch to an **API key mode** from the Profile page and connect to an external AI endpoint.

**Live Demo:** https://studymind-rho.vercel.app

---

## ✨ Features

- 📄 **PDF Upload & Embedding** — Upload notes and have them chunked + embedded into a vector database
- 💬 **RAG Chat** — Ask questions about your uploaded notes with context-aware answers
- 🧪 **Quiz Generation** — Auto-generate multiple choice quizzes from your notes
- 🃏 **Flashcard Generation** — Create study flashcards instantly
- 📝 **Summarization** — Get concise summaries of your notes
- 🔊 **Text-to-Speech** — Listen to your notes read aloud

---

## 🏗️ Architecture

```
┌─────────────────────┐        ┌──────────────────────┐
│   Frontend (Vercel) │──────▶│  Backend (Render)     │
│   React + Vite      │        │  FastAPI + Python     │
└─────────────────────┘        └──────────┬───────────┘
                                           │
                    ┌──────────────────────┼────────────────────┐
                    │                      │                    │
           ┌────────▼──────┐    ┌──────────▼────────┐  ┌──────▼──────┐
           │ Supabase      │    │ ngrok tunnel       │  │ Local Ollama│
           │ (Postgres +   │    │ (public HTTPS URL) │  │ on your     │
           │  pgvector)    │    └──────────┬─────────┘  │  machine)   │
           └───────────────┘               │             └──────▲──────┘
                                           └────────────────────┘

## AI Connection Modes

StudyMind supports two AI modes from **Profile -> AI Endpoint**:

- **Local model mode (default):** uses Ollama on your own machine (directly in local dev, or through a tunnel for hosted frontend/backend).
- **API key mode:** disable local mode, enter an endpoint URL and API key, then save. The app sends the key only in API key mode.

Use **Test connection** in the same Profile section to verify your current settings before using chat, quiz, flashcards, summaries, or PDF embedding.

> ⚠️ If local mode is enabled and your Ollama/tunnel is down, AI features will fail.

### Local Mode Setup (Recommended)

#### Step 1 — Run Ollama locally

Install [Ollama](https://ollama.com), pull the required models, and start the server:

```bash
ollama pull llama3.1          # ~4.7 GB — chat & generation model
ollama pull nomic-embed-text  # ~274 MB — embedding model
ollama serve
```

#### Step 2 — Expose Ollama via ngrok (for hosted app usage)

The backend on Render can't reach `localhost` directly, so ngrok gives it a public HTTPS URL.

1. Install [ngrok](https://ngrok.com) and authenticate your account.
2. Run:
   ```bash
   ngrok http 11434 --host-header="localhost:11434"
   ```
3. Copy the `https://xxxx-xxxx.ngrok-free.dev` URL from the terminal output.
4. Open https://studymind-rho.vercel.app, go to **Profile -> AI Endpoint**, keep **Use local model** enabled, and paste the ngrok URL.

> **Free ngrok URLs are ephemeral.** They change every time ngrok restarts. Each user should update their own URL in **Profile -> AI Endpoint** when it changes.

Once both are running, head to the site, upload a PDF, and start chatting.

### API Key Mode Setup

If you want to use a hosted/provider endpoint instead of local Ollama:

1. Go to **Profile -> AI Endpoint**.
2. Turn off **Use local model**.
3. Enter your AI endpoint URL.
4. Enter your API key.
5. Click **Save AI settings**.
6. Click **Test connection**.

Notes:

- The API key is stored in browser local storage for that user/session on that browser.
- The backend forwards credentials to the configured endpoint using `Authorization: Bearer <key>` and `api-key: <key>` headers.
- If your provider requires additional/custom headers beyond those two, adapt backend forwarding in `backend/main.py`.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, Vite, TypeScript, Tailwind CSS, shadcn/ui |
| Backend | FastAPI, Python 3.12 |
| Database | Supabase (PostgreSQL + pgvector) |
| AI Models | Local Ollama (llama3.1, nomic-embed-text) or API-key-based endpoint |
| Hosting | Vercel (frontend), Render (backend) |
| Tunnel | ngrok (exposes local Ollama to Render) |

---

## 📁 Project Structure

```
studymind/
├── src/                          # React frontend
│   ├── components/               # AppShell, NavLink, ProtectedRoute, shadcn UI
│   ├── hooks/                    # useAuth, useRecorder, use-toast, use-mobile
│   ├── lib/                      # api.ts, rag.ts — backend API calls
│   ├── pages/                    # Landing, Auth, Dashboard, Notes, Chat,
│   │                             # Quiz, Flashcards, Profile, NotFound
│   └── integrations/supabase/    # Supabase client + auto-generated types
│
├── backend/                      # FastAPI backend
│   ├── main.py                   # All API routes
│   ├── requirements.txt          # Python dependencies
│   ├── models/piper/             # Local TTS model (Piper ONNX)
│   └── scripts/                  # setup_piper_tts.sh
│
├── supabase/
│   ├── functions/                # Edge functions
│   │   ├── chat/                 # Streaming chat with note context
│   │   ├── generate-quiz/        # AI quiz generation
│   │   ├── generate-flashcards/  # AI flashcard generation
│   │   ├── tts/                  # Text-to-speech
│   │   └── stt/                  # Speech-to-text
│   └── migrations/               # Database schema migrations
│
├── public/                       # Static assets
├── vercel.json                   # Client-side routing config for Vercel
├── package.json                  # Frontend dependencies
├── requirements.txt              # Root-level Python deps (for Render)
└── index.html                    # Vite entry point
```

---

## 🚀 Running Locally (Development)

### Prerequisites

- Node.js 18+
- Python 3.10–3.12
- [Ollama](https://ollama.com) installed
- A [Supabase](https://supabase.com) project
- [Supabase CLI](https://supabase.com/docs/guides/cli) (for running migrations)

### 1. Clone the repo

```bash
git clone https://github.com/c-varshith/studymind.git
cd studymind
```

### 2. Pull the required Ollama models

```bash
ollama pull llama3.1
ollama pull nomic-embed-text
ollama serve
```

### 3. Initialize the Supabase database

Create a new project at [supabase.com](https://supabase.com), then run the migration to set up all tables, RLS policies, storage bucket, and triggers.

**Option A — Supabase CLI (recommended)**

```bash
# Link to your project (find your project ref in the Supabase dashboard URL)
supabase link --project-ref <your-project-ref>

# Push the migration
supabase db push
```

**Option B — SQL Editor (manual)**

1. Open your Supabase project → **SQL Editor**.
2. Copy the contents of `supabase/migrations/20260416182031_*.sql` and paste it into the editor.
3. Click **Run**.

This migration creates the following schema:

| Table | Description |
|-------|-------------|
| `profiles` | User profile, auto-created on signup |
| `notes` | Uploaded notes and their extracted text |
| `conversations` | Chat sessions linked to notes |
| `messages` | Individual chat messages (user + assistant) |
| `quizzes` | Generated quizzes stored as JSONB |
| `flashcard_decks` | Flashcard deck metadata |
| `flashcards` | Individual flashcard front/back pairs |
| `storage.study-files` | Private bucket for uploaded PDFs |

All tables have Row Level Security enabled — users can only access their own data.

### 4. Set up the backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Create `backend/.env`:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
OLLAMA_URL=http://localhost:11434
```

Run the backend:
```bash
uvicorn main:app --reload --port 8000
```

API docs at: `http://localhost:8000/docs`

### 5. Set up the frontend

```bash
# From the project root
npm install
```

Create `.env.local` in the project root:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key
VITE_RAG_BACKEND_URL=http://localhost:8000
```

Run the frontend:
```bash
npm run dev
```

Frontend at: `http://localhost:5173`

---

## 🌐 Production Deployment

### Frontend → Vercel

1. Import this repo in [Vercel](https://vercel.com).
2. Framework preset: **Vite**
3. Add environment variables:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key
   VITE_RAG_BACKEND_URL=https://your-backend.onrender.com
   ```
4. Deploy — `vercel.json` in the root handles client-side routing automatically.

### Backend → Render

1. Create a new **Web Service** in [Render](https://render.com) from this repo.
2. Set the **Root Directory** to `backend`.
3. Runtime: **Python**
4. Build command: `pip install -r requirements.txt`
5. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
6. Add environment variables:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_KEY=your-service-role-key
   OLLAMA_URL=https://optional-default-ollama-url
   OLLAMA_ALLOWED_SUFFIXES=ngrok-free.dev,ngrok.app,trycloudflare.com
   OLLAMA_ALLOWED_HOSTS=your-static-tunnel.example.com
   ```

`OLLAMA_URL` is a **default fallback**. Users can override endpoint and mode from the app UI in **Profile -> AI Endpoint**.

### Exposing Ollama via ngrok

```bash
# Start Ollama
ollama serve

# In a new terminal, start ngrok
ngrok http 11434 --host-header="localhost:11434"
```

Copy the `https://xxxx-xxxx.ngrok-free.dev` URL and set it in **Profile -> AI Endpoint** inside the app.

> ⚠️ Free ngrok URLs change on every restart. Update the URL in **Profile -> AI Endpoint** each time, or use a paid ngrok plan for a static domain.

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/upload` | Upload and embed a PDF |
| POST | `/query` | RAG query against a note |
| POST | `/quiz-generate` | Generate a quiz from a note |
| POST | `/flashcards-generate` | Generate flashcards from a note |
| POST | `/summarize-note` | Summarize a note |
| POST | `/tts-generate` | Text-to-speech generation |

Full interactive docs: `https://your-backend.onrender.com/docs`

---

## ⚙️ Environment Variables

### Backend (Render / local)

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase **service role** key (not the anon key) |
| `OLLAMA_URL` | Optional default fallback AI endpoint URL. Per-user URL can be set in Profile -> AI Endpoint. |
| `OLLAMA_ALLOWED_SUFFIXES` | Optional comma-separated domain suffix allowlist for `x-ollama-url` (e.g., `ngrok-free.dev,trycloudflare.com`). |
| `OLLAMA_ALLOWED_HOSTS` | Optional comma-separated exact host allowlist for `x-ollama-url` (e.g., `abc-123.ngrok-free.dev,my-tunnel.example.com`). |

When either allowlist variable is set, any user-provided AI endpoint host outside the allowlist is rejected.
For non-local hosts, the backend also requires `https`.

### Frontend (Vercel / local)

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase anon/public key |
| `VITE_RAG_BACKEND_URL` | Backend URL in production; can be `http://localhost:8000` locally |

### Runtime headers sent by frontend

- Always in local mode: optional `x-ollama-url` when custom endpoint is provided.
- In API key mode: `x-ai-mode: api-key`, optional `x-ollama-url`, and `x-ollama-api-key`.

---

## ⚠️ Known Limitations

- **Local mode depends on your own machine/tunnel.** If Ollama or ngrok stops, AI requests in local mode will fail.
- **API key mode requires provider compatibility.** The backend forwards `Authorization: Bearer` and `api-key`; providers needing extra headers or different paths may require backend customization.
- **Free ngrok URLs are ephemeral** — the URL changes on every restart, so each user must refresh their value in Profile -> AI Endpoint unless they use a static tunnel domain.
- **Render cold starts** — the free tier spins down after inactivity; the first request may take ~30 seconds to respond.

---

## 📄 License

MIT
