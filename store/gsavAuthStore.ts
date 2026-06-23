import { create } from "zustand";
import type { Session, User } from "@supabase/supabase-js";

import { supabase } from "../services/supabase";

// World B auth: the diveo native session backed by gsav-hosting's Supabase auth.
// Distinct from the legacy Bilibili authStore. init() wires session restore +
// onAuthStateChange once; settings/creator read `user` to gate social actions.
type GsavAuthState = {
  session: Session | null;
  user: User | null;
  initialized: boolean;
  init: () => void;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

let wired = false;

export const useGsavAuthStore = create<GsavAuthState>((set) => ({
  session: null,
  user: null,
  initialized: false,
  init: () => {
    if (wired) return;
    wired = true;
    void supabase.auth
      .getSession()
      .then(({ data }) => set({ session: data.session, user: data.session?.user ?? null, initialized: true }))
      .catch(() => set({ initialized: true }));
    supabase.auth.onAuthStateChange((_event, session) => {
      set({ session, user: session?.user ?? null, initialized: true });
    });
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
