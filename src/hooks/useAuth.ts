import { useEffect, useState } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const applySignedOutState = () => {
      if (!mounted) return;
      setSession(null);
      setUser(null);
      setLoading(false);
    };

    const applySessionState = (sess: Session, verifiedUser: User) => {
      if (!mounted) return;
      setSession(sess);
      setUser(verifiedUser);
      setLoading(false);
    };

    const validateAndApplySession = async (sess: Session | null) => {
      if (!sess) {
        applySignedOutState();
        return;
      }

      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        await supabase.auth.signOut({ scope: "local" });
        applySignedOutState();
        return;
      }

      applySessionState(sess, data.user);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      void validateAndApplySession(sess);
    });

    void supabase.auth.getSession().then(({ data: { session: sess } }) => {
      void validateAndApplySession(sess);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return { session, user, loading, signOut: () => supabase.auth.signOut({ scope: "local" }) };
}
