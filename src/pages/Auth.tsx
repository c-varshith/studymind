import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { Brain, Sparkles } from "lucide-react";

export default function Auth() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const isRateLimitError = (message: string) => {
    const m = message.toLowerCase();
    return m.includes("rate limit") || m.includes("too many requests") || m.includes("over_email_send_rate_limit");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/app`, data: { display_name: name } },
        });
        if (error) throw error;
        if (data.session) {
          toast({ title: "Account created", description: "You are now signed in." });
          nav("/app");
          return;
        }
        toast({ title: "Account created", description: "Please sign in to continue." });
        setMode("signin");
        return;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          if (error.message.toLowerCase().includes("email not confirmed")) {
            toast({
              title: "Email not confirmed",
              description: "Please confirm from your existing inbox email first. Automatic resend is disabled to avoid hitting provider limits.",
              variant: "destructive",
            });
            return;
          }
          throw error;
        }
      }
      nav("/app");
    } catch (err: any) {
      const message = err?.message ?? "Unknown authentication error";
      if (isRateLimitError(message)) {
        toast({
          title: "Email limit reached",
          description: "Your auth email provider limit is hit. Wait for reset or disable email confirmation temporarily in Supabase Auth settings.",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Auth error", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-hero flex items-center justify-center p-6">
      <div className="w-full max-w-md animate-fade-in">
        <div className="mb-8 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-primary shadow-elegant mb-4">
            <Brain className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="font-display text-3xl font-bold">Welcome to StudyMind</h1>
          <p className="text-muted-foreground mt-2">Your AI study companion with voice & quizzes</p>
        </div>

        <Card className="p-6 shadow-elegant border-border/60">
          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="name">Display name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex" />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button
              className="w-full bg-gradient-primary text-primary-foreground hover:opacity-90 shadow-soft"
              disabled={loading}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              {loading ? "Loading…" : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>
          <button
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-4 w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
          </button>
        </Card>
      </div>
    </div>
  );
}