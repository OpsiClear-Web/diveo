import { GsavWebView } from "./GsavWebView";
import { GSAV_EXPLORE_EMBED_ROUTE } from "./routes";

// Intentional hosted runtime exception: native Home/Search own catalog browse,
// while gsav-hosting owns Explore's embed/data-saver runtime behavior.
export default function ExploreScreen() {
  return <GsavWebView path={GSAV_EXPLORE_EMBED_ROUTE} />;
}
