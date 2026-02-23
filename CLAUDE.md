# CLAUDE.md

## Allowed Commands

These commands are pre-approved for Claude Code to run without user confirmation:

```
npm test
npm run test
npm run -w services/nutrition-engine test
npx vitest run
npx vitest run services/nutrition-engine
npm run typecheck
npm run -w services/nutrition-engine typecheck
npm run -w apps/api typecheck
npm run -w apps/web typecheck
npm run build
npm run -w services/nutrition-engine build
npm run lint
npm install
npm run db:generate
```

## Project Overview

Monorepo using npm workspaces. Key packages:

- `apps/api` — Express API
- `apps/web` — Next.js frontend
- `packages/db` — Prisma schema + migrations
- `packages/contracts` — Zod contracts
- `services/nutrition-engine` — Deterministic nutrient/label math (pure, no DB)

## Testing

Tests use **vitest**. Run from repo root:

```bash
npm test                                    # all workspaces
npm run -w services/nutrition-engine test   # nutrition-engine only
```

## Code Style

- TypeScript throughout
- ESM (`"type": "module"`)
- Do not commit `.env` or secrets
