export const AUTH_QA_DELAY_ENV = "EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS";
export const MAX_AUTH_QA_DELAY_MS = 10000;

type AuthQaDelayEnv = {
  EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS?: string;
};

export function getAuthInitializationDelayMs(env?: AuthQaDelayEnv): number {
  const rawValue = env === undefined
    ? process.env.EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS
    : env.EXPO_PUBLIC_GSAV_QA_AUTH_DELAY_MS;
  if (!rawValue) return 0;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(Math.trunc(parsed), MAX_AUTH_QA_DELAY_MS);
}
