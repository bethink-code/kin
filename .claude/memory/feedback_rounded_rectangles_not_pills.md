---
name: Rounded rectangles, not pills
description: Visual pattern rule — interactive surfaces (buttons, capsules, cards) use rounded rectangles (rounded-md / rounded-lg), never full-pill (rounded-full). Garth has corrected this multiple times.
type: feedback
---

Interactive surfaces — buttons, the canvas pill, modals, cards — use **rounded rectangles** (Tailwind `rounded-md` or `rounded-lg`). **Never** full-pill capsules (`rounded-full`).

The only exception is genuinely circular elements: avatars, status dots, the inline mode-pill switcher inside Ally's pane (small contained widget where pill-shape reads as "switcher", not "button").

**Why:** Garth has corrected this multiple times. The product's visual language is editorial / typographic / restrained — full pill capsules read as consumer-app, not the considered tone we want. Rounded rectangles match the existing card / modal / button patterns in the codebase.

**How to apply:**
- Default to `rounded-md` for buttons and `rounded-lg` for larger surfaces (canvas pill, agreement gate modal cards).
- When wrapping a button or trigger in a chip-like shape, reach for `rounded-md` first. Stop and check before using `rounded-full`.
- Trigger to notice this: any time you write `rounded-full` on something larger than ~24px tall, ask "is this actually circular, or am I reaching for pill aesthetic by default?"
