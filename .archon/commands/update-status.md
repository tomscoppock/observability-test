# Command: update-status

Read `.ai/STATUS.md` and the item currently in `.ai/in-progress/`. Update
`.ai/STATUS.md` so that:

- "Active work" reflects the current `.ai/in-progress/` item(s).
- "Blockers" reflects any open question logged in that item.
- The "Last updated" date is today.

Do not remove history from `.ai/STATUS.md` -- append or update the
relevant section only. If this repo also has a `memory-bank/` folder,
refresh `memory-bank/activeContext.md` and `memory-bank/progress.md` from
the same information so both tracking formats agree.
