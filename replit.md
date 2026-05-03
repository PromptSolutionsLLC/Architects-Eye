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
- **Key deps**: cesium, vite-plugin-cesium, satellite.js, h3-js, zustand, tailwindcss, @tailwindcss/forms

#### Data layers
- **Aircraft** — live `/api/aircraft` poll (adsb.lol upstream, server cache + stale-on-error)
- **Vessels** — live AISStream WebSocket via `/api/ws/vessels` (server filters PositionReport / StandardClassBPositionReport / ShipStaticData)
- **Satellites** — `/api/tle` returns a bundled snapshot instantly (always works); a background refresh from celestrak's `gp.php` (currently WAF-blocked from this Replit egress) and falls back to `tle.ivanstanojevic.me` (paginated, 5000 most-popular sats). 24 h cache.
- **Jamming** — static H3-hex CSV at `public/data/gpsjam-2026-05-01.csv`; cells with bad/total ≥ 5 % rendered as a red gradient via batched Cesium `Primitive` (`PolygonGeometry` per cell, `PerInstanceColorAppearance`).
- **Restricted Airspace** — hardcoded simplified polygons in `src/data/restricted-airspace.ts` (Russia, Iran, North Korean ADIZ, Gaza, Eastern Ukraine). Rendered via `CustomDataSource` with translucent `PolygonGraphics` fill + dashed `PolylineGraphics` outline. Click → entity panel shows advisory.

#### Theaters
- 6 named camera presets in `src/data/theaters.ts` (Strait of Hormuz, Black Sea, North Atlantic Tracks, Korean DMZ, California Wildfire Belt, Russia/Ukraine).
- `flyToTheater(viewer, theater)` in `src/utils/theaters.ts` flies the camera, applies the layer-visibility preset, and triggers the `TheaterToast` (top-center monospace card, 4 s with 300 ms fade).
- `TheaterPanel` looks up the live Cesium viewer through `src/globe/viewer-handle.ts` (a tiny module-level setter/getter the `Viewer` component publishes to on mount).

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
