# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Artifacts

### Architect's Eye (`artifacts/architects-eye`)
- **Type**: react-vite (web app)
- **Preview**: `/`
- **Purpose**: Cesium globe + satellite tracking visualization
- **Key deps**: cesium, vite-plugin-cesium, satellite.js, zustand, tailwindcss, @tailwindcss/forms

#### Source structure
```
src/
  globe/      — Cesium viewer + camera setup
  layers/     — one file per data layer (satellites, orbits, etc.)
  store/      — Zustand global state
  components/ — React UI panels
  ws/         — WebSocket client
  workers/    — Web Workers
  utils/      — helpers
```

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/architects-eye run dev` — run the Architect's Eye frontend

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
