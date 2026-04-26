# .claude/

Project-scoped Claude Code configuration for Kin. Everything in here travels with the repo.

## Layout
- `memory/` — repo-scoped memories (project facts, feedback, references). `MEMORY.md` is the index.
- `skills/` — custom skills specific to this project. Global skills live in `~/.claude/skills/`.
- `settings.json` (optional) — project-level Claude Code settings. Create only if needed.
- `settings.local.json` (optional, gitignored) — per-developer overrides.

## What's NOT in here
- `CLAUDE.md` — lives at the repo root by convention; Claude Code auto-discovers it there.
- Session transcripts and harness-written memories — those live under `~/.claude/projects/<slug>/` on each developer's machine.
