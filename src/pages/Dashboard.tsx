import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { fetchNotesWithTagSupport } from "@/lib/notes";
import { readCachedLoginDay } from "@/lib/activity";
import { Activity, BookOpen, FileText, Flame, Layers, Sparkles, Clock, Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface NoteLite {
  id: string;
  title: string;
  updated_at: string;
  content?: string;
  tags?: string[];
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
  recentNotes: NoteLite[];
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
  recentNotes: [],
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

function computeStreak(activityDays: Date[]) {
  if (activityDays.length === 0) return 0;

  const activityDaySet = new Set(activityDays.map((d) => toDayKey(d)));
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

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

export default function Dashboard() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats>(emptyStats);
  const [searchQuery, setSearchQuery] = useState("");
  const [allNotes, setAllNotes] = useState<NoteLite[]>([]);

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

      const [notesResult, quizzesRes, decksRes, cardsRes, chunksRes, activityRes] = await Promise.all([
        fetchNotesWithTagSupport(),
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
        supabase
          .from("user_login_activity")
          .select("login_day")
          .eq("user_id", user.id)
          .order("login_day", { ascending: false }),
      ]);

      const notes = notesResult.notes as NoteLite[];
      const quizzes = quizzesRes.data ?? [];
      const decks = decksRes.data ?? [];
      const cards = cardsRes.data ?? [];
      const chunks = (chunksRes.data ?? []) as Array<{ note_id: string }>;
      const activity = (activityRes.data ?? []) as Array<{ login_day: string }>;

      // Save all notes for search
      setAllNotes(notes);

      // Use login activity only for streak and weekly login counts.
      const loginDays = activity.map((a) => new Date(a.login_day));
      const cachedLoginDay = readCachedLoginDay(user.id);
      if (cachedLoginDay === getTodayKey()) {
        loginDays.push(new Date(cachedLoginDay));
      }

      const uploadedIds = new Set(chunks.map((r) => r.note_id).filter(Boolean));
      const uploadedDocTitles = notes
        .filter((n) => uploadedIds.has(n.id))
        .map((n) => n.title || "Untitled")
        .slice(0, 8);

      const weeklyCutoff = new Date();
      weeklyCutoff.setDate(weeklyCutoff.getDate() - 6);
      const weeklyActiveDays = loginDays.filter((day) => day >= weeklyCutoff).length;

      const notesProgress = Math.min(notes.length / 10, 1);
      const quizzesProgress = Math.min(quizzes.length / 5, 1);
      const decksProgress = Math.min(decks.length / 3, 1);
      const overallProgress = Math.round(((notesProgress + quizzesProgress + decksProgress) / 3) * 100);

      const nextStats: DashboardStats = {
        streakDays: computeStreak(loginDays),
        notesCount: notes.length,
        quizzesCount: quizzes.length,
        decksCount: decks.length,
        flashcardsCount: cards.length,
        uploadedDocTitles,
        weeklyActiveDays,
        overallProgress,
        recentNotes: notes.slice(0, 5),
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

  const filteredNotes = useMemo(() => {
    if (!searchQuery.trim()) return stats.recentNotes;
    const query = searchQuery.toLowerCase();
    return allNotes.filter((note) => {
      const titleMatch = (note.title || "").toLowerCase().includes(query);
      const contentMatch = (note.content || "").toLowerCase().includes(query);
      const tagsMatch = (note.tags || []).some((tag) => tag.toLowerCase().includes(query));
      return titleMatch || contentMatch || tagsMatch;
    }).slice(0, 10);
  }, [searchQuery, allNotes, stats.recentNotes]);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Track your learning momentum and key study progress in one place.</p>
      </header>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search notes by title, content, or tags..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 h-10"
        />
      </div>

      {/* Search results or dashboard */}
      {searchQuery.trim() ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-muted-foreground">Search Results ({filteredNotes.length})</p>
          {filteredNotes.length === 0 ? (
            <Card className="p-6 text-center">
              <p className="text-muted-foreground">No notes found matching your search.</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredNotes.map((note) => (
                <Card key={note.id} className="p-4 hover:bg-secondary/40 transition-colors">
                  <h3 className="font-medium break-words">{note.title || "Untitled"}</h3>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1 break-words">
                    {note.content?.slice(0, 100) || "No content"}
                  </p>
                  {note.tags && note.tags.length > 0 && (
                    <div className="flex gap-1 flex-wrap mt-2">
                      {note.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="inline-block px-2 py-0.5 rounded text-xs bg-primary/10 text-primary">
                          {tag}
                        </span>
                      ))}
                      {note.tags.length > 3 && (
                        <span className="text-xs text-muted-foreground">+{note.tags.length - 3} more</span>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-2">
                    {new Date(note.updated_at).toLocaleDateString()}
                  </p>
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card className="p-4 space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground text-sm"><Flame className="h-4 w-4" /> Login Streak</div>
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
                <li key={`${title}-${idx}`} className="text-sm rounded-md border border-border px-3 py-2 bg-background/60 break-words">
                  {title}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <p className="text-sm text-muted-foreground">Weekly logins</p>
          <p className="font-semibold">{loading ? "-" : `${stats.weeklyActiveDays} login day${stats.weeklyActiveDays === 1 ? "" : "s"} in the last 7 days`}</p>
        </div>
      </Card>

      {/* Last Activity section */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2 text-base font-semibold">
          <Clock className="h-4 w-4 text-primary" /> Last Activity
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading activity...</p>
        ) : stats.recentNotes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes yet. Start creating one!</p>
        ) : (
          <ul className="space-y-2">
            {stats.recentNotes.map((note) => (
              <li key={note.id} className="text-sm rounded-md border border-border px-3 py-2 bg-background/60">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium break-words">{note.title || "Untitled"}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(note.updated_at).toLocaleDateString(undefined, { 
                        month: 'short', 
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                  </div>
                  {note.tags && note.tags.length > 0 && (
                    <div className="flex gap-1 flex-wrap sm:justify-end">
                      {note.tags.slice(0, 2).map((tag) => (
                        <span key={tag} className="inline-block px-1.5 py-0.5 rounded text-xs bg-primary/10 text-primary whitespace-nowrap">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      </>
      )}
    </div>
  );
}
