import { supabase } from "@/integrations/supabase/client";

/**
 * Track user activity for today (streak/activity logging)
 * This is a fire-and-forget operation - errors are logged but not thrown
 */
export async function trackActivity(userId: string): Promise<void> {
  try {
    await supabase
      .from("user_activity")
      .insert({
        user_id: userId,
        activity_day: new Date().toISOString().split("T")[0],
      })
      .select()
      .single();
  } catch (error) {
    // Silently fail - activity tracking is non-critical
    console.debug("Activity tracking failed:", error);
  }
}

/**
 * Track the user's login day for streaks.
 * This is fire-and-forget so auth flow is not blocked by analytics writes.
 */
export async function trackLoginActivity(userId: string): Promise<void> {
  try {
    await supabase.from("user_login_activity").insert({
      user_id: userId,
      login_day: new Date().toISOString().split("T")[0],
    });
  } catch (error) {
    console.debug("Login activity tracking failed:", error);
  }
}

export function cacheLoginDay(userId: string): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(`studymind.login-day:${userId}`, new Date().toISOString().split("T")[0]);
  } catch {
    // Ignore storage failures.
  }
}

export function readCachedLoginDay(userId: string): string | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage.getItem(`studymind.login-day:${userId}`);
  } catch {
    return null;
  }
}
