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
type QuizDifficulty = "easy" | "medium" | "hard";
type QuizQuestionCount = 5 | 10 | 15;

interface Quiz {
  id: string;
  title: string;
  questions: Question[];
  created_at: string;
  note_id: string | null;
  difficulty: QuizDifficulty;
  question_count: QuizQuestionCount;
}

interface QuizResult {
  id: string;
  quiz_id: string;
  correct_answers: number;
  total_questions: number;
  score_percent: number;
  created_at: string;
}

interface Note { id: string; title: string; content: string; }

export default function Quiz() {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [latestResults, setLatestResults] = useState<Record<string, QuizResult>>({});
  const [historyByQuiz, setHistoryByQuiz] = useState<Record<string, QuizResult[]>>({});
  const [noteId, setNoteId] = useState<string>("");
  const [difficulty, setDifficulty] = useState<QuizDifficulty>("medium");
  const [questionCount, setQuestionCount] = useState<QuizQuestionCount>(5);
  const [generating, setGenerating] = useState(false);
  const [active, setActive] = useState<Quiz | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [savingResult, setSavingResult] = useState(false);

  useEffect(() => {
    void Promise.all([
      supabase.from("notes").select("id,title,content").order("updated_at", { ascending: false }).then(({ data }) => setNotes((data as Note[]) ?? [])),
      loadQuizzes(),
      loadQuizResults(),
    ]);
  }, []);

  const loadQuizzes = async () => {
    const { data } = await supabase.from("quizzes").select("*").order("created_at", { ascending: false });
    setQuizzes((data as unknown as Quiz[]) ?? []);
  };

  const loadQuizResults = async () => {
    const { data } = await supabase
      .from("quiz_results")
      .select("id,quiz_id,correct_answers,total_questions,score_percent,created_at")
      .order("created_at", { ascending: false });

    const grouped: Record<string, QuizResult[]> = {};
    const latest: Record<string, QuizResult> = {};
    ((data as QuizResult[]) ?? []).forEach((result) => {
      if (!grouped[result.quiz_id]) grouped[result.quiz_id] = [];
      grouped[result.quiz_id].push(result);
      if (!latest[result.quiz_id]) latest[result.quiz_id] = result;
    });
    setHistoryByQuiz(grouped);
    setLatestResults(latest);
  };

  const create = async () => {
    if (!noteId || !user?.id) return;
    const note = notes.find((n) => n.id === noteId);
    if (!note?.content?.trim()) return toast({ title: "Note is empty", description: "Add some content first.", variant: "destructive" });
    setGenerating(true);
    try {
      const result = await generateQuiz(note.content, questionCount, difficulty);
      const { data, error } = await supabase.from("quizzes").insert({
        user_id: user.id,
        note_id: noteId,
        title: `${note.title} — ${difficulty[0].toUpperCase() + difficulty.slice(1)} Quiz`,
        difficulty,
        question_count: questionCount,
        questions: result.questions,
      }).select().single();
      if (error) throw error;
      await trackActivity(user.id);
      await loadQuizzes();
      open(data as unknown as Quiz);
      toast({ title: "Quiz ready!", description: `${result.questions.length} ${difficulty} questions generated.` });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to generate quiz.";
      toast({ title: "Generation failed", description: message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const open = (q: Quiz) => { setActive(q); setAnswers({}); setSubmitted(false); };
  const remove = async (id: string) => { await supabase.from("quizzes").delete().eq("id", id); if (active?.id === id) setActive(null); await loadQuizzes(); };

  const calculateScore = (quiz: Quiz, pickedAnswers: Record<number, number>) => (
    quiz.questions.reduce((acc, q, i) => acc + (pickedAnswers[i] === q.correctIndex ? 1 : 0), 0)
  );

  const submitAnswers = async () => {
    if (!active || !user?.id) return;
    const total = active.questions.length;
    if (Object.keys(answers).length !== total) return;

    const correct = calculateScore(active, answers);
    const scorePercent = Number(((correct / total) * 100).toFixed(2));

    setSubmitted(true);
    setSavingResult(true);
    try {
      const { data, error } = await supabase
        .from("quiz_results")
        .insert({
          user_id: user.id,
          quiz_id: active.id,
          note_id: active.note_id,
          total_questions: total,
          correct_answers: correct,
          score_percent: scorePercent,
          answers,
        })
        .select("id,quiz_id,correct_answers,total_questions,score_percent,created_at")
        .single();
      if (error) throw error;

      const stored = data as QuizResult;
      setLatestResults((prev) => ({ ...prev, [stored.quiz_id]: stored }));
      setHistoryByQuiz((prev) => ({
        ...prev,
        [stored.quiz_id]: [stored, ...(prev[stored.quiz_id] ?? [])],
      }));
      toast({ title: "Quiz submitted", description: "Result saved successfully." });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to save quiz result.";
      toast({ title: "Result not saved", description: message, variant: "destructive" });
    } finally {
      setSavingResult(false);
    }
  };

  const score = active && submitted
    ? calculateScore(active, answers)
    : 0;

  const activeHistory = active ? (historyByQuiz[active.id] ?? []) : [];

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold">Quizzes</h1>
          <p className="text-muted-foreground text-sm">Generate a quiz from any note in seconds.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto">
          <Select value={noteId} onValueChange={setNoteId}>
            <SelectTrigger className="w-full sm:w-[220px]"><SelectValue placeholder="Pick a note" /></SelectTrigger>
            <SelectContent>{notes.map((n) => <SelectItem key={n.id} value={n.id}>{n.title}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={difficulty} onValueChange={(value) => setDifficulty(value as QuizDifficulty)}>
            <SelectTrigger className="w-full sm:w-[150px]"><SelectValue placeholder="Difficulty" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="easy">Easy</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="hard">Hard</SelectItem>
            </SelectContent>
          </Select>
          <Select value={String(questionCount)} onValueChange={(value) => setQuestionCount(Number(value) as QuizQuestionCount)}>
            <SelectTrigger className="w-full sm:w-[150px]"><SelectValue placeholder="Questions" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="5">5 questions</SelectItem>
              <SelectItem value="10">10 questions</SelectItem>
              <SelectItem value="15">15 questions</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={create} disabled={!noteId || generating} className="bg-gradient-primary text-primary-foreground w-full sm:w-auto">
            {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Generate quiz
          </Button>
        </div>
      </header>

      {active ? (
        <Card className="p-4 sm:p-6 shadow-elegant">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display text-lg sm:text-xl font-semibold">{active.title}</h2>
              <p className="text-xs text-muted-foreground mt-1 capitalize">
                {active.difficulty ?? "medium"} difficulty • {active.question_count ?? active.questions.length} questions
              </p>
            </div>
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
          <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            {!submitted ? (
              <Button onClick={submitAnswers} disabled={Object.keys(answers).length !== active.questions.length || savingResult} className="bg-gradient-primary text-primary-foreground">
                {savingResult ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Submit answers
              </Button>
            ) : (
              <>
                <div className="text-lg font-semibold">Score: <span className="text-gradient">{score} / {active.questions.length}</span></div>
                <Button variant="secondary" onClick={() => { setAnswers({}); setSubmitted(false); }}><RotateCcw className="h-4 w-4 mr-2" /> Retry</Button>
              </>
            )}
          </div>

          <div className="mt-8 border-t border-border pt-6">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="font-display text-lg font-semibold">Quiz History</h3>
              {activeHistory.length > 0 && (
                <p className="text-xs text-muted-foreground">{activeHistory.length} attempt{activeHistory.length > 1 ? "s" : ""}</p>
              )}
            </div>

            {activeHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground">No attempts yet. Submit this quiz to start your history.</p>
            ) : (
              <div className="space-y-2">
                {activeHistory.map((attempt, idx) => {
                  const previousAttempt = activeHistory[idx + 1];
                  const trendDelta = previousAttempt ? attempt.score_percent - previousAttempt.score_percent : 0;
                  const trendLabel = !previousAttempt
                    ? "First attempt"
                    : trendDelta > 0
                      ? `Improved +${trendDelta.toFixed(0)}%`
                      : trendDelta < 0
                        ? `Dropped ${trendDelta.toFixed(0)}%`
                        : "No change";

                  return (
                    <div key={attempt.id} className="rounded-lg border border-border p-3 bg-background/40">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-sm font-medium">
                          Attempt {activeHistory.length - idx}: {attempt.correct_answers}/{attempt.total_questions} ({attempt.score_percent.toFixed(0)}%)
                        </p>
                        <p className="text-xs text-muted-foreground">{new Date(attempt.created_at).toLocaleString()}</p>
                      </div>
                      <p className={cn(
                        "text-xs mt-1",
                        !previousAttempt && "text-muted-foreground",
                        previousAttempt && trendDelta > 0 && "text-accent",
                        previousAttempt && trendDelta < 0 && "text-destructive",
                        previousAttempt && trendDelta === 0 && "text-muted-foreground",
                      )}>
                        Trend: {trendLabel}
                      </p>
                    </div>
                  );
                })}
              </div>
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
                  <p className="text-sm text-muted-foreground mt-1 capitalize">
                    {(q.difficulty ?? "medium")} • {(q.question_count ?? q.questions.length)} questions
                  </p>
                  {latestResults[q.id] && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Last score: {latestResults[q.id].correct_answers}/{latestResults[q.id].total_questions} ({latestResults[q.id].score_percent.toFixed(0)}%)
                    </p>
                  )}
                </div>
                <button onClick={() => remove(q.id)} className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity p-1.5 rounded hover:bg-destructive/10">
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
