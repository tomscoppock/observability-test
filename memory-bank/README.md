# Memory Bank

This folder gives Zoo Code / Roo Code (and any other tool that benefits
from plain-markdown session memory) a native, incrementally-updated record
of project context, in the style popularised by the RooFlow memory bank
pattern.

**`.ai/STATUS.md` is the source of truth.** These files are a
read-optimised view of the same state for tools that expect a memory bank
rather than a task tracker. Refresh them from `.ai/STATUS.md` at the start
and end of a session -- do not let them silently diverge.

| File               | Purpose                                                        |
|---------------------|-----------------------------------------------------------------|
| `productContext.md` | Why the project exists, who it's for, high-level scope          |
| `activeContext.md`  | What's being worked on right now, recent changes, open questions|
| `progress.md`       | What works, what's left, known issues                           |
| `decisionLog.md`    | Key decisions with date and rationale                           |
| `systemPatterns.md` | Architecture patterns and conventions worth remembering          |

Update `activeContext.md` and `progress.md` most often (every session).
Update `decisionLog.md` whenever a non-obvious choice is made. Update
`productContext.md` and `systemPatterns.md` rarely -- only when the
project's shape actually changes.
