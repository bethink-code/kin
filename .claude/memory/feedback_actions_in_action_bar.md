---
name: User-driven actions belong in the action bar, not floating above scrollable content
description: The pinned PhaseActionBar at the foot of the page exists precisely so actions are always visible. Don't put a CTA-shaped affordance (like Refresh) at the top of a scrollable artefact pane where it can scroll out of view or be missed on first look — put it in the action bar.
type: feedback
---

User-driven actions on a beat screen — Refresh, Reopen ("Something's not right"), Lock-in ("This is my picture") — go in the **PhaseActionBar at the foot of the page**, not floating above the scrollable artefact content.

**Why:** The action bar is always pinned and always visible regardless of scroll. That's the whole point of having it. A button at the top of the artefact pane:
- Scrolls out of view in long prose
- Gets missed entirely on first look (Garth: *"I completely missed it"*)
- Competes visually with the content title

Garth flagged this directly when I first put `RefreshArtefactBar` at the top of the artefact pane. Three slots in `PhaseActionBar`:
- **Left** — secondary (soft, optional, e.g. "Something's not right")
- **Centre** — tertiary (in-flight or supporting actions, e.g. Refresh)
- **Right** — primary (forward CTA, e.g. "This is my picture")

**How to apply:**
- Any new user-driven action: default to slotting into PhaseActionBar (`primary` / `secondary` / `tertiary`).
- Reach for "above the artefact" only for things that are NOT actions — disclosure summaries, scope toggles, format pickers (FormatToggle), etc.
- If you find yourself styling a button as `text-xs text-muted-foreground` to make it "subtle" near the artefact, you're probably putting an action in the wrong place. Move it to the action bar where subtlety isn't a survival strategy.
