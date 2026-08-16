// The application menu, and why a personal tool with no menus to speak of needs
// one at all.
//
// On macOS the standard editing shortcuts are not handled by the text field, or
// by the WebView, or by the app. They are handled by the MENU: ⌘C only works
// because something in the menu bar claims it and forwards `copy:` to whatever
// has focus. An app that never sets a menu therefore has no clipboard at all —
// selecting text and pressing ⌘C does nothing, which is what was happening here.
//
// So this exists for its Edit menu. Everything around it is the standard
// skeleton a macOS app is expected to have, and `role` is what carries the
// behaviour: Electrobun maps each one to its native responder selector, so the
// app itself implements none of this.

import { ApplicationMenu } from "electrobun/bun";

// Electron-style accelerator strings. Written out rather than left to the role,
// so the key equivalent is a property of this file and not of whatever the
// native layer happens to default to.
const EDIT_MENU = [
	{ role: "undo", accelerator: "CommandOrControl+Z" },
	{ role: "redo", accelerator: "CommandOrControl+Shift+Z" },
	{ type: "divider" as const },
	{ role: "cut", accelerator: "CommandOrControl+X" },
	{ role: "copy", accelerator: "CommandOrControl+C" },
	{ role: "paste", accelerator: "CommandOrControl+V" },
	// Lesson text is markdown and answers are code, so pasting styled text from
	// a browser should arrive as the characters and nothing else.
	{
		role: "pasteAndMatchStyle",
		accelerator: "CommandOrControl+Shift+V",
	},
	{ role: "delete" },
	{ role: "selectAll", accelerator: "CommandOrControl+A" },
];

export function installApplicationMenu() {
	try {
		ApplicationMenu.setApplicationMenu([
			{
				label: "Tuto",
				submenu: [
					{ role: "about" },
					{ type: "divider" },
					{ role: "hide", accelerator: "Command+H" },
					{ role: "hideOthers", accelerator: "Command+Alt+H" },
					{ role: "showAll" },
					{ type: "divider" },
					{ role: "quit", accelerator: "CommandOrControl+Q" },
				],
			},
			{ label: "Edit", submenu: EDIT_MENU },
			{
				label: "Window",
				submenu: [
					{ role: "minimize", accelerator: "CommandOrControl+M" },
					{ role: "zoom" },
					{ role: "toggleFullScreen", accelerator: "Control+Command+F" },
					{ type: "divider" },
					{ role: "close", accelerator: "CommandOrControl+W" },
				],
			},
		]);
	} catch (error) {
		// A missing menu costs the learner their clipboard, not their lesson —
		// so this is reported and stepped over rather than allowed to stop the
		// app from opening.
		console.error("failed to install the application menu:", error);
	}
}
