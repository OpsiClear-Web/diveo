export type NativeWebViewLoadState = {
  loadError: string | null;
  loadKey: number;
  loading: boolean;
};

export type NativeWebViewLoadAction =
  | { type: "load-start" }
  | { type: "load-end" }
  | { type: "load-error"; description?: string | null }
  | { type: "retry" };

export const initialNativeWebViewLoadState: NativeWebViewLoadState = {
  loadError: null,
  loadKey: 0,
  loading: true,
};

export function getNativeWebViewLoadError(description?: string | null): string {
  return description || "Unable to load diveo.";
}

export function reduceNativeWebViewLoadState(
  state: NativeWebViewLoadState,
  action: NativeWebViewLoadAction,
): NativeWebViewLoadState {
  switch (action.type) {
    case "load-start":
      return { ...state, loadError: null, loading: true };
    case "load-end":
      return { ...state, loading: false };
    case "load-error":
      return {
        ...state,
        loadError: getNativeWebViewLoadError(action.description),
        loading: false,
      };
    case "retry":
      return {
        loadError: null,
        loadKey: state.loadKey + 1,
        loading: true,
      };
  }
}
