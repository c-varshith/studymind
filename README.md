# StudyMind

An AI-powered study companion that turns your notes into interactive learning experiences. Built with React, Vite, TypeScript, Tailwind CSS, and Lovable Cloud (Supabase).

## ✨ Features

- **📝 Smart Notes** — Create, edit, and autosave notes with a clean two-pane editor
- **🎙️ Voice-to-Text** — Dictate notes using ElevenLabs Scribe speech recognition
- **🔊 Text-to-Speech** — Listen to your notes and AI responses with ElevenLabs voices
- **🤖 AI Tutor Chat** — Streaming chat that can use any of your notes as context (powered by Google Gemini via Lovable AI Gateway)
- **❓ AI Quiz Generator** — Turn any note into a multiple-choice quiz with explanations and auto-scoring
- **🃏 AI Flashcards** — Generate flip-card decks from your notes for active recall study
- **🔐 Authentication** — Email/password auth with protected routes and per-user data isolation (RLS)

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite 5 + TypeScript 5 |
| Styling | Tailwind CSS v3 + shadcn/ui |
| Backend | Lovable Cloud (Supabase: Postgres, Auth, Storage, Edge Functions) |
| AI Chat / Generation | Lovable AI Gateway (Google Gemini) |
| Voice (TTS + STT) | ElevenLabs |

## 🗂 Project Structure

```
src/
├── components/      # AppShell, ProtectedRoute, shadcn UI primitives
├── hooks/           # useAuth, useRecorder, use-toast
├── lib/             # api.ts (chat stream, TTS, STT, quiz, flashcards)
├── pages/           # Landing, Auth, Notes, Chat, Quiz, Flashcards
└── integrations/    # Auto-generated Supabase client + types

supabase/
└── functions/
    ├── chat/                 # Streaming chat with note context
    ├── generate-quiz/        # AI quiz generation (function-calling)
    ├── generate-flashcards/  # AI flashcard generation
    ├── tts/                  # ElevenLabs text-to-speech
    └── stt/                  # ElevenLabs speech-to-text
```

## 🚀 Getting Started (Local Dev)

```bash
npm install
npm run dev
```

The app runs at `http://localhost:8080`. Lovable Cloud (database + edge functions) is already configured via the auto-managed `.env` file.

## 🔑 Required Secrets

Configured in Lovable Cloud → Edge Function Secrets:

- `LOVABLE_API_KEY` — auto-provisioned for the Lovable AI Gateway
- `ELEVENLABS_API_KEY` — your ElevenLabs API key (for TTS + STT)

## 🗄 Database Schema

Per-user tables protected by Row Level Security:

- `profiles` — display name per user
- `notes` — title, content, optional source file
- `conversations` + `messages` — chat history
- `quizzes` — generated quizzes (questions stored as JSON)
- `flashcard_decks` + `flashcards` — generated study decks

A private `study-files` storage bucket is provisioned for uploads.

## 📦 Build

```bash
npm run build      # production build
npm run preview    # preview the production build
```

## 📄 License

MIT

