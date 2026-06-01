# Судебная коллегия Winslow

A Discord OAuth2-protected judicial document generator for a roleplay court. Every login requires manual admin approval via Discord bot buttons sent to a private channel.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/court-app run dev` — run the frontend (Vite dev server)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM (`approved_users` table in `lib/db/src/schema/sessions.ts`)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Auth: Discord OAuth2 + express-session + manual approval flow
- Bot: discord.js — sends approval embed with "Дать доступ"/"Отклонить" buttons to `DISCORD_APPROVAL_CHANNEL_ID`

## Where things live

- `artifacts/api-server/src/routes/auth.ts` — Discord OAuth2 flow, approval logic
- `artifacts/api-server/src/lib/discord-bot.ts` — Discord.js bot, approval button handling
- `artifacts/api-server/src/app.ts` — Express app, session middleware, static serving in prod
- `artifacts/court-app/src/pages/` — login, pending, app pages
- `lib/db/src/schema/sessions.ts` — `approved_users` table schema
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for API contract)
- `railway.toml` — Railway deployment configuration

## Architecture decisions

- Previously approved users (in DB) skip the approval flow and are let in directly on next login.
- Approval token expires in 10 minutes; bot sends Discord embed with buttons.
- In production (Railway), the API server also serves the compiled React frontend as static files.
- Redirect URI is dynamic: `RAILWAY_PUBLIC_DOMAIN` → `REPLIT_DOMAINS` → localhost fallback.
- Session cookies use `sameSite: "none"` + `secure: true` in production for cross-origin support.

## Product

A web app for members of the Winslow roleplay court judiciary. Members log in via Discord; an admin approves or rejects them via Discord bot buttons. Approved members get access to a 5-tab BBCode document generator for roleplay court documents.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Discord OAuth2 redirect URI must be whitelisted in Discord Developer Portal.
  - Dev: `https://<REPLIT_DOMAIN>/api/auth/discord/callback`
  - Prod (Railway): `https://<RAILWAY_PUBLIC_DOMAIN>/api/auth/discord/callback`
- `RAILWAY_PUBLIC_DOMAIN` must be set as an env var in Railway for redirect URI construction.
- Do not use `@custom-variant dark` in Tailwind v4 CSS — it's not a valid utility class.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
