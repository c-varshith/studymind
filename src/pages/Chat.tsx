import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { streamChat, ttsToBlob } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Loader2, MessageSquare, Plus, Send, Sparkles, Square, Trash2, Volume2 } from "lucide-react";

type MessageRole = "user" | "assistant";

type Msg = {
  role: MessageRole;
  content: string;
};

type Note = Pick<Database["public"]["Tables"]["notes"]["Row"], "id" | "title" | "content">;

type ConversationRow = Database["public"]["Tables"]["conversations"]["Row"];
type MessageRow = Database["public"]["Tables"]["messages"]["Row"];

type Conversation = Pick<ConversationRow, "id" | "title" | "created_at" | "updated_at" | "note_id">;

const TTS_PREVIEW_LIMIT = 12000;

function buildPreviewText(text: string) {
  const trimmed = text.trim();
  if (trimmed.length <= TTS_PREVIEW_LIMIT) return trimmed;
  return `${trimmed.slice(0, TTS_PREVIEW_LIMIT).replace(/\s+\S*$/, "").trim()}…`;
}

export default function Chat() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [notes, setNotes] = useState<Note[]>([]);
  const [noteId, setNoteId] = useState<string>("none");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioStatus, setAudioStatus] = useState("");
  const [panelSizes, setPanelSizes] = useState<number[] | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const stoppingAudioRef = useRef(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sizesLoadedRef = useRef(false);

  const activeNote = noteId !== "none" ? notes.find((note) => note.id === noteId) : undefined;

  const handlePanelLayout = (sizes: number[]) => {
    setPanelSizes(sizes);
    try {
      window.localStorage.setItem("studymind.chat-panel-sizes", JSON.stringify(sizes));
    } catch {
      // Ignore storage errors
    }
  };

  const loadNotes = useCallback(async () => {
    const { data, error } = await supabase
      .from("notes")
      .select("id,title,content")
      .order("updated_at", { ascending: false });

    if (error) {
      toast({ title: "Failed to load notes", description: error.message, variant: "destructive" });
      return;
    }

    setNotes((data as Note[]) ?? []);
  }, []);

  const loadConversations = useCallback(async () => {
    if (!user) return;

    const { data, error } = await supabase
      .from("conversations")
      .select("id,title,created_at,updated_at,note_id")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    if (error) {
      toast({ title: "Failed to load history", description: error.message, variant: "destructive" });
      return;
    }

    setConversations((data as Conversation[]) ?? []);
  }, [user]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    // Load saved panel sizes from localStorage once on mount
    if (sizesLoadedRef.current) return;
    
    try {
      const saved = window.localStorage.getItem("studymind.chat-panel-sizes");
      if (saved) {
        const sizes = JSON.parse(saved) as number[];
        if (Array.isArray(sizes) && sizes.length === 2) {
          setPanelSizes(sizes);
          sizesLoadedRef.current = true;
          return;
        }
      }
    } catch {
      // Ignore parse errors
    }
    
    // Use defaults if no saved state
    setPanelSizes([26, 74]);
    sizesLoadedRef.current = true;
  }, []);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    if (!user) {
      setConversations([]);
      setMessages([]);
      setCurrentConversationId(null);
      setNoteId("none");
      return;
    }

    void loadConversations();
  }, [user, loadConversations]);

  useEffect(() => {
    return () => {
      ttsAbortRef.current?.abort();
      window.speechSynthesis?.cancel();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  async function loadConversation(conversation: Conversation) {
    const { data, error } = await supabase
      .from("messages")
      .select("role,content,created_at")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true });

    if (error) {
      toast({ title: "Failed to load conversation", description: error.message, variant: "destructive" });
      return;
    }

    const loadedMessages = ((data as Pick<MessageRow, "role" | "content" | "created_at">[]) ?? [])
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        role: message.role as MessageRole,
        content: message.content,
      }));

    stopAudioPlayback("");
    setMessages(loadedMessages);
    setCurrentConversationId(conversation.id);
    setNoteId(conversation.note_id ?? "none");
  }

  function startNewConversation() {
    if (loading || saving) return;
    stopAudioPlayback("");
    setMessages([]);
    setInput("");
    setCurrentConversationId(null);
    setNoteId("none");
  }

  async function deleteConversation(conversationId: string) {
    if (loading) return;

    const { error } = await supabase.from("conversations").delete().eq("id", conversationId);

    if (error) {
      toast({ title: "Error deleting conversation", description: error.message, variant: "destructive" });
      return;
    }

    if (currentConversationId === conversationId) {
      startNewConversation();
    }

    setConversations((prev) => prev.filter((conversation) => conversation.id !== conversationId));
    toast({ title: "Conversation deleted" });
  }

  async function persistTurn(userMessage: Msg, assistantMessage: Msg) {
    if (!user) return;

    setSaving(true);

    try {
      let conversationId = currentConversationId;

      if (!conversationId) {
        const { data: conversation, error } = await supabase
          .from("conversations")
          .insert({
            user_id: user.id,
            title: userMessage.content.slice(0, 50) || "New conversation",
            note_id: noteId !== "none" ? noteId : null,
          })
          .select("id")
          .single();

        if (error) throw error;
        conversationId = conversation.id;
        setCurrentConversationId(conversationId);
      } else {
        const { error } = await supabase
          .from("conversations")
          .update({
            note_id: noteId !== "none" ? noteId : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", conversationId);

        if (error) throw error;
      }

      const { error: messageError } = await supabase.from("messages").insert([
        {
          conversation_id: conversationId,
          user_id: user.id,
          role: userMessage.role,
          content: userMessage.content,
        },
        {
          conversation_id: conversationId,
          user_id: user.id,
          role: assistantMessage.role,
          content: assistantMessage.content,
        },
      ]);

      if (messageError) throw messageError;

      await loadConversations();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to save this chat turn.";
      toast({ title: "History save failed", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function send() {
    if (!input.trim() || loading || !user) return;

    const userMsg: Msg = { role: "user", content: input.trim() };
    const outgoingMessages = [...messages, userMsg];

    setMessages((prev) => [...prev, userMsg, { role: "assistant", content: "" }]);
    setInput("");
    setLoading(true);

    let assistantContent = "";

    await streamChat({
      messages: outgoingMessages,
      noteContext: activeNote?.content,
      noteId: activeNote?.id,
      userId: user.id,
      onDelta: (chunk) => {
        assistantContent += chunk;
        setMessages((prev) =>
          prev.map((message, index) =>
            index === prev.length - 1 ? { ...message, content: assistantContent } : message
          )
        );
      },
      onDone: async () => {
        setLoading(false);
        const assistantMessage: Msg = {
          role: "assistant",
          content: assistantContent.trim(),
        };
        await persistTurn(userMsg, assistantMessage);
      },
      onError: (errorMessage) => {
        setLoading(false);
        setMessages((prev) => prev.slice(0, -2));
        toast({ title: "Chat error", description: errorMessage, variant: "destructive" });
      },
    });
  }

  async function speak(text: string, index: number) {
    try {
      ttsAbortRef.current?.abort();

      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }

      setAudioUrl(null);
      setSpeakingIdx(null);
      setAudioStatus("");

      await new Promise((resolve) => window.setTimeout(resolve, 150));

      setAudioStatus("Generating audio...");
      setSpeakingIdx(index);

      const controller = new AbortController();
      ttsAbortRef.current = controller;
      const blob = await ttsToBlob(buildPreviewText(text), "default", controller.signal, 1);
      const nextAudioUrl = URL.createObjectURL(blob);
      audioUrlRef.current = nextAudioUrl;

      if (controller.signal.aborted) {
        URL.revokeObjectURL(nextAudioUrl);
        audioUrlRef.current = null;
        return;
      }

      setAudioUrl(nextAudioUrl);
      setAudioStatus("Playing audio...");
      ttsAbortRef.current = null;
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      const message = error instanceof Error ? error.message : "TTS generation failed.";
      setSpeakingIdx(null);
      setAudioStatus("");
      toast({ title: "TTS error", description: message, variant: "destructive" });
    }
  }

  function stopAudioPlayback(statusMessage = "Playback stopped.") {
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
  }

  const sidebar = (
    <aside className="w-full h-full flex flex-col border-b md:border-b-0 md:border-r border-border bg-card/40">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-8 w-8 rounded-lg bg-gradient-primary flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-display font-semibold">AI Tutor</h1>
            <p className="text-xs text-muted-foreground">Saved tutoring history</p>
          </div>
        </div>
        <Button onClick={startNewConversation} disabled={loading || saving} className="w-full">
          <Plus className="h-4 w-4" />
          New conversation
        </Button>
      </div>

      <div className="max-h-64 md:max-h-none md:flex-1 md:min-h-0 overflow-auto p-2 space-y-2">
        {conversations.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            Your tutor history will appear here after the first saved reply.
          </div>
        ) : (
          conversations.map((conversation) => {
            const noteTitle = conversation.note_id
              ? notes.find((note) => note.id === conversation.note_id)?.title
              : null;

            return (
              <div
                key={conversation.id}
                role="button"
                tabIndex={0}
                onClick={() => void loadConversation(conversation)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void loadConversation(conversation);
                  }
                }}
                className={cn(
                  "w-full rounded-xl border p-3 text-left transition-colors",
                  currentConversationId === conversation.id
                    ? "border-primary bg-primary/5"
                    : "border-border bg-background hover:bg-accent"
                )}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{conversation.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {new Date(conversation.updated_at).toLocaleString()}
                    </div>
                    {noteTitle && (
                      <div className="mt-2 truncate text-xs text-primary">
                        Note: {noteTitle}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteConversation(conversation.id);
                    }}
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    aria-label="Delete conversation"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );

  const mainPane = (
    <div className="min-w-0 h-full flex-1 flex flex-col">
      <div className="border-b border-border p-3 sm:p-4 flex items-center gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium">Ask anything. Optionally ground answers in a note.</p>
          <p className="text-xs text-muted-foreground">
            Completed tutor replies are saved automatically.
          </p>
        </div>
        <div className="w-full sm:w-auto sm:ml-auto">
          <Select value={noteId} onValueChange={setNoteId}>
            <SelectTrigger className="w-full sm:w-[280px]">
              <SelectValue placeholder="No note context" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No note context</SelectItem>
              {notes.map((note) => (
                <SelectItem key={note.id} value={note.id}>
                  {note.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div ref={scrollerRef} className="flex-1 overflow-auto p-3 sm:p-4 md:p-6 space-y-4">
        {messages.length === 0 && (
          <div className="max-w-md mx-auto text-center mt-16">
            <div className="h-14 w-14 mx-auto rounded-2xl bg-secondary flex items-center justify-center mb-4">
              <MessageSquare className="h-7 w-7 text-primary" />
            </div>
            <h2 className="font-display text-xl font-semibold">Start a conversation</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              Try: "Summarize my biology note in 5 bullets" or "Quiz me on chapter 3"
            </p>
          </div>
        )}

        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}-${message.content.length}`}
            className={cn("flex gap-3 animate-fade-in", message.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[92%] sm:max-w-[85%] rounded-2xl px-4 py-3 shadow-soft",
                message.role === "user"
                  ? "bg-gradient-primary text-primary-foreground"
                  : "bg-card border border-border"
              )}
            >
              {message.role === "assistant" ? (
                <div className="prose-chat text-sm">
                  <ReactMarkdown>{message.content || "…"}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
              )}

              {message.role === "assistant" && message.content && (
                <div className="mt-2 space-y-2">
                  <button
                    type="button"
                    onClick={() => (speakingIdx === index ? stopAudioPlayback() : void speak(message.content, index))}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
                  >
                    {speakingIdx === index ? (
                      <>
                        <Square className="h-3 w-3" />
                        Stop
                      </>
                    ) : (
                      <>
                        <Volume2 className="h-3 w-3" />
                        Listen
                      </>
                    )}
                  </button>

                  {audioUrl && speakingIdx === index && (
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
                        onLoadedMetadata={(event) => {
                          event.currentTarget.playbackRate = 1;
                        }}
                        onPlay={(event) => {
                          event.currentTarget.playbackRate = 1;
                          setSpeakingIdx(index);
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
          <div className="flex gap-2 text-muted-foreground text-sm pl-1">
            <Loader2 className="h-4 w-4 animate-spin" />
            Thinking…
          </div>
        )}
      </div>

      <div className="border-t border-border p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row gap-2 max-w-3xl mx-auto">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder="Ask your tutor anything…"
            className="resize-none min-h-[52px] max-h-40"
            rows={1}
          />
          <Button
            onClick={() => void send()}
            disabled={loading || saving || !input.trim()}
            className="bg-gradient-primary text-primary-foreground h-[52px] sm:w-auto w-full"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    isMobile ? (
      <div className="h-full flex flex-col md:flex-row">
        {sidebar}
        {mainPane}
      </div>
    ) : panelSizes ? (
      <ResizablePanelGroup direction="horizontal" className="h-full w-full" onLayout={handlePanelLayout}>
        <ResizablePanel defaultSize={panelSizes[0]} key={`left-${panelSizes[0]}`} minSize={18} maxSize={38} className="min-w-0 h-full">
          {sidebar}
        </ResizablePanel>
        <ResizableHandle className="w-1 cursor-col-resize bg-transparent hover:bg-transparent" />
        <ResizablePanel defaultSize={panelSizes[1]} key={`right-${panelSizes[1]}`} minSize={45} className="min-w-0 h-full">
          {mainPane}
        </ResizablePanel>
      </ResizablePanelGroup>
    ) : null
  );
}
