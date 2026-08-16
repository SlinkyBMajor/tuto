# The desktop shell

What Electrobun gives the app and what the app has to ask for. Lives in `src/bun/index.ts` (the window) and `src/bun/menu.ts` (the menu).

## The application menu is the clipboard

**An app with no menu has no ⌘C.** On macOS the standard editing shortcuts are not handled by the text field, the WebView, or the app — they are handled by the *menu*. ⌘C works because something in the menu bar claims that key equivalent and sends `copy:` to whatever has focus. A window-only app never sets one, so selecting text and pressing ⌘C does nothing at all, anywhere in it. That was true here until `installApplicationMenu` existed.

So `menu.ts` exists for its Edit menu; the app and window menus around it are the standard skeleton macOS expects. Every item is a `role`, which Electrobun maps to the native responder selector — the app implements none of the behaviour. Accelerators are written out rather than left to the role, so the key equivalent is a property of this file.

**It must be installed after the window, not before.** A menu set before a window exists is replaced by the native layer's default, and the app comes up with no Edit menu — which is indistinguishable from not having called it at all. This is the kind of thing that is easy to "fix" by moving the call earlier, so: later.

Verified by reading the live menu bar out of the running app rather than by eye — the Edit menu reports `Cut ⌘X, Copy ⌘C, Paste ⌘V, Select All ⌘A`, and macOS attaches its own AutoFill and Dictation items, which it only does to a menu it recognises as the real Edit menu.

## The WebView is not a browser

Two consequences worth knowing before reaching for a web API:

- **`views://` is not a secure context**, so the async clipboard API can be missing. `CopyButton` in `card-markdown.tsx` falls back to `document.execCommand("copy")` for that reason.
- **The OS edits text as you type it.** macOS autocorrect, autocapitalisation and text substitution are on by default in a WKWebView, which rewrites symbol names in a question and forces a capital onto `groupId` in a practice answer. Every free-text field spreads `RAW_TEXT_INPUT` (`src/mainview/lib/text-input.ts`) to turn all of it off from one place.

## Dev and HMR

`pnpm start` builds the views and runs the app from the bundle. `pnpm dev` also starts Vite and sets `TUTO_HMR=1`; the app only looks for a dev server when that variable is set. Auto-detecting one is deliberately not done — the app would bind to a server whose lifecycle it does not control, and dynamic imports break the moment that server goes away.
