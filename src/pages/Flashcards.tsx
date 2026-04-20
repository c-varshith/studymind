import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { generateFlashcards } from "@/lib/api";
import { trackActivity } from "@/lib/activity";
import { Sparkles, Loader2, ChevronLeft, ChevronRight, RotateCw, Trash2, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

interface Deck { id: string; title: string; created_at: string; }
interface Card { id: string; front: string; back: string; }
interface Note { id: string; title: string; content: string; }

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function Flashcards() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [activeDeck, setActiveDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [noteId, setNoteId] = useState("");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    void Promise.all([
      supabase.from("notes").select("id,title,content").order("updated_at", { ascending: false }).then(({ data }) => setNotes((data as Note[]) ?? [])),
      loadDecks(),
    ]);
  }, []);

  const loadDecks = async () => {
    const { data } = await supabase.from("flashcard_decks").select("*").order("created_at", { ascending: false });
    setDecks((data as Deck[]) ?? []);
  };

  const openDeck = async (d: Deck) => {
    const { data } = await supabase.from("flashcards").select("*").eq("deck_id", d.id).order("position");
    setCards((data as Card[]) ?? []);
    setActiveDeck(d);
    setIdx(0);
    setFlipped(false);
  };

  const create = async () => {
    if (!noteId || !user?.id) return;
    const note = notes.find((n) => n.id === noteId);
    if (!note?.content?.trim()) return toast({ title: "Note is empty", variant: "destructive" });
    setGenerating(true);
    try {
      const result = await generateFlashcards(note.content, 10);
      const { data: deck, error } = await supabase.from("flashcard_decks").insert({
        user_id: user.id, note_id: noteId, title: result.title || `${note.title} — Cards`,
      }).select().single();
      if (error) throw error;
      const rows = result.cards.map((c, i) => ({ deck_id: (deck as Deck).id, user_id: user.id, front: c.front, back: c.back, position: i }));
      const { error: cardsError } = await supabase.from("flashcards").insert(rows);
      if (cardsError) throw cardsError;
      await trackActivity(user.id);
      await loadDecks();
      await openDeck(deck as Deck);
      toast({ title: "Deck ready!", description: `${result.cards.length} cards generated.` });
    } catch (e: unknown) {
      toast({ title: "Generation failed", description: errorMessage(e, "Failed to generate flashcards."), variant: "destructive" });
    } finally { setGenerating(false); }
  };

  const remove = async (id: string) => {
    await supabase.from("flashcard_decks").delete().eq("id", id);
    if (activeDeck?.id === id) setActiveDeck(null);
    await loadDecks();
  };

  const next = () => { setFlipped(false); setIdx((i) => (i + 1) % cards.length); };
  const prev = () => { setFlipped(false); setIdx((i) => (i - 1 + cards.length) % cards.length); };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold">Flashcards</h1>
          <p className="text-muted-foreground text-sm">AI-built decks from your notes. Tap a card to flip.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Select value={noteId} onValueChange={setNoteId}>
            <SelectTrigger className="w-full sm:w-[220px]"><SelectValue placeholder="Pick a note" /></SelectTrigger>
            <SelectContent>{notes.map((n) => <SelectItem key={n.id} value={n.id}>{n.title}</SelectItem>)}</SelectContent>
          </Select>
          <Button onClick={create} disabled={!noteId || generating} className="bg-gradient-primary text-primary-foreground w-full sm:w-auto">
            {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Generate deck
          </Button>
        </div>
      </header>

      {activeDeck && cards.length > 0 ? (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-xl font-semibold">{activeDeck.title}</h2>
            <Button variant="ghost" size="sm" onClick={() => setActiveDeck(null)}>← Back to decks</Button>
          </div>
          <div className="perspective select-none mx-auto max-w-2xl">
            <button
              onClick={() => setFlipped((f) => !f)}
              className="relative w-full h-64 sm:h-72 md:h-80 preserve-3d transition-transform duration-500"
              style={{ transform: flipped ? "rotateY(180deg)" : "none" }}
              aria-label="Flip card"
            >
              <div className="absolute inset-0 backface-hidden rounded-2xl bg-card border border-border shadow-elegant flex items-center justify-center p-8 text-center">
                <p className="font-display text-xl md:text-2xl font-semibold">{cards[idx].front}</p>
              </div>
              <div className="absolute inset-0 backface-hidden rotate-y-180 rounded-2xl bg-gradient-primary text-primary-foreground shadow-elegant flex items-center justify-center p-8 text-center">
                <p className="text-lg md:text-xl">{cards[idx].back}</p>
              </div>
            </button>
          </div>
          <div className="mt-6 flex items-center justify-center gap-3 sm:gap-4">
            <Button variant="secondary" onClick={prev}><ChevronLeft className="h-4 w-4" /></Button>
            <div className="text-sm text-muted-foreground">{idx + 1} / {cards.length}</div>
            <Button variant="secondary" onClick={() => setFlipped((f) => !f)}><RotateCw className="h-4 w-4" /></Button>
            <Button variant="secondary" onClick={next}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      ) : decks.length === 0 ? (
        <Card className="p-10 text-center">
          <Layers className="h-10 w-10 text-primary mx-auto mb-3" />
          <p className="text-muted-foreground">No decks yet. Generate one from a note!</p>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {decks.map((d) => (
            <Card key={d.id} className="p-5 hover:shadow-elegant transition-shadow group">
              <div className="flex items-start justify-between gap-2">
                <div onClick={() => openDeck(d)} className="cursor-pointer flex-1 min-w-0">
                  <h3 className="font-display font-semibold truncate">{d.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">Tap to study</p>
                </div>
                <button onClick={() => remove(d.id)} className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-destructive/10">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
