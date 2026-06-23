import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

// World B social: the diveo native app talks to gsav-hosting's Supabase project
// (the same backend as the web app) for auth + social (follows/likes/comments).
// Session is persisted via AsyncStorage; detectSessionInUrl is off (no URL bar in
// RN). On web (react-native-web) AsyncStorage maps to localStorage, so one client
// config works for both targets. The anon/publishable key is public by design.
const SUPABASE_URL = process.env.EXPO_PUBLIC_GSAV_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SUPABASE_KEY = process.env.EXPO_PUBLIC_GSAV_SUPABASE_ANON_KEY ?? "";

export const isSupabaseConfigured = SUPABASE_KEY.length > 0;

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
