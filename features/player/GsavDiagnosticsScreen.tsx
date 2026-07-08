import { GsavWebView } from "./GsavWebView";
import { NATIVE_QA_CONTROLS, nativeQaControlsEnabled } from "./nativeQaControls";
import { GSAV_NATIVE_DIAGNOSTICS_EMBED_ROUTE } from "./routes";

export default function GsavDiagnosticsScreen() {
  return (
    <GsavWebView
      path={GSAV_NATIVE_DIAGNOSTICS_EMBED_ROUTE}
      qaControls={nativeQaControlsEnabled() ? NATIVE_QA_CONTROLS : undefined}
    />
  );
}
