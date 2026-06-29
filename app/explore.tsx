// Route: /explore — native Explore tab. Reuses the hosted web /explore Shorts
// feed (vertical autoplay-in-view + infinite scroll, built once on gsav-hosting)
// via the shared GsavWebView, so the autoplay feed stays a single web module
// shared by both platforms rather than a native re-implementation.
import React from "react";

import { GsavWebView } from "../components/GsavWebView";

export default function ExploreScreen() {
  return <GsavWebView path="/explore" />;
}
