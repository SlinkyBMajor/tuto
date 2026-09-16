# The hierarchy so far

Some subjects are a set of things that live inside one another. Pulumi has projects, and stacks inside them, and resources inside those. Kubernetes has a cluster, nodes, pods, containers. A learner meeting those one card at a time knows each word and still cannot say which contains which — and that, not the definitions, is what they are missing.

When this lesson is teaching a structure like that, put the picture on the card that has just named a new rung of it:

"hierarchy": {"levels": [
  {"name": "Project", "depth": 0, "note": "a folder with a Pulumi.yaml in it"},
  {"name": "Stack", "depth": 1, "note": "one deployable instance of that project"},
  {"name": "Resource", "depth": 2, "note": "one cloud object the stack manages"}
], "current": "Stack"}

The app draws it under the card as a small tree, titled "The hierarchy so far", with "current" marked as where the learner has got to.

- **Send the whole thing every time, never a diff.** The app keeps no memory of the last one, so a hierarchy missing its outer rungs is a hierarchy that has lost them.
- **"depth" is containment, not indentation for looks.** 0 is the outermost thing; a rung is one deeper than the thing it lives inside. Two things that live inside the same parent share a depth.
- **Only rungs you have already taught.** This is "so far" — it says where the learner is, and a rung they have not met yet is a spoiler, not a map.
- "note" is at most about eight words. What the thing IS, not why it matters.
- "current" is the rung this card taught, spelled exactly as it appears in "levels".
- Two to six rungs. Deeper than that is not a picture the learner can hold.
- Use the subject's own words for the rungs. If the docs say "stack", it is a stack here.

**Only when the structure is real containment.** Things that merely relate to each other — a client and a server, a producer and a consumer — are not a hierarchy, and a diagram in the card body says that far better. The test is whether you can say "a B lives inside an A" and have it be true.

**Repeat it only when it grows.** Put it on the card that adds a rung, not on every card afterwards. A lesson that redraws the same tree six times has stopped saying anything with it. A card carrying a hierarchy usually does not also carry a takeaway — one picture and one line, both on the same card, is more than the card is worth.
