---
name: Garth's custom Claude Code skills
description: Inventory of skills in ~/.claude/skills/ — each encodes a reusable pattern
type: reference
---

Custom skills Garth has authored in `~/.claude/skills/` (global, apply to every Bethink/Molo project):

**Scaffolding / setup:**
- `scaffold-project` — bootstrap React+Vite+Tailwind+Express+Drizzle+Neon+OAuth stack
- `setup-doppler` — Doppler onboarding (CLI, dev/prd configs, Vercel integration, delete .env)
- `add-admin-console` — admin console with users, invites, audit logs, security overview
- `add-security-hardening` — helmet, CORS, rate limiting, input validation, ownership checks

**Design / content:**
- `molo-ui-design` — Molo brand tokens, typography, components, messaging rules

**Quality gates:**
- `security-guardian` — always-on server-side change review
- `security-review`, `code-review`, `pre-commit-check`, `simplify` — review and cleanup passes

How to apply: before proposing an architectural pattern or starter for a Bethink/Molo project, check these first. They're canonical — defer to them over generic best practice. When Garth says "add an admin console" or "harden security", invoke the matching skill rather than rolling a bespoke implementation.
