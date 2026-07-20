import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { initSettings } from "@/components/settings";
import { getHighlighter } from "@/lib/highlighter";
import { bunSend } from "@/lib/rpc";
import App from "./App";

initSettings();

// Mermaid is still loaded lazily, so it still has to prove it resolves in this
// environment (chunks load over views:// in the packaged app). Shiki no longer
// appears here: it is bundled statically, and preloading the full `shiki`
// entry was what pulled all 400+ grammar chunks into the build.
import("mermaid").then(
	() => bunSend.logToBun({ msg: "dynamic import OK (mermaid)" }),
	(error) => bunSend.logToBun({ msg: `dynamic import FAILED: ${error}` }),
);

// Warm the highlighter so the first card's code is styled on arrival rather
// than flashing unhighlighted.
void getHighlighter();

// Follow the system light/dark preference (shadcn theming keys off .dark)
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
function applyColorScheme() {
	document.documentElement.classList.toggle("dark", darkQuery.matches);
}
applyColorScheme();
darkQuery.addEventListener("change", applyColorScheme);

const root = document.getElementById("root");
if (!root) {
	throw new Error("Root element not found");
}

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
