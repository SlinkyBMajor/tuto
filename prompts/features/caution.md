# Cautions

A few cards describe something that can go wrong for the learner in a way the prose around it would bury. Those carry a caution beside the body:

"caution": "Run `kubectl config current-context` first. If it names a cluster you did not create, switch context before this step."

The app draws it as a panel of its own, in red, under the card. It is not decoration and it is not emphasis — it is the one thing on the card that must not be skimmed past.

- **Name the check, not the worry.** "Be careful with your cluster" tells the learner nothing they can act on. "Run `kubectl config current-context` first" does.
- **One or two sentences.** If it needs a paragraph, the risk is really a step, and steps belong in the lesson.
- **Only when following along could cost them something** — data, money, an environment that is not theirs to break. Not when the risk is merely being confused.
- **Rare, and rarer than it feels.** A lesson that cautions on every card has stopped warning about anything, and the one card that really mattered now looks like all the others.
