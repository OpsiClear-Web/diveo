export const NATIVE_QA_CONTROLS_ENV = "EXPO_PUBLIC_GSAV_QA_CONTROLS";
export const QA_CROSS_ORIGIN_TARGET = "https://example.com";
export const QA_SAME_ORIGIN_PRODUCT_PATH = "/creator/qa-native-blocked";

export type NativeQaControl = {
  id: "same-origin-product-path" | "cross-origin-navigation" | "ended-playback" | "unsupported-renderer";
  label: string;
  expectedSignal: string;
  script: string;
};

type NativeQaControlsEnv = {
  EXPO_PUBLIC_GSAV_QA_CONTROLS?: string;
};

function bridgeMessageScript(message: unknown): string {
  return `window.ReactNativeWebView?.postMessage(${JSON.stringify(JSON.stringify(message))}); true;`;
}

export function nativeQaControlsEnabled(env?: NativeQaControlsEnv): boolean {
  const value = env === undefined
    ? process.env.EXPO_PUBLIC_GSAV_QA_CONTROLS
    : env.EXPO_PUBLIC_GSAV_QA_CONTROLS;
  return value === "1";
}

export const NATIVE_QA_CONTROLS: NativeQaControl[] = [
  {
    id: "same-origin-product-path",
    label: "Same-origin",
    expectedSignal: "Expected: same-origin product path is blocked with native Navigation blocked UI.",
    script: `window.location.assign(${JSON.stringify(QA_SAME_ORIGIN_PRODUCT_PATH)}); true;`,
  },
  {
    id: "cross-origin-navigation",
    label: "Cross-origin",
    expectedSignal: "Expected: navigation is blocked before leaving the trusted GSAV origin.",
    script: `window.location.assign(${JSON.stringify(QA_CROSS_ORIGIN_TARGET)}); true;`,
  },
  {
    id: "unsupported-renderer",
    label: "Unsupported",
    expectedSignal: "Expected: native overlay reports QA unsupported renderer.",
    script: bridgeMessageScript({
      type: "GSAV_CAPABILITIES",
      payload: {
        supported: false,
        renderer: "webgpu",
        reasons: ["QA unsupported renderer"],
      },
    }),
  },
  {
    id: "ended-playback",
    label: "Ended",
    expectedSignal: "Expected: GSAV_ENDED clears saved progress for test.",
    script: bridgeMessageScript({
      type: "GSAV_ENDED",
      payload: { videoId: "test" },
    }),
  },
];
