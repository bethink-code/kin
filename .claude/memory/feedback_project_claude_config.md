---
name: Project Claude config lives in .claude/
description: Preference to keep project memory and skills in the repo, not the global home dir
type: feedback
---

Project-scoped Claude configuration for Kin lives in `c:\LocalDev\Ally 20260417\.claude\`:
- `.claude/memory/` — repo-scoped memory (committed, travels with the repo)
- `.claude/skills/` — project-specific skills (currently empty)
- `CLAUDE.md` stays at repo root (Claude Code auto-discovery convention — `.claude/CLAUDE.md` is NOT auto-loaded)
- `.claude/settings.local.json` is gitignored (per-dev overrides)

**Why:** Garth wants Claude's context to travel with the repo so any machine or contributor picks up the same memory and skills. Established 2026-04-24.

**How to apply:** write new project-specific memories to `.claude/memory/` (and update its `MEMORY.md` index). Put project-specific skills in `.claude/skills/`. Global skills and the bootstrap memory index continue to live in `~/.claude/`. Never move CLAUDE.md into `.claude/` — it belongs at repo root.
