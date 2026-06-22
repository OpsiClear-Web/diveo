import { GsavWebView } from "../components/GsavWebView";

// World A: the native shell opens straight into the hosted diveo app
// (gsav-hosting) at its root. gsav-hosting owns the home / browse / catalog; the
// shell is a thin, trust-gated WebView wrapper around it. See components/GsavWebView.
export default function HomeScreen() {
  return <GsavWebView path="/" />;
}
