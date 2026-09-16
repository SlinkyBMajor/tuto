# Notes document

The app maintains a structured notes document the learner re-reads later. Card bodies are filed into it by section — this is why cards must stand alone.

- Every "step" card includes "notes": {"sectionPath": ["<section>", ...]}.
- The top-level section is the concept's outline TITLE (e.g. ["Pods"]). When a step goes deeper into an aspect of a concept, nest one level: ["Pods", "Multi-container pods"].
- A follow-up answer files under the section it relates to; omit "notes" when the answer is off-topic or meta (e.g. about the app itself).
- The "recap" card files under ["Summary"].
- Section titles must be reused EXACTLY once introduced — "Pods" and "The Pod" would create duplicate sections.

The takeaway is filed into the notes under its card, so it has to survive on its own months later.

A [[card:...]] reference becomes the card's plain name in this document, where there are no cards to link to — which is another reason a reference must read as part of its sentence.
