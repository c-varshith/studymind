import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { summarizeNote, ttsToBlob } from "@/lib/api";
import { uploadPdf, queryRag } from "@/lib/rag";
import { trackActivity } from "@/lib/activity";
import {
  Plus, Trash2, Volume2, Loader2,
  FileText, Upload, Send, BookOpen, X, ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Note { id: string; title: string; content: string; updated_at: string; }

type NoteSortMode = "recent" | "alpha-asc" | "alpha-desc";

type DocumentChunksLookup = {
  from(relation: "document_chunks"): {
    select(columns: string, options: { count: "exact"; head: true }): {
      eq(column: "note_id", value: string): Promise<{ count: number | null }>;
    };
  };
};

const TTS_PREVIEW_LIMIT = 12000;
const TTS_SPEED_OPTIONS = [0.8, 1, 1.15, 1.3, 1.5];

function buildPreviewText(text: string) {
  const trimmed = text.trim();
  if (trimmed.length <= TTS_PREVIEW_LIMIT) return trimmed;
  return `${trimmed.slice(0, TTS_PREVIEW_LIMIT).replace(/\s+\S*$/, "").trim()}…`;
}

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

function sortNotes(notes: Note[], mode: NoteSortMode) {
  const copy = [...notes];

  if (mode === "recent") {
    return copy.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }

  return copy.sort((a, b) => {
    const aTitle = (a.title || "Untitled note").trim().toLowerCase();
    const bTitle = (b.title || "Untitled note").trim().toLowerCase();
    const result = aTitle.localeCompare(bTitle);
    return mode === "alpha-asc" ? result : -result;
  });
}

export default function Notes() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<NoteSortMode>("recent");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioStatus, setAudioStatus] = useState<string>("");
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // PDF / RAG state
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [ragOpen, setRagOpen] = useState(false);
  const [ragQuestion, setRagQuestion] = useState("");
  const [ragAnswer, setRagAnswer] = useState("");
  const [ragSources, setRagSources] = useState<string[]>([]);
  const [ragLoading, setRagLoading] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryText, setSummaryText] = useState("");
  const [summaryTitle, setSummaryTitle] = useState("Summary");
  const [summaryMode, setSummaryMode] = useState<"standard" | "eli5">("standard");
  const [summaryAnalogy, setSummaryAnalogy] = useState("");
  const [summaryBullets, setSummaryBullets] = useState<string[]>([]);
  const [summaryKeyTerms, setSummaryKeyTerms] = useState<string[]>([]);
  const [summaryVisualFlow, setSummaryVisualFlow] = useState<Array<{ label: string; note: string }>>([]);
  const [eli5Mode, setEli5Mode] = useState(false);
  const [hasChunks, setHasChunks] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const debounce = useRef<number>();

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("notes")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) {
      toast({ title: "Failed to load notes", description: error.message, variant: "destructive" });
      return;
    }
    const loadedNotes = (data as Note[]) ?? [];
    setNotes(loadedNotes);
    if (loadedNotes.length && !activeId) selectNote(sortNotes(loadedNotes, sortMode)[0]);
  }, [activeId, sortMode]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => {
    ttsAbortRef.current?.abort();
    audioRef.current?.pause();
    window.speechSynthesis?.cancel();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  const selectNote = async (n: Note) => {
    setActiveId(n.id);
    setTitle(n.title);
    setContent(n.content);
    setRagOpen(false);
    setRagAnswer("");
    setRagSources([]);
    setSummaryText("");
    setSummaryAnalogy("");
    setSummaryBullets([]);
    setSummaryKeyTerms([]);
    setSummaryVisualFlow([]);

    // Check if this note has chunks
    const documentChunksClient = supabase as unknown as DocumentChunksLookup;
    const { count } = await documentChunksClient
      .from("document_chunks")
      .select("id", { count: "exact", head: true })
      .eq("note_id", n.id);
    setHasChunks((count ?? 0) > 0);
  };

  const newNote = async () => {
    if (!user?.id) {
      toast({ title: "Error", description: "User not authenticated. Please log in.", variant: "destructive" });
      return;
    }
    const { data, error } = await supabase
      .from("notes")
      .insert({ user_id: user.id, title: "Untitled note", content: "" })
      .select()
      .single();
    if (error) return toast({ title: "Error", description: error.message, variant: "destructive" });
    await trackActivity(user.id);
    await load();
    selectNote(data as Note);
  };

  const remove = async (id: string) => {
    await supabase.from("notes").delete().eq("id", id);
    if (activeId === id) { setActiveId(null); setTitle(""); setContent(""); setHasChunks(false); }
    await load();
  };

  // autosave
  useEffect(() => {
    if (!activeId || !user?.id) return;
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(async () => {
      setSaving(true);
      await supabase
        .from("notes")
        .update({ title: title || "Untitled note", content })
        .eq("id", activeId);
      await trackActivity(user.id);
      setSaving(false);
      setNotes((prev) =>
        prev.map((n) => n.id === activeId ? { ...n, title: title || "Untitled note", content } : n)
      );
    }, 600);
    return () => window.clearTimeout(debounce.current);
  }, [title, content, activeId]);

  const speak = async () => {
    if (!content.trim()) return;
    try {
      ttsAbortRef.current?.abort();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        setAudioUrl(null);
        audioUrlRef.current = null;
      }
      setAudioStatus("Generating audio...");

      setSpeaking(true);
      const controller = new AbortController();
      ttsAbortRef.current = controller;
      const input = buildPreviewText(content);
      if (content.trim().length > TTS_PREVIEW_LIMIT) {
        toast({ title: "Reading preview", description: "For long notes, playback uses a shorter preview so audio starts faster." });
      }
      const blob = await ttsToBlob(input, "sarah", controller.signal, 1);
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      setAudioUrl(url);
      setAudioStatus("Playing audio...");
      const audio = new Audio(url);
      audio.preload = "auto";
      audio.volume = 1;
      audio.playbackRate = playbackSpeed;
      audioRef.current = audio;
      ttsAbortRef.current = null;
      const fallbackTimer = window.setTimeout(() => {
        setAudioStatus("Audio is ready. Use the player controls below if it does not auto-start.");
      }, 1800);

      audio.onplaying = () => {
        window.clearTimeout(fallbackTimer);
        setAudioStatus("Playing audio...");
      };
      audio.onended = () => {
        window.clearTimeout(fallbackTimer);
        setSpeaking(false);
        setAudioStatus("Playback finished.");
      };
      audio.onerror = () => {
        window.clearTimeout(fallbackTimer);
        setSpeaking(false);
        setAudioStatus("Audio could not start automatically. Use the player controls below.");
        toast({ title: "TTS warning", description: "Audio was generated, but the browser player did not start automatically. Use the controls below.", variant: "default" });
      };
      audio.load();
      void audio.play().catch(() => {
        setAudioStatus("Audio is ready. Use the player controls below to start playback.");
      });
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      const message = error instanceof Error ? error.message : "Audio playback failed.";
      setSpeaking(false);
      toast({ title: "TTS error", description: message, variant: "destructive" });
    }
  };

  const stopSpeak = () => {
    ttsAbortRef.current?.abort();
    ttsAbortRef.current = null;
    window.speechSynthesis?.cancel();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      setAudioUrl(null);
      audioUrlRef.current = null;
    }
    setAudioStatus("Playback stopped.");
    setSpeaking(false);
  };

  // ── PDF Upload ────────────────────────────────────────────────────────────

  const handlePdfSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeId || !user) return;
    e.target.value = ""; // reset so same file can be re-selected

    setUploading(true);
    setUploadMsg("Extracting text from PDF…");
    try {
      const { text, chunks } = await uploadPdf(
        file,
        user.id,
        activeId,
        setUploadMsg,
      );

      // Fill note title + content from PDF
      const pdfTitle = file.name.replace(/\.pdf$/i, "");
      setTitle(pdfTitle);
      setContent(text);
      setHasChunks(true);
      setSummaryText("");
      setSummaryAnalogy("");
      setSummaryBullets([]);
      setSummaryKeyTerms([]);
      setSummaryVisualFlow([]);

      toast({
        title: "PDF processed",
        description: `${chunks} chunks embedded and ready for questions.`,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Upload failed.";
      toast({ title: "Upload failed", description: message, variant: "destructive" });
    } finally {
      setUploading(false);
      setUploadMsg("");
    }
  };

  const summarizeCurrentNote = async () => {
    if (!content.trim()) return;
    setSummarizing(true);
    try {
      const result = await summarizeNote(content, 8, eli5Mode ? "eli5" : "standard");
      setSummaryMode(result.mode);
      setSummaryTitle(result.title || (eli5Mode ? "ELI5 Summary" : "Summary"));
      setSummaryAnalogy(result.analogy || "");
      setSummaryBullets(result.bullets || []);
      setSummaryKeyTerms(result.key_terms || []);
      const fallbackFlow = (result.bullets || []).slice(0, 4).map((point, idx) => ({
        label: `Step ${idx + 1}`,
        note: point,
      }));
      setSummaryVisualFlow((result.visual_flow && result.visual_flow.length > 0) ? result.visual_flow : fallbackFlow);
      const summary = result.summary;
      setSummaryText(summary);
      toast({ title: "Summary ready", description: eli5Mode ? "ELI5 summary with visual flow is ready." : "Your PDF summary is generated." });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Summary failed.";
      toast({ title: "Summary failed", description: message, variant: "destructive" });
    } finally {
      setSummarizing(false);
    }
  };

  const insertSummaryIntoNote = () => {
    if (!summaryText.trim()) return;
    const summaryBlock = `Summary\n${summaryText}\n\n`;
    setContent((prev) => `${summaryBlock}${prev}`);
    toast({ title: "Summary inserted", description: "Added summary to the top of your note." });
  };

  // ── RAG Query ─────────────────────────────────────────────────────────────

  const askRag = async () => {
    if (!ragQuestion.trim() || !activeId || !user) return;
    setRagLoading(true);
    setRagAnswer("");
    setRagSources([]);
    try {
      const { answer, sources } = await queryRag(ragQuestion, activeId, user.id);
      setRagAnswer(answer);
      setRagSources(sources);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Query failed.";
      toast({
        title: "Query failed",
        description: message + " — make sure the RAG backend is running on port 8000.",
        variant: "destructive",
      });
    } finally {
      setRagLoading(false);
    }
  };

  const visibleNotes = useMemo(() => sortNotes(notes, sortMode), [notes, sortMode]);
  const showRagPanel = ragOpen && hasChunks;

  return (
    <div className="h-full flex">
      {/* ── Sidebar ── */}
      <div className="w-72 border-r border-border bg-card/50 flex flex-col">
        <div className="p-4 border-b border-border space-y-3">
          <Button
            onClick={newNote}
            className="w-full bg-gradient-primary text-primary-foreground hover:opacity-90 shadow-soft"
          >
            <Plus className="h-4 w-4 mr-2" /> New note
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Sort</span>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as NoteSortMode)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="recent">Most recent</option>
              <option value="alpha-asc">A-Z</option>
              <option value="alpha-desc">Z-A</option>
            </select>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-2 space-y-1">
          {notes.length === 0 && (
            <p className="text-center text-sm text-muted-foreground p-6">
              No notes yet. Create your first one!
            </p>
          )}
              {audioUrl && (
                <div className="mt-3 rounded-lg border border-border bg-background/60 p-3 space-y-2">
                  <div className="text-xs text-muted-foreground">
                    {audioStatus || "Audio is ready."}
                  </div>
                  <audio
                    key={audioUrl}
                    controls
                    src={audioUrl}
                    autoPlay
                    className="w-full"
                    onLoadedMetadata={(e) => {
                      e.currentTarget.playbackRate = playbackSpeed;
                    }}
                    onPlay={(e) => {
                      e.currentTarget.playbackRate = playbackSpeed;
                      setSpeaking(true);
                    }}
                    onPause={() => setSpeaking(false)}
                    onEnded={() => {
                      setSpeaking(false);
                      setAudioStatus("Playback finished.");
                    }}
                    onError={() => {
                      setSpeaking(false);
                      setAudioStatus("The browser could not play this audio file.");
                    }}
                  />
                </div>
              )}
          {visibleNotes.map((n) => (
            <button
              key={n.id}
              onClick={() => selectNote(n)}
              className={cn(
                "w-full text-left p-3 rounded-lg group transition-colors",
                activeId === n.id ? "bg-secondary" : "hover:bg-secondary/60",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{n.title || "Untitled"}</div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {n.content.slice(0, 60) || "Empty"}
                  </div>
                </div>
                <span
                  role="button"
                  aria-label="Delete note"
                  onClick={(e) => { e.stopPropagation(); remove(n.id); }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Editor ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeId ? (
          <>
            {/* Title bar */}
            <div className="border-b border-border p-4 flex items-center gap-2">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Note title"
                className="border-0 text-lg font-display font-semibold focus-visible:ring-0 px-0"
              />
              <div className="text-xs text-muted-foreground whitespace-nowrap">
                {saving ? "Saving…" : "Saved"}
              </div>
            </div>

            {/* Toolbar */}
            <div className="p-4 border-b border-border flex flex-wrap gap-2">
              {/* TTS */}
              {!speaking ? (
                <Button size="sm" variant="secondary" onClick={speak} disabled={!content.trim()}>
                  <Volume2 className="h-4 w-4 mr-2" /> Listen
                </Button>
              ) : (
                <Button size="sm" variant="destructive" onClick={stopSpeak}>
                  <X className="h-4 w-4 mr-2" /> Stop
                </Button>
              )}
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

              {/* PDF upload */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={handlePdfSelect}
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : <Upload className="h-4 w-4 mr-2" />}
                {uploading ? uploadMsg || "Processing…" : "Upload PDF"}
              </Button>

              <Button
                size="sm"
                variant="secondary"
                onClick={summarizeCurrentNote}
                disabled={summarizing || !content.trim()}
              >
                {summarizing
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : <FileText className="h-4 w-4 mr-2" />}
                {summarizing ? "Summarizing…" : "Summarize PDF"}
              </Button>

              <Button
                size="sm"
                variant={eli5Mode ? "default" : "secondary"}
                onClick={() => setEli5Mode((v) => !v)}
                className={eli5Mode ? "bg-gradient-primary text-primary-foreground" : ""}
              >
                <FileText className="h-4 w-4 mr-2" />
                Simplified Analysis {eli5Mode ? "ON" : "OFF"}
              </Button>

              {/* Ask about this doc — only shown once PDF is embedded */}
              {hasChunks && (
                <Button
                  size="sm"
                  variant={ragOpen ? "default" : "secondary"}
                  onClick={() => setRagOpen((o) => !o)}
                  className={ragOpen ? "bg-gradient-primary text-primary-foreground" : ""}
                >
                  <BookOpen className="h-4 w-4 mr-2" />
                  Ask this doc
                </Button>
              )}
            </div>

            {summaryText && showRagPanel && (
              <div className="border-b border-border p-4 bg-secondary/20 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-primary">{summaryTitle || "Summary"}</p>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={insertSummaryIntoNote}>Insert into note</Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setSummaryText("");
                        setSummaryAnalogy("");
                        setSummaryBullets([]);
                        setSummaryKeyTerms([]);
                        setSummaryVisualFlow([]);
                      }}
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
                <Card className="p-3 text-sm whitespace-pre-wrap leading-relaxed">
                  {summaryText}
                </Card>

                {summaryMode === "eli5" && summaryAnalogy && (
                  <Card className="p-3 text-sm">
                    <p className="font-medium text-primary mb-1">Simple analogy</p>
                    <p className="text-muted-foreground">{summaryAnalogy}</p>
                  </Card>
                )}

                {summaryMode === "eli5" && summaryBullets.length > 0 && (
                  <Card className="p-3 text-sm">
                    <p className="font-medium text-primary mb-2">Key ideas</p>
                    <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                      {summaryBullets.map((point, i) => (
                        <li key={`${point}-${i}`}>{point}</li>
                      ))}
                    </ul>
                  </Card>
                )}

                {summaryMode === "eli5" && summaryVisualFlow.length > 0 && (
                  <Card className="p-3 text-sm">
                    <p className="font-medium text-primary mb-3">Visual concept flow</p>
                    <div className="overflow-x-auto">
                      <div className="flex items-stretch gap-2 min-w-max">
                        {summaryVisualFlow.map((step, i) => (
                          <div key={`${step.label}-${i}`} className="flex items-center gap-2">
                            <div className="w-56 rounded-lg border border-border bg-background/70 p-3">
                              <p className="font-medium text-foreground">{step.label}</p>
                              {step.note && <p className="text-xs text-muted-foreground mt-1">{step.note}</p>}
                            </div>
                            {i < summaryVisualFlow.length - 1 && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
                          </div>
                        ))}
                      </div>
                    </div>
                  </Card>
                )}

                {summaryMode === "eli5" && summaryKeyTerms.length > 0 && (
                  <Card className="p-3 text-sm">
                    <p className="font-medium text-primary mb-2">Key terms</p>
                    <div className="flex flex-wrap gap-2">
                      {summaryKeyTerms.map((term, i) => (
                        <span key={`${term}-${i}`} className="px-2 py-1 rounded-md bg-secondary text-secondary-foreground text-xs">
                          {term}
                        </span>
                      ))}
                    </div>
                  </Card>
                )}
              </div>
            )}

            {summaryText && !showRagPanel ? (
              <div className="flex-1 min-h-0">
                <ResizablePanelGroup direction="vertical" className="h-full">
                  <ResizablePanel defaultSize={42} minSize={24} maxSize={70} className="min-h-0">
                    <div className="h-full border-b border-border p-4 bg-secondary/20 space-y-3 overflow-auto">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-primary">{summaryTitle || "Summary"}</p>
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="secondary" onClick={insertSummaryIntoNote}>Insert into note</Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSummaryText("");
                              setSummaryAnalogy("");
                              setSummaryBullets([]);
                              setSummaryKeyTerms([]);
                              setSummaryVisualFlow([]);
                            }}
                          >
                            Dismiss
                          </Button>
                        </div>
                      </div>
                      <Card className="p-3 text-sm whitespace-pre-wrap leading-relaxed">
                        {summaryText}
                      </Card>

                      {summaryMode === "eli5" && summaryAnalogy && (
                        <Card className="p-3 text-sm">
                          <p className="font-medium text-primary mb-1">Simple analogy</p>
                          <p className="text-muted-foreground">{summaryAnalogy}</p>
                        </Card>
                      )}

                      {summaryMode === "eli5" && summaryBullets.length > 0 && (
                        <Card className="p-3 text-sm">
                          <p className="font-medium text-primary mb-2">Key ideas</p>
                          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                            {summaryBullets.map((point, i) => (
                              <li key={`${point}-${i}`}>{point}</li>
                            ))}
                          </ul>
                        </Card>
                      )}

                      {summaryMode === "eli5" && summaryVisualFlow.length > 0 && (
                        <Card className="p-3 text-sm">
                          <p className="font-medium text-primary mb-3">Visual concept flow</p>
                          <div className="overflow-x-auto">
                            <div className="flex items-stretch gap-2 min-w-max">
                              {summaryVisualFlow.map((step, i) => (
                                <div key={`${step.label}-${i}`} className="flex items-center gap-2">
                                  <div className="w-56 rounded-lg border border-border bg-background/70 p-3">
                                    <p className="font-medium text-foreground">{step.label}</p>
                                    {step.note && <p className="text-xs text-muted-foreground mt-1">{step.note}</p>}
                                  </div>
                                  {i < summaryVisualFlow.length - 1 && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
                                </div>
                              ))}
                            </div>
                          </div>
                        </Card>
                      )}

                      {summaryMode === "eli5" && summaryKeyTerms.length > 0 && (
                        <Card className="p-3 text-sm">
                          <p className="font-medium text-primary mb-2">Key terms</p>
                          <div className="flex flex-wrap gap-2">
                            {summaryKeyTerms.map((term, i) => (
                              <span key={`${term}-${i}`} className="px-2 py-1 rounded-md bg-secondary text-secondary-foreground text-xs">
                                {term}
                              </span>
                            ))}
                          </div>
                        </Card>
                      )}
                    </div>
                  </ResizablePanel>

                  <ResizableHandle
                    withHandle
                    className="data-[panel-group-direction=vertical]:h-2 data-[panel-group-direction=vertical]:cursor-row-resize bg-border/70 hover:bg-primary/40 transition-colors"
                  />

                  <ResizablePanel minSize={30} className="min-h-0">
                    <Textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder="Start typing, paste study material, upload a PDF, or use the mic…"
                      className="h-full resize-none border-0 focus-visible:ring-0 rounded-none p-6 text-base leading-relaxed font-sans"
                    />
                  </ResizablePanel>
                </ResizablePanelGroup>
              </div>
            ) : showRagPanel ? (
              <div className="flex-1 min-h-0">
                <ResizablePanelGroup direction="vertical" className="h-full">
                  <ResizablePanel defaultSize={42} minSize={25} maxSize={70} className="min-h-0">
                    <div className="h-full border-b border-border p-4 bg-secondary/30 space-y-3 overflow-auto">
                      <div className="flex items-center gap-2">
                        <Input
                          value={ragQuestion}
                          onChange={(e) => setRagQuestion(e.target.value)}
                          placeholder="Ask anything about this document…"
                          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && askRag()}
                          className="flex-1"
                        />
                        <Button size="sm" onClick={askRag} disabled={ragLoading || !ragQuestion.trim()}>
                          {ragLoading
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Send className="h-4 w-4" />}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => { setRagOpen(false); setRagAnswer(""); setRagSources([]); }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>

                      {ragAnswer && (
                        <Card className="p-3 text-sm space-y-2">
                          <p className="font-medium text-primary">Answer</p>
                          <p className="leading-relaxed whitespace-pre-wrap">{ragAnswer}</p>
                          {ragSources.length > 0 && (
                            <details className="text-xs text-muted-foreground">
                              <summary className="cursor-pointer hover:text-foreground transition-colors">
                                {ragSources.length} source chunk{ragSources.length > 1 ? "s" : ""}
                              </summary>
                              <div className="mt-2 space-y-2">
                                {ragSources.map((s, i) => (
                                  <p key={i} className="border-l-2 border-border pl-2 line-clamp-3">{s}</p>
                                ))}
                              </div>
                            </details>
                          )}
                        </Card>
                      )}
                    </div>
                  </ResizablePanel>

                  <ResizableHandle
                    withHandle
                    className="data-[panel-group-direction=vertical]:h-2 data-[panel-group-direction=vertical]:cursor-row-resize bg-border/70 hover:bg-primary/40 transition-colors"
                  />

                  <ResizablePanel minSize={30} className="min-h-0">
                    <Textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      placeholder="Start typing, paste study material, upload a PDF, or use the mic…"
                      className="h-full resize-none border-0 focus-visible:ring-0 rounded-none p-6 text-base leading-relaxed font-sans"
                    />
                  </ResizablePanel>
                </ResizablePanelGroup>
              </div>
            ) : (
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Start typing, paste study material, upload a PDF, or use the mic…"
                className="flex-1 resize-none border-0 focus-visible:ring-0 rounded-none p-6 text-base leading-relaxed font-sans"
              />
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center p-10">
            <div>
              <div className="h-16 w-16 mx-auto rounded-2xl bg-secondary flex items-center justify-center mb-4">
                <FileText className="h-8 w-8 text-primary" />
              </div>
              <h2 className="font-display text-xl font-semibold">No note selected</h2>
              <p className="text-muted-foreground mt-2">Create a note or upload a PDF to get started.</p>
              <Button onClick={newNote} className="mt-4 bg-gradient-primary text-primary-foreground">
                <Plus className="h-4 w-4 mr-2" /> New note
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}