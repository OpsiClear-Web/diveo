import { useMemo } from "react";
import type { User } from "@supabase/supabase-js";

import { getAuthInitializationDelayMs } from "./authQaDelay";
import { useGsavAuthStore } from "./gsavAuthStore";

export type BridgeSessionTokens = {
  accessToken: string;
  refreshToken: string;
};

export function initializeAuth() {
  useGsavAuthStore.getState().init({ authInitializationDelayMs: getAuthInitializationDelayMs() });
}

export function useAuthUserId() {
  return useGsavAuthStore((state) => state.user?.id);
}

export function useAuthAccount(): { user: User | null; signOut: () => Promise<void> } {
  return {
    user: useGsavAuthStore((state) => state.user),
    signOut: useGsavAuthStore((state) => state.signOut),
  };
}

export function useAuthBridgeSession(): {
  initialized: boolean;
  tokens: BridgeSessionTokens | null;
} {
  const initialized = useGsavAuthStore((state) => state.initialized);
  const session = useGsavAuthStore((state) => state.session);
  const tokens = useMemo(
    () => (session ? { accessToken: session.access_token, refreshToken: session.refresh_token } : null),
    [session],
  );
  return {
    initialized,
    tokens,
  };
}
