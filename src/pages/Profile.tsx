import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { Loader2, Save, Shield, UserCircle2 } from "lucide-react";

interface ProfileRow {
  id: string;
  user_id: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export default function Profile() {
  const { user } = useAuth();
  const [profileLoading, setProfileLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const createdAtText = useMemo(() => {
    if (!user?.created_at) return "-";
    return new Date(user.created_at).toLocaleString();
  }, [user?.created_at]);

  useEffect(() => {
    const loadProfile = async () => {
      if (!user) {
        setProfileLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        toast({ title: "Could not load profile", description: error.message, variant: "destructive" });
      }

      const row = data as ProfileRow | null;
      setDisplayName(row?.display_name ?? (user.user_metadata?.display_name ?? ""));
      setProfileLoading(false);
    };

    void loadProfile();
  }, [user]);

  const saveProfile = async () => {
    if (!user) return;
    setSavingProfile(true);
    try {
      const name = displayName.trim() || null;

      const { error: upsertError } = await supabase
        .from("profiles")
        .upsert(
          {
            user_id: user.id,
            display_name: name,
          },
          { onConflict: "user_id" },
        );

      if (upsertError) throw upsertError;

      const { error: authError } = await supabase.auth.updateUser({
        data: { display_name: name ?? "" },
      });

      if (authError) throw authError;

      toast({ title: "Profile saved", description: "Your display name has been updated." });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async () => {
    if (!newPassword || !confirmPassword) {
      toast({ title: "Missing fields", description: "Please fill both password fields.", variant: "destructive" });
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: "Weak password", description: "Use at least 6 characters.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords do not match", description: "Please re-check and try again.", variant: "destructive" });
      return;
    }

    setChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password updated", description: "Your password has been changed successfully." });
    } catch (e: any) {
      toast({ title: "Password update failed", description: e.message, variant: "destructive" });
    } finally {
      setChangingPassword(false);
    }
  };

  if (!user) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Card className="p-6 text-sm text-muted-foreground">You are not signed in.</Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold">Profile & Account</h1>
        <p className="text-muted-foreground text-sm">Manage your account details and security settings.</p>
      </header>

      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <UserCircle2 className="h-5 w-5 text-primary" />
          <h2 className="font-display text-lg font-semibold">Profile</h2>
        </div>

        <div className="grid md:grid-cols-2 gap-4 text-sm">
          <div>
            <Label>Email</Label>
            <Input value={user.email ?? ""} disabled />
          </div>
          <div>
            <Label>Member Since</Label>
            <Input value={createdAtText} disabled />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              disabled={profileLoading || savingProfile}
            />
          </div>
        </div>

        <Button onClick={saveProfile} disabled={profileLoading || savingProfile} className="bg-gradient-primary text-primary-foreground">
          {savingProfile ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save profile
        </Button>
      </Card>

      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <h2 className="font-display text-lg font-semibold">Security</h2>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="newPassword">New Password</Label>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 6 characters"
              disabled={changingPassword}
            />
          </div>
          <div>
            <Label htmlFor="confirmPassword">Confirm New Password</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat password"
              disabled={changingPassword}
            />
          </div>
        </div>

        <Button onClick={changePassword} disabled={changingPassword} variant="secondary">
          {changingPassword ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Shield className="h-4 w-4 mr-2" />}
          Change password
        </Button>
      </Card>
    </div>
  );
}
