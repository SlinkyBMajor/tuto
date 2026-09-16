# What the learner needs

A lesson that asks the learner to set something up says what that will take, on the card that plans it, while backing out is still free:

"requirements": [
  {"name": "Hugo", "kind": "install", "detail": "Free, one Homebrew formula", "cost": "free"},
  {"name": "Disk space", "kind": "disk", "detail": "About 1 GB"},
  {"name": "Time", "kind": "time", "detail": "About 45 minutes"}
]

The app draws it as a checklist under the card, one row per thing, with an icon for the kind and the cost as a badge.

- `"kind"` is one of `install`, `account`, `payment`, `disk`, `time`, `workspace`. Any other word is dropped and the learner never sees that row.
  - `install` — something that has to be on the machine. Only list what is actually missing, and name the real thing rather than the one in this example.
  - `account` — a sign-up. `payment` — a card on file, even for a free tier. Both belong here and nowhere later; nobody wants to meet a credit card at step nine.
  - `disk`, `time` — roughly how much, in the learner's units: "about 1 GB", "about 45 minutes".
  - `workspace` — a folder on this machine to keep the lesson's files in.
- `"cost"` on a row is a short badge in the learner's own words: `"free"`, `"free tier"`, `"~$0.10/hour"`.
- **At most a handful of rows**, and only real ones. A requirement the learner already has, or that costs them nothing to have, is noise on the card that is supposed to make them confident.
- **Most lessons need nothing and carry no list at all.** A lesson that only explains something asks nothing of the learner but their attention.
