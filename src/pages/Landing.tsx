import { Link } from "react-router-dom";
import { Brain, MessageSquare, FileText, Sparkles, Volume2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

const features = [
  { icon: FileText, title: "Smart Notes", desc: "Write, paste, or dictate notes — your study material in one place." },
  { icon: MessageSquare, title: "AI Tutor Chat", desc: "Ask anything. Get explanations grounded in your own notes." },
  { icon: Sparkles, title: "Simplified Analysis", desc: "Flip on simplified mode for friendlier explanations and visual flows." },
  { icon: FileText, title: "Summarize PDF", desc: "Turn long PDFs into concise summaries you can review fast." },
  { icon: Volume2, title: "Voice Playback", desc: "Listen to your notes with natural text-to-speech." },
];

const topFeatures = features.slice(0, 3);
const bottomFeatures = features.slice(3);

export default function Landing() {
  const { user } = useAuth();
  return (
    <div className="min-h-screen bg-gradient-hero">
      <header className="container py-4 sm:py-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl bg-gradient-primary flex items-center justify-center shadow-soft">
            <Brain className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-display font-bold text-xl">StudyMind</span>
        </div>
        <Button asChild variant="ghost">
          <Link to={user ? "/app" : "/auth"}>{user ? "Open app" : "Sign in"}</Link>
        </Button>
      </header>

      <main className="container py-12 sm:py-16 md:py-24">
        <section className="max-w-3xl mx-auto text-center animate-fade-in px-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary text-sm text-secondary-foreground mb-6">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            AI Tutor Based Learning
          </div>
          <h1 className="font-display text-3xl sm:text-5xl md:text-6xl font-extrabold leading-tight">
            Study smarter with <span className="text-gradient">StudyMind</span>
          </h1>
          <p className="mt-4 sm:mt-6 text-base sm:text-lg text-muted-foreground">
            Turn your notes into quizzes, flashcards, and a personal AI tutor that listens, speaks, and explains.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button asChild size="lg" className="w-full sm:w-auto bg-gradient-primary text-primary-foreground hover:opacity-90 shadow-elegant">
              <Link to={user ? "/app" : "/auth"}>
                Start studying free <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>

        <section className="mt-12 sm:mt-24 grid gap-4 sm:gap-6 max-w-5xl mx-auto md:grid-cols-3">
          {topFeatures.map((f) => (
            <div key={f.title} className="p-5 sm:p-6 rounded-2xl bg-card border border-border/60 shadow-soft hover:shadow-elegant transition-shadow">
              <div className="h-10 w-10 rounded-xl bg-secondary flex items-center justify-center mb-4">
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-display font-semibold text-lg">{f.title}</h3>
              <p className="text-sm text-muted-foreground mt-2">{f.desc}</p>
            </div>
          ))}
        </section>

        <section className="mt-4 sm:mt-6 grid gap-4 sm:gap-6 max-w-5xl mx-auto md:grid-cols-2">
          {bottomFeatures.map((f) => (
            <div
              key={f.title}
              className="p-5 sm:p-6 rounded-2xl bg-card border border-border/60 shadow-soft hover:shadow-elegant transition-shadow"
            >
              <div className="h-10 w-10 rounded-xl bg-secondary flex items-center justify-center mb-4">
                <f.icon className="h-5 w-5 text-primary" />
              </div>
              <h3 className="font-display font-semibold text-lg">{f.title}</h3>
              <p className="text-sm text-muted-foreground mt-2">{f.desc}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="container py-10 text-center text-sm text-muted-foreground">
        Team Vortex
      </footer>
    </div>
  );
}
