import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { generateQuiz } from "@/lib/api";
import { trackActivity } from "@/lib/activity";
import { Sparkles, Loader2, Check, X, RotateCcw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Question = { question: string; options: string[]; correctIndex: number; explanation: string };
interface Quiz { id: string; title: string; questions: Question[]; created_at: string; }
interface Note { id: string; title: string; content: string; }

export default function Quiz() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [noteId, setNoteId] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  const [active, setActive] = useState<Quiz | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    void Promise.all([
      supabase.from("notes").select("id,title,content").order("updated_at", { ascending: false }).then(({ data }) => setNotes((data as Note[]) ?? [])),
      loadQuizzes(),
    ]);
  }, []);

  const loadQuizzes = async () => {
    const { data } = await supabase.from("quizzes").select("*").order("created_at", { ascending: false });
    setQuizzes((data as unknown as Quiz[]) ?? []);
  };

  const create = async () => {
    if (!noteId || !user?.id) return;
    const note = notes.find((n) => n.id === noteId);
    if (!note?.content?.trim()) return toast({ title: "Note is empty", description: "Add some content first.", variant: "destructive" });
    setGenerating(true);
    try {
      const result = await generateQuiz(note.content, 5);
      const { data, error } = await supabase.from("quizzes").insert({
        user_id: user.id, note_id: noteId, title: `${note.title} — Quiz`, questions: result.questions,
      }).select().single();
      if (error) throw error;
      await trackActivity(user.id);
      await loadQuizzes();
      open(data as unknown as Quiz);
      toast({ title: "Quiz ready!", description: `${result.questions.length} questions generated.` });
    } catch (e: any) {
      toast({ title: "Generation failed", description: e.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const open = (q: Quiz) => { setActive(q); setAnswers({}); setSubmitted(false); };
  const remove = async (id: string) => { await supabase.from("quizzes").delete().eq("id", id); if (active?.id === id) setActive(null); await loadQuizzes(); };

  const score = active && submitted
    ? active.questions.reduce((acc, q, i) => acc + (answers[i] === q.correctIndex ? 1 : 0), 0)
    : 0;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold">Quizzes</h1>
          <p className="text-muted-foreground text-sm">Generate a quiz from any note in seconds.</p>
        </div>
        <div className="flex gap-2">
          <Select value={noteId} onValueChange={setNoteId}>
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Pick a note" /></SelectTrigger>
            <SelectContent>{notes.map((n) => <SelectItem key={n.id} value={n.id}>{n.title}</SelectItem>)}</SelectContent>
          </Select>
          <Button onClick={create} disabled={!noteId || generating} className="bg-gradient-primary text-primary-foreground">
            {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Generate quiz
          </Button>
        </div>
      </header>

      {active ? (
        <Card className="p-6 shadow-elegant">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-xl font-semibold">{active.title}</h2>
            <Button variant="ghost" size="sm" onClick={() => setActive(null)}>← Back to list</Button>
          </div>
          <div className="space-y-6">
            {active.questions.map((q, i) => (
              <div key={i} className="space-y-2">
                <div className="font-medium">{i + 1}. {q.question}</div>
                <div className="grid gap-2">
                  {q.options.map((opt, oi) => {
                    const picked = answers[i] === oi;
                    const correct = submitted && oi === q.correctIndex;
                    const wrong = submitted && picked && oi !== q.correctIndex;
                    return (
                      <button
                        key={oi}
                        onClick={() => !submitted && setAnswers({ ...answers, [i]: oi })}
                        className={cn(
                          "text-left px-4 py-2.5 rounded-lg border transition-colors flex items-center gap-2",
                          picked && !submitted && "border-primary bg-secondary",
                          correct && "border-accent bg-accent/10 text-foreground",
                          wrong && "border-destructive bg-destructive/10",
                          !picked && !correct && !wrong && "border-border hover:bg-secondary",
                        )}
                      >
                        {submitted && correct && <Check className="h-4 w-4 text-accent" />}
                        {submitted && wrong && <X className="h-4 w-4 text-destructive" />}
                        <span>{opt}</span>
                      </button>
                    );
                  })}
                </div>
                {submitted && <p className="text-sm text-muted-foreground italic">💡 {q.explanation}</p>}
              </div>
            ))}
          </div>
          <div className="mt-6 flex items-center justify-between">
            {!submitted ? (
              <Button onClick={() => setSubmitted(true)} disabled={Object.keys(answers).length !== active.questions.length} className="bg-gradient-primary text-primary-foreground">
                Submit answers
              </Button>
            ) : (
              <>
                <div className="text-lg font-semibold">Score: <span className="text-gradient">{score} / {active.questions.length}</span></div>
                <Button variant="secondary" onClick={() => { setAnswers({}); setSubmitted(false); }}><RotateCcw className="h-4 w-4 mr-2" /> Retry</Button>
              </>
            )}
          </div>
        </Card>
      ) : quizzes.length === 0 ? (
        <Card className="p-10 text-center">
          <Sparkles className="h-10 w-10 text-primary mx-auto mb-3" />
          <p className="text-muted-foreground">No quizzes yet. Pick a note and generate your first one!</p>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {quizzes.map((q) => (
            <Card key={q.id} className="p-5 hover:shadow-elegant transition-shadow group">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 cursor-pointer" onClick={() => open(q)}>
                  <h3 className="font-display font-semibold truncate">{q.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">{q.questions.length} questions</p>
                </div>
                <button onClick={() => remove(q.id)} className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-destructive/10">
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
