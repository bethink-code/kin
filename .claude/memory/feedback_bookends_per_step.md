---
name: Every step gets Ally opener + re-opener + closer messages
description: UX rhythm rule — every mode/beat is bookended by an Ally opener (first entry), re-opener (return after break), and closer (validation confirmation). The conversation lives between them.
type: feedback
---

Every step or mode has three Ally messages around the conversation:

1. **Opener** — first entry into the step. Orients ("here's what we're doing now").
2. **Re-opener** — when the user returns to an in-progress chat after a session break. Re-orients with context ("welcome back, where we left off was X, want to keep going from there?"). Distinct from the opener — clean entry vs returning entry.
3. **Closer** — validation / checklist confirmation when the step ends. Reads back the agreement-gate state for the beat being closed: what was covered, what the person said skip on, what's now in the record.

The actual conversation lives between them. This is the rhythm of *every* step on every canvas — gather, analyse, discuss, live, plus any sub-mode.

**Why:** Without bookends, transitions feel abrupt — a screen just swaps and the conversation goes silent. Without re-openers, returning users land in mid-thread and have to mentally rewind. Without closers, agreements feel like they happened to the user rather than with them. Garth flagged the missing closers and re-openers directly while looking at the build.

**The closer is the validation message — checklist confirmation, not generic wrap-up.** So closers can't ship before the agreement-gate / checklist module exists — there's nothing to confirm. Openers and re-openers can ship independently.

**How to apply:**
- All three slot into the state-change module (`server/modules/stateChange/`). Each transition kind fires the relevant handler.
  - `gather_advanced` → close Gather, open Analyse
  - `analyse_completed` → close Analyse, open Discuss
  - `discuss_agreed` → close Discuss, open Live
  - `live_reopened` → close Live, open new Discuss instance
  - `session_resumed` → re-open the current beat (re-opener handler)
- Closer handler must write into the *previous* beat's chat log (the one being closed), not the new one. Per-canvas conversation table routing required.
- Re-opener detection: fires when GET /sub-step/current is called and the most recent message in the beat's chat log is older than some threshold (an hour? a day? — pick a sensible default and make it admin-tweakable). Idempotent: only one re-opener per resumption.
- Openers and re-openers can be deterministic strings (admin-editable in `systemPrompts` per the architecture spec, e.g. `picture_discuss_opener`, `picture_discuss_reopener`) or LLM-generated; closers must be LLM-generated against checklist data.
- Until checklists exist, ship openers + re-openers only. Don't fake closers with "all done!" — the whole point is they're substantive.
