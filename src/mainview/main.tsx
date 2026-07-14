import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { initSettings } from "@/components/settings";
import { bunSend } from "@/lib/rpc";
import App from "./App";

initSettings();

// Startup probe: proves the lazy-loaded chunks resolve in this environment
// (they load over views:// in the packaged app). Logged to the bun process.
Promise.all([import("mermaid"), import("shiki")]).then(
	() => bunSend.logToBun({ msg: "dynamic imports OK (mermaid, shiki)" }),
	(error) => bunSend.logToBun({ msg: `dynamic import FAILED: ${error}` }),
);

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
