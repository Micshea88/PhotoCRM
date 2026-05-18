# Pathway Foundation


Production-grade Next.js 16 + Vercel + Postgres starter, opinionated for Claude Code agentic development.


## Quick start

1. `pnpm install`
2. `pnpm setup` (interactive — fills `.env.local`)
3. `docker compose up -d` (local Postgres)
4. `pnpm db:migrate`
5. `pnpm seed` (optional — demo user + org + items)
6. `pnpm dev`

## Documentation

- First-day handoff: [`docs/handoff-checklist.md`](docs/handoff-checklist.md)
- Architecture overview: [`docs/architecture.md`](docs/architecture.md)
- Deployment runbook: [`docs/deployment.md`](docs/deployment.md)
- Agent operating guide: [`AGENTS.md`](AGENTS.md)
- Outstanding hardening punch list: [`TODO.md`](TODO.md)
