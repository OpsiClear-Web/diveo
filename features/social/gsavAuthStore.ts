import { create } from "zustand";
import type { Session, User } from "@supabase/supabase-js";

import { supabase } from "../../services/supabase";

type GsavAuthState = {
  session: Session | null;
  user: User | null;
  initialized: boolean;
  init: (options?: { authInitializationDelayMs?: number }) => void;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

let wired = false;

export const useGsavAuthStore = create<GsavAuthState>((set) => ({
  session: null,
  user: null,
  initialized: false,
  init: (options = {}) => {
    if (wired) return;
    wired = true;
    const delayMs = Math.max(0, Math.trunc(options.authInitializationDelayMs ?? 0));
    const startAuthRestore = () => {
      void supabase.auth
        .getSession()
        .then(({ data }) => set({ session: data.session, user: data.session?.user ?? null, initialized: true }))
        .catch(() => set({ initialized: true }));
      supabase.auth.onAuthStateChange((_event, session) => {
        set({ session, user: session?.user ?? null, initialized: true });
      });
    };
    if (delayMs > 0) {
      globalThis.setTimeout(startAuthRestore, delayMs);
      return;
    }
    startAuthRestore();
  },
  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    return { error: error?.message ?? null };
  },
  signUp: async (email, password) => {
    const { error } = await supabase.auth.signUp({ email: email.trim(), password });
    return { error: error?.message ?? null };
  },
  signOut: async () => {
    await supabase.auth.signOut();
  },
}));
