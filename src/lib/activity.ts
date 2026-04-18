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
