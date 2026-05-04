# Architect's Eye

**Live OSINT terminal for global situational awareness, rendered on photorealistic 3D Earth.**

🌐 **Live demo:** https://architects-eye.replit.app

---

## About

Built from scratch solo in 24 hours for the [Replit 10 Year Buildathon](https://buildathons.replit.app) (May 2–3, 2026).

I'm self-taught, sales background, 34, no CS degree. This was a test of what someone with zero formal training could build in a single day with one AI assistant ([Claude](https://claude.ai)) and one [Replit Agent](https://replit.com/agent) — not eight agents, not a weekend, just one and 24 hours.

Inspired by [Bilawal Sidhu](https://twitter.com/bilawalsidhu)'s WorldView. He built his in a weekend with 8 agents. I was ecstatic to try and build this in a day with 1.

The real test wasn't whether I could ship features. It was whether the orchestration patterns I've been developing — digital passport handoffs between context windows, manifest diffs, meta-controller skills, adversarial self-audit frameworks, drift control across long sessions, multi-AI workflows — could carry a 24-hour solo build without falling apart.

They held.

---
 
## Features

- **Real-time aircraft** — ADS-B feeds with auto-failover (adsb.lol → adsb.fi)
- **Real-time vessels** — AIS via AISStream.io WebSocket, 21,000+ active ships
- **Satellites** — 15,304 objects propagated client-side via SGP4 (satellite.js); high-fidelity 3D models swap in on close approach
- **GPS jamming hexes** — H3-binned interference reports from GPSJam.org
- **Restricted airspace** — military operating areas and prohibited zones as filled polygons
- **Live wildfires** — NASA FIRMS VIIRS + MODIS hotspots, last 24h
- **Earthquakes** — USGS feed, magnitude-graded markers
- **Submarine cables** — TeleGeography topology, 711 cables as styled polylines
- **Time scrubber** — 6h client-side replay buffer with 1× / 15× playback
- **Theater flythroughs** — six named geopolitical hotspots with curated camera tours
- **Universal entity search** — single search box queries every active layer + theaters
- **Stackable EntityCards** — pin, drag, collapse, dedup; click any entity to fly camera + open card

## Tech Stack

- **Globe** — CesiumJS 1.140 with Google Photorealistic 3D Tiles
- **Frontend** — React 18, Vite, TypeScript, Zustand, TailwindCSS
- **Server** — Express + Pino, OpenAPI-typed routes (Zod), generated React Query hooks
- **Streaming** — native WebSocket for AISStream, polled REST for everything else
- **Storage** — IndexedDB for replay buffer; in-memory LRU cache server-side
- **Monorepo** — pnpm workspaces with shared `lib/*` and per-artifact `tsconfig`

## Data Sources

All sources are public and free.

- **adsb.lol** — primary ADS-B aircraft feed: https://adsb.lol
- **adsb.fi** — fallback ADS-B feed (opendata): https://opendata.adsb.fi
- **AISStream.io** — real-time vessel positions: https://aisstream.io
- **Celestrak / ivanstanojevic.me** — TLE satellite catalog mirror: https://tle.ivanstanojevic.me
- **GPSJam.org** — daily GPS interference H3 hex grid (John Wiseman): https://gpsjam.org
- **NASA FIRMS** — VIIRS_SNPP_NRT + MODIS_C6_1_Global_24h fire hotspots: https://firms.modaps.eosdis.nasa.gov
- **USGS** — Earthquake Hazards Program GeoJSON feed: https://earthquake.usgs.gov
- **TeleGeography** — Submarine Cable Map data: https://www.submarinecablemap.com
- **Google Maps Photorealistic 3D Tiles** — world surface mesh: https://developers.google.com/maps/documentation/tile/3d-tiles

## Credits

- **Inspiration:** [Bilawal Sidhu](https://twitter.com/bilawalsidhu) and his WorldView project — the spark that triggered this build.
- **AI orchestration:** [Claude](https://claude.ai) (Anthropic) as prompt engineer and self-auditor.
- **Code execution:** [Replit Agent 4](https://replit.com/agent) as primary builder.
- **Built for:** [Replit 10 Year Buildathon](https://buildathons.replit.app), May 2–3, 2026.

Solo build by [Zachary Wilson](https://github.com/PromptSolutionsLLC) / [Prompt Solutions LLC](https://promptsolutions.shop).

---

## Local Development

```bash
git clone <this-repo>
pnpm install
# Required env vars:
#   VITE_CESIUM_ION_TOKEN=your_cesium_ion_token
#   VITE_GOOGLE_MAPS_API_KEY=your_google_maps_api_key
#   VITE_AISSTREAM_API_KEY=your_aisstream_api_key
#   FIRMS_API_KEY=your_nasa_firms_api_key
# Then start the api server + web app via the Replit workflows,
# or:
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/architects-eye run dev
```

The web app expects the API server to be reachable at `/api` via the
shared reverse proxy (handled automatically on Replit).

## Acknowledgments

See [ATTRIBUTIONS.md](./ATTRIBUTIONS.md) for full attribution of every data
source, library, and font used by this project.
