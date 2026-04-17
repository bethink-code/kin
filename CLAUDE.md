# Kin

A personal financial story app that helps South Africans build, understand, and act on their financial situation.

## Stack
- Frontend: React 18 + Vite + Tailwind CSS v4 + shadcn/ui (Radix)
- Backend: Express + TypeScript (tsx for dev, esbuild for prod)
- ORM: Drizzle
- Database: Neon PostgreSQL (dev + prd branches)
- Auth: Google OAuth via Passport + server-side PostgreSQL sessions
- AI: Anthropic Claude API (`@anthropic-ai/sdk`) — Sonnet 4.6 for extraction/analysis/story
- Hosting: Vercel (static frontend + serverless API)

## Commands
```bash
npm run dev          # doppler run -- concurrent server + client
npm run build        # vite build (client only)
npm run build:api    # esbuild server/api.ts → api/index.mjs (required before every deploy)
npm run db:push      # drizzle-kit push against Doppler's DATABASE_URL
npm run seed:admin   # promote garth + savannah to admin
```

## Secrets
Managed by Doppler. **Never** create a `.env` file. All secrets live in Doppler configs `dev` and `prd`.

Required keys (in both configs):
- `DATABASE_URL` — Neon connection string (dev branch in `dev`, main branch in `prd`)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `SESSION_SECRET` — **different** values per config
- `ADMIN_EMAIL` — seed admin email
- `NODE_ENV` — `development` in dev, `production` in prd
- `ANTHROPIC_API_KEY` — added once we wire Module 1

## Import conventions
- Server: relative paths (`../db`, `./auth`)
- Client: `@/` for `client/src/*`, `@shared/*` for `shared/*`

## Architecture
```
client/    React SPA (Vite root)
server/    Express API (tsx dev / esbuild bundle for Vercel)
  routes/  split by domain — never a single routes.ts
shared/    Drizzle schema + shared types (imported by both client and server)
api/       generated Vercel function bundle (gitignored, built by build:api)
scripts/   one-off admin scripts (seed, migration helpers)
```

## Database (shared/schema.ts)
- `sessions` — required by connect-pg-simple
- `users` — id, email, names, profile pic, isAdmin, termsAcceptedAt
- `invited_users` — email whitelist
- `access_requests` — public "request access" form queue
- `audit_logs` — every sensitive action

## Routes
- `server/routes/auth.ts` — Google OAuth, logout, current user, terms acceptance, access request
- `server/routes/admin.ts` — user mgmt, invites, access requests, audit log, security overview
- When adding a new route domain (e.g. `extract`, `profile`, `story`), create a new file in `server/routes/`. Never bolt onto an existing domain's router.

## Shared helpers
- `client/src/lib/formatters.ts` — `formatMoney` (ZAR), `formatPercent`, `formatTimeAgo`, `formatDate`. Never reimplement these.
- `client/src/lib/invalidation.ts` — cache invalidation helpers. Never call `queryClient.invalidateQueries()` inline.
- `client/src/lib/constants.ts` — shared status maps and labels.

## Reusable components
- `components/Tabs.tsx` — underline tabs, the only tab pattern we use
- `components/Stat.tsx` — label + value display
- `components/LastUpdated.tsx` — every data view gets one
- `components/PinnedActionBar.tsx` — sticky bottom action bar for scrollable pages

## Guiding principles (product-specific)
- **No dashboards, ever.** No charts, no pie graphs, no traffic lights. Editorial, typographic, narrative only.
- **Business language, not dev language.** "Your money moves" not "Spending totals." "You don't have this" not "Missing coverage."
- **Objectivity above all.** No product recommendations, no referral fees, no provider relationships. FAIS category-level only.
- **POPIA-sensitive data.** Bank statements, transactions, personal financial data. Never log sensitive payload content.
- **Admin-editable system prompts.** Extraction / analysis / Q&A / story prompts all live in DB, versioned, with test + rollback. Never hardcoded.

## Rules
- When adding a new route, create a new file in `server/routes/` — never add to an existing file that handles a different domain.
- When formatting money, dates, percentages, or time-ago, use the helpers in `client/src/lib/formatters.ts` — never reimplement.
- When invalidating cache after a mutation, use or extend the helpers in `client/src/lib/invalidation.ts` — never call `qc.invalidateQueries()` inline.
- When adding tabs to a page, use the `Tabs` component — never roll custom tab JSX.
- When showing stats, use the `Stat` component.
- Every data view must include `<LastUpdated dataUpdatedAt={query.dataUpdatedAt} />`.
- Action buttons on scrollable pages go in `<PinnedActionBar>`.
- Never disable a submit button for validation. Show amber warnings after submission attempt.
- No source file should exceed 300 lines. Split before adding.
- After ANY server-side change, run `npm run build:api` and commit `api/index.mjs`.

## Windows quirks
- Never use `tsx watch` in npm scripts — infinite restart loop on Windows. Use `npx tsx server/index.ts` (single run).
- `channel_binding=require` in Neon URLs is stripped automatically by `db.ts`.
- Tailwind v4 uses `@tailwindcss/vite` — PostCSS config is autoprefixer only.
- `wait-on` gates Vite behind Express listening on 5000. Frontend dev server is on 5173.
