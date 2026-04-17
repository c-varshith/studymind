import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { streamChat, ttsToBlob } from "@/lib/api";
import { Send, Sparkles, Volume2, Square, Loader2, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string };
interface Note { id: string; title: string; content: string; }

const TTS_PREVIEW_LIMIT = 12000;
const TTS_SPEED_OPTIONS = [0.8, 1, 1.15, 1.3, 1.5];

function speakBrowserFallback(text: string, onDone: () => void, onError: (message: string) => void) {
  if (typeof window === "undefined" || !window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
    onError("Browser speech synthesis is unavailable.");
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  utterance.pitch = 1;
  utterance.volume = 1;
  utterance.lang = "en-US";
  utterance.onend = onDone;
  utterance.onerror = () => onError("Browser speech playback failed.");
  window.speechSynthesis.speak(utterance);
}

function buildPreviewText(text: string) {
  const trimmed = text.trim();
  if (trimmed.length <= TTS_PREVIEW_LIMIT) return trimmed;
  return `${trimmed.slice(0, TTS_PREVIEW_LIMIT).replace(/\s+\S*$/, "").trim()}…`;
}

export default function Chat() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteId, setNoteId] = useState<string>("none");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioStatus, setAudioStatus] = useState<string>("");
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const stoppingAudioRef = useRef(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.from("notes").select("id,title,content").order("updated_at", { ascending: false }).then(({ data }) => setNotes((data as Note[]) ?? []));
  }, []);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => () => {
    ttsAbortRef.current?.abort();
    window.speechSynthesis?.cancel();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  const send = async () => {
    if (!input.trim() || loading || !user) return;
    const userMsg: Msg = { role: "user", content: input.trim() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);

    let buffer = "";
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
    const noteContext = noteId !== "none" ? notes.find((n) => n.id === noteId)?.content : undefined;

    await streamChat({
      messages: next,
      noteContext,
      noteId: noteId !== "none" ? noteId : undefined,
      userId: user.id,
      onDelta: (chunk) => {
        buffer += chunk;
        setMessages((prev) => prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: buffer } : m)));
      },
      onDone: () => setLoading(false),
      onError: (err) => {
        setLoading(false);
        toast({ title: "Chat error", description: err, variant: "destructive" });
        setMessages((prev) => prev.slice(0, -1));
      },
    });
  };

  const speak = async (text: string, idx: number) => {
    try {
      // Abort any pending TTS generation
      ttsAbortRef.current?.abort();
      
      // Revoke old URL if exists
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
        audioUrlRef.current = null;
      }
      
      // Clear all audio state before generating new audio
      setAudioUrl(null);
      setSpeakingIdx(null);
      setAudioStatus("");
      
      // Wait for state update and old element to fully unmount
      await new Promise(resolve => setTimeout(resolve, 150));
      
      setAudioStatus("Generating audio...");
      setSpeakingIdx(idx);
      
      const controller = new AbortController();
      ttsAbortRef.current = controller;
      const input = buildPreviewText(text);
      const blob = await ttsToBlob(input, "default", controller.signal, playbackSpeed);
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      
      // Only set if abort wasn't called
      if (!controller.signal.aborted) {
        setAudioUrl(url);
        setAudioStatus("Playing audio...");
      } else {
        URL.revokeObjectURL(url);
        audioUrlRef.current = null;
      }
      
      ttsAbortRef.current = null;
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      const message = error instanceof Error ? error.message : "TTS generation failed.";
      setSpeakingIdx(null);
      setAudioStatus("");
      toast({ title: "TTS error", description: message, variant: "destructive" });
    }
  };

  const stopAudioPlayback = (statusMessage = "Playback stopped.") => {
    if (stoppingAudioRef.current) return;
    stoppingAudioRef.current = true;

    ttsAbortRef.current?.abort();
    ttsAbortRef.current = null;
    window.speechSynthesis?.cancel();

    const audioElement = audioRef.current;
    if (audioElement) {
      audioElement.pause();
      audioElement.removeAttribute("src");
      audioElement.load();
      audioElement.currentTime = 0;
    }

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }

    setAudioUrl(null);
    setAudioStatus(statusMessage);
    setSpeakingIdx(null);

    window.setTimeout(() => {
      stoppingAudioRef.current = false;
    }, 0);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-border p-4 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-gradient-primary flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-display font-semibold">AI Tutor</h1>
            <p className="text-xs text-muted-foreground">Ask anything. Optionally ground answers in a note.</p>
          </div>
        </div>
        <div className="ml-auto">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Speed</span>
              <select
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                {TTS_SPEED_OPTIONS.map((speed) => (
                  <option key={speed} value={speed}>
                    {speed.toFixed(2)}x
                  </option>
                ))}
              </select>
            </div>
            <Select value={noteId} onValueChange={setNoteId}>
              <SelectTrigger className="w-[220px]"><SelectValue placeholder="No note context" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No note context</SelectItem>
                {notes.map((n) => <SelectItem key={n.id} value={n.id}>{n.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div ref={scrollerRef} className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        {messages.length === 0 && (
          <div className="max-w-md mx-auto text-center mt-16">
            <div className="h-14 w-14 mx-auto rounded-2xl bg-secondary flex items-center justify-center mb-4">
              <MessageSquare className="h-7 w-7 text-primary" />
            </div>
            <h2 className="font-display text-xl font-semibold">Start a conversation</h2>
            <p className="text-muted-foreground mt-2 text-sm">Try: "Summarize my biology note in 5 bullets" or "Quiz me on chapter 3"</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn("flex gap-3 animate-fade-in", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn(
              "max-w-[85%] rounded-2xl px-4 py-3 shadow-soft",
              m.role === "user" ? "bg-gradient-primary text-primary-foreground" : "bg-card border border-border",
            )}>
              {m.role === "assistant" ? (
                <div className="prose-chat text-sm">
                  <ReactMarkdown>{m.content || "…"}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm whitespace-pre-wrap">{m.content}</p>
              )}
              {m.role === "assistant" && m.content && (
                <div className="mt-2 space-y-2">
                  <button
                    onClick={() => (speakingIdx === i ? stopAudioPlayback() : speak(m.content, i))}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    {speakingIdx === i ? <><Square className="h-3 w-3" /> Stop</> : <><Volume2 className="h-3 w-3" /> Listen</>}
                  </button>
                  {audioUrl && speakingIdx === i && (
                    <div className="rounded-lg border border-border bg-background/60 p-3 space-y-2">
                      <div className="text-xs text-muted-foreground">
                        {audioStatus || "Audio is ready."}
                      </div>
                      <audio
                        key={audioUrl}
                        ref={audioRef}
                        controls
                        src={audioUrl}
                        autoPlay
                        className="w-full"
                        onLoadedMetadata={(e) => {
                          e.currentTarget.playbackRate = playbackSpeed;
                        }}
                        onPlay={(e) => {
                          e.currentTarget.playbackRate = playbackSpeed;
                          setSpeakingIdx(i);
                          setAudioStatus("Playing audio...");
                        }}
                        onPause={() => {
                          if (stoppingAudioRef.current) return;
                          stopAudioPlayback("Playback paused.");
                        }}
                        onEnded={() => {
                          stopAudioPlayback("Playback finished.");
                        }}
                        onError={() => {
                          stopAudioPlayback("The browser could not play this audio file.");
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && messages[messages.length - 1]?.content === "" && (
          <div className="flex gap-2 text-muted-foreground text-sm pl-1"><Loader2 className="h-4 w-4 animate-spin" /> Thinking…</div>
        )}
      </div>

      <div className="border-t border-border p-4">
        <div className="flex gap-2 max-w-3xl mx-auto">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask your tutor anything…"
            className="resize-none min-h-[52px] max-h-40"
            rows={1}
          />
          <Button onClick={send} disabled={loading || !input.trim()} className="bg-gradient-primary text-primary-foreground self-end h-[52px]">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
