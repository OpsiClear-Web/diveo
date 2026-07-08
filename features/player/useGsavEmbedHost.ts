import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type RefObject } from "react";
import { BackHandler, Linking, Platform } from "react-native";

import { getConfiguredGsavWebUrl, getOrigin } from "../../shared/gsavWeb";
import { usePlayerEmbedPreferences } from "../preferences/preferenceAccess";
import { useAuthBridgeSession } from "../social/authSession";
import { handleGsavEmbedNavigationRequest } from "./gsavEmbedNavigationRequest";
import { useGsavProgressStore } from "./gsavProgressStore";
import { initialNativeBridgeOverlayState, reduceNativeBridgeOverlayState } from "./nativeBridgeOverlay";
import { handleNativeWebViewBridgeMessage } from "./nativeBridgeMessage";
import { initialNativeWebViewLoadState, reduceNativeWebViewLoadState } from "./nativeLoadState";
import type { NativeQaControl } from "./nativeQaControls";
import { handleProgressBridgeMessage } from "./progressBridge";
import { buildNativeEmbedUrl, type GsavEmbedRoute } from "./routes";
import { injectSessionBridgeScriptForAuthState } from "./sessionBridge";

type NativeWebViewHandle = {
  goBack: () => void;
  injectJavaScript: (script: string) => void;
};

type NativeWebViewNavigationState = {
  canGoBack: boolean;
};

type NativeWebViewBridgeEvent = {
  nativeEvent: {
    data: string;
    url?: string;
  };
};

type NativeWebViewRequest = {
  url: string;
};

type NativeWebViewErrorEvent = {
  nativeEvent: {
    description?: string;
  };
};

type UseGsavEmbedHostOptions = {
  path: GsavEmbedRoute;
  qaControls: NativeQaControl[];
  webViewRef: RefObject<NativeWebViewHandle | null>;
};

export function useGsavEmbedHost({ path, qaControls, webViewRef }: UseGsavEmbedHostOptions) {
  const gsavWebUrl = useMemo(() => getConfiguredGsavWebUrl({ platform: Platform.OS }), []);
  const [loadState, dispatchLoadState] = useReducer(
    reduceNativeWebViewLoadState,
    initialNativeWebViewLoadState,
  );
  const [bridgeOverlayState, dispatchBridgeOverlay] = useReducer(
    reduceNativeBridgeOverlayState,
    initialNativeBridgeOverlayState,
  );
  const [canGoBack, setCanGoBack] = useState(false);
  const [qaStatus, setQaStatus] = useState<string | null>(null);
  const [blockedNavigationMessage, setBlockedNavigationMessage] = useState<string | null>(null);
  const { hydrated: settingsHydrated, dataSaver } = usePlayerEmbedPreferences();
  const { initialized: authInitialized, tokens: sessionTokens } = useAuthBridgeSession();
  const saveProgress = useGsavProgressStore((s) => s.save);
  const clearProgress = useGsavProgressStore((s) => s.clear);
  const progressTrackerRef = useRef({ lastFrameSaveAt: 0 });

  const uri = useMemo(() => {
    if (!gsavWebUrl) return "";
    return buildNativeEmbedUrl(path, gsavWebUrl, { dataSaver });
  }, [gsavWebUrl, path, dataSaver]);
  const allowedOrigin = useMemo(() => (gsavWebUrl ? getOrigin(gsavWebUrl) : ""), [gsavWebUrl]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack) {
        webViewRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [canGoBack, webViewRef]);

  const retry = useCallback(() => {
    dispatchLoadState({ type: "retry" });
    dispatchBridgeOverlay({ type: "reset" });
    setQaStatus(null);
    setBlockedNavigationMessage(null);
  }, []);

  const runQaControl = useCallback(
    (control: NativeQaControl) => {
      webViewRef.current?.injectJavaScript(control.script);
      setQaStatus(control.expectedSignal);
    },
    [webViewRef],
  );

  const applySession = useCallback(() => {
    injectSessionBridgeScriptForAuthState(
      webViewRef.current ? (script) => webViewRef.current?.injectJavaScript(script) : null,
      authInitialized,
      sessionTokens,
    );
  }, [authInitialized, sessionTokens, webViewRef]);

  useEffect(() => {
    applySession();
  }, [applySession]);

  const captureProgress = useCallback(
    (data: string) => {
      return handleProgressBridgeMessage(data, progressTrackerRef.current, {
        clearProgress,
        saveProgress,
      });
    },
    [saveProgress, clearProgress],
  );

  const handleNavigationStateChange = useCallback((navState: NativeWebViewNavigationState) => {
    setCanGoBack(navState.canGoBack);
  }, []);

  const handleMessage = useCallback(
    (event: NativeWebViewBridgeEvent) => {
      const result = handleNativeWebViewBridgeMessage({
        allowedOrigin,
        applySession,
        captureProgress,
        data: event.nativeEvent.data,
        pageUrl: event.nativeEvent.url,
      });
      if (result !== "ignored-untrusted-origin" && result !== "session-applied") {
        dispatchBridgeOverlay({ type: "message", data: event.nativeEvent.data });
      }
    },
    [allowedOrigin, applySession, captureProgress],
  );

  const handleShouldStartLoadWithRequest = useCallback(
    (request: NativeWebViewRequest) => {
      return handleGsavEmbedNavigationRequest(request.url, allowedOrigin, qaControls.length > 0, {
        openExternalUrl: (url) => {
          Linking.openURL(url).catch(() => {});
        },
        setBlockedNavigationMessage,
        setQaStatus,
      });
    },
    [allowedOrigin, qaControls.length],
  );

  const handleLoadStart = useCallback(() => {
    dispatchLoadState({ type: "load-start" });
    dispatchBridgeOverlay({ type: "reset" });
    setBlockedNavigationMessage(null);
  }, []);

  const handleLoadEnd = useCallback(() => dispatchLoadState({ type: "load-end" }), []);

  const handleError = useCallback((event: NativeWebViewErrorEvent) => {
    dispatchLoadState({
      type: "load-error",
      description: event.nativeEvent.description,
    });
  }, []);

  return {
    allowedOrigin,
    blockedNavigationMessage,
    bridgeError: bridgeOverlayState.bridgeError,
    handleError,
    handleLoadEnd,
    handleLoadStart,
    handleMessage,
    handleNavigationStateChange,
    handleShouldStartLoadWithRequest,
    isConfigured: Boolean(allowedOrigin),
    isReady: settingsHydrated && authInitialized,
    loadError: loadState.loadError,
    loadKey: loadState.loadKey,
    loading: loadState.loading,
    qaStatus,
    retry,
    runQaControl,
    setBlockedNavigationMessage,
    uri,
  };
}
