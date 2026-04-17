import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Activity, BookOpen, FileText, Flame, Layers, Sparkles } from "lucide-react";

interface NoteLite {
  id: string;
  title: string;
  updated_at: string;
}

interface DashboardStats {
  streakDays: number;
  notesCount: number;
  quizzesCount: number;
  decksCount: number;
  flashcardsCount: number;
  uploadedDocTitles: string[];
  weeklyActiveDays: number;
  overallProgress: number;
}

const emptyStats: DashboardStats = {
  streakDays: 0,
  notesCount: 0,
  quizzesCount: 0,
  decksCount: 0,
  flashcardsCount: 0,
  uploadedDocTitles: [],
  weeklyActiveDays: 0,
  overallProgress: 0,
};

function getDashboardCacheKey(userId: string) {
  return `studymind.dashboard.stats:${userId}`;
}

function readCachedStats(userId: string) {
  if (typeof window === "undefined") return null;

  try {
    const cached = window.localStorage.getItem(getDashboardCacheKey(userId));
    if (!cached) return null;

    const parsed = JSON.parse(cached) as Partial<DashboardStats>;
    return {
      ...emptyStats,
      ...parsed,
      uploadedDocTitles: Array.isArray(parsed.uploadedDocTitles) ? parsed.uploadedDocTitles : [],
    } satisfies DashboardStats;
  } catch {
    return null;
  }
}

function writeCachedStats(userId: string, stats: DashboardStats) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(getDashboardCacheKey(userId), JSON.stringify(stats));
  } catch {
    // Ignore storage quota / privacy mode failures.
  }
}

function toDayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function computeStreak(activityDaySet: Set<string>) {
  if (activityDaySet.size === 0) return 0;

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const cursor = activityDaySet.has(toDayKey(today))
    ? new Date(today)
    : activityDaySet.has(toDayKey(yesterday))
      ? new Date(yesterday)
      : null;

  if (!cursor) return 0;

  let streak = 0;
  while (activityDaySet.has(toDayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats>(emptyStats);

  useEffect(() => {
    const load = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      setLoading(true);
      const cachedStats = readCachedStats(user.id);
      if (cachedStats) {
        setStats(cachedStats);
      }

      const [notesRes, quizzesRes, decksRes, cardsRes, chunksRes] = await Promise.all([
        supabase
          .from("notes")
          .select("id,title,updated_at")
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false }),
        supabase
          .from("quizzes")
          .select("id,updated_at")
          .eq("user_id", user.id),
        supabase
          .from("flashcard_decks")
          .select("id,updated_at")
          .eq("user_id", user.id),
        supabase
          .from("flashcards")
          .select("id")
          .eq("user_id", user.id),
        supabase
          .from("document_chunks" as never)
          .select("note_id")
          .eq("user_id", user.id),
      ]);

      const notes = (notesRes.data ?? []) as NoteLite[];
      const quizzes = quizzesRes.data ?? [];
      const decks = decksRes.data ?? [];
      const cards = cardsRes.data ?? [];
      const chunks = (chunksRes.data ?? []) as Array<{ note_id: string }>;

      const activityDays = new Set<string>();
      for (const n of notes) activityDays.add(String(n.updated_at).slice(0, 10));
      for (const q of quizzes) activityDays.add(String(q.updated_at).slice(0, 10));
      for (const d of decks) activityDays.add(String(d.updated_at).slice(0, 10));

      const uploadedIds = new Set(chunks.map((r) => r.note_id).filter(Boolean));
      const uploadedDocTitles = notes
        .filter((n) => uploadedIds.has(n.id))
        .map((n) => n.title || "Untitled")
        .slice(0, 8);

      const weeklyCutoff = new Date();
      weeklyCutoff.setDate(weeklyCutoff.getDate() - 6);
      const weeklyActiveDays = Array.from(activityDays).filter((day) => new Date(day) >= weeklyCutoff).length;

      const notesProgress = Math.min(notes.length / 10, 1);
      const quizzesProgress = Math.min(quizzes.length / 5, 1);
      const decksProgress = Math.min(decks.length / 3, 1);
      const overallProgress = Math.round(((notesProgress + quizzesProgress + decksProgress) / 3) * 100);

      const nextStats: DashboardStats = {
        streakDays: computeStreak(activityDays),
        notesCount: notes.length,
        quizzesCount: quizzes.length,
        decksCount: decks.length,
        flashcardsCount: cards.length,
        uploadedDocTitles,
        weeklyActiveDays,
        overallProgress,
      };

      setStats(nextStats);
      writeCachedStats(user.id, nextStats);
      setLoading(false);
    };

    void load();
  }, [user]);

  const notesProgressPct = useMemo(() => Math.min(Math.round((stats.notesCount / 10) * 100), 100), [stats.notesCount]);
  const quizzesProgressPct = useMemo(() => Math.min(Math.round((stats.quizzesCount / 5) * 100), 100), [stats.quizzesCount]);
  const decksProgressPct = useMemo(() => Math.min(Math.round((stats.decksCount / 3) * 100), 100), [stats.decksCount]);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Track your learning momentum and key study progress in one place.</p>
      </header>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card className="p-4 space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground text-sm"><Flame className="h-4 w-4" /> Streak</div>
          <p className="text-2xl font-bold">{loading ? "-" : `${stats.streakDays} day${stats.streakDays === 1 ? "" : "s"}`}</p>
        </Card>

        <Card className="p-4 space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground text-sm"><FileText className="h-4 w-4" /> Notes</div>
          <p className="text-2xl font-bold">{loading ? "-" : stats.notesCount}</p>
        </Card>

        <Card className="p-4 space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground text-sm"><Sparkles className="h-4 w-4" /> Quizzes</div>
          <p className="text-2xl font-bold">{loading ? "-" : stats.quizzesCount}</p>
        </Card>

        <Card className="p-4 space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground text-sm"><Layers className="h-4 w-4" /> Flashcards</div>
          <p className="text-2xl font-bold">{loading ? "-" : stats.flashcardsCount}</p>
        </Card>
      </div>

      <div className="grid xl:grid-cols-3 gap-4">
        <Card className="p-5 xl:col-span-2 space-y-4">
          <div className="flex items-center gap-2 text-base font-semibold">
            <Activity className="h-4 w-4 text-primary" /> Progress Overview
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span>Notes goal (10)</span>
                <span className="text-muted-foreground">{notesProgressPct}%</span>
              </div>
              <Progress value={notesProgressPct} />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span>Quiz goal (5)</span>
                <span className="text-muted-foreground">{quizzesProgressPct}%</span>
              </div>
              <Progress value={quizzesProgressPct} />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span>Deck goal (3)</span>
                <span className="text-muted-foreground">{decksProgressPct}%</span>
              </div>
              <Progress value={decksProgressPct} />
            </div>
          </div>

          <div className="pt-1 text-sm">
            <span className="text-muted-foreground">Overall progress: </span>
            <span className="font-semibold">{loading ? "-" : `${stats.overallProgress}%`}</span>
          </div>
        </Card>

        <Card className="p-5 space-y-3">
          <div className="flex items-center gap-2 text-base font-semibold">
            <BookOpen className="h-4 w-4 text-primary" /> Uploaded Documents
          </div>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading documents...</p>
          ) : stats.uploadedDocTitles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No uploaded documents yet.</p>
          ) : (
            <ul className="space-y-2">
              {stats.uploadedDocTitles.map((title, idx) => (
                <li key={`${title}-${idx}`} className="text-sm rounded-md border border-border px-3 py-2 bg-background/60 truncate">
                  {title}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Weekly activity</p>
          <p className="font-semibold">{loading ? "-" : `${stats.weeklyActiveDays} active day${stats.weeklyActiveDays === 1 ? "" : "s"} in the last 7 days`}</p>
        </div>
      </Card>
    </div>
  );
}
