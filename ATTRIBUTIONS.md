# Attributions

Architect's Eye is built on top of public data feeds and open-source
software. This file enumerates every external source and the terms
under which it is used.

## Data Sources

**adsb.lol** — https://adsb.lol — Community-maintained ADS-B aggregator.
Primary aircraft feed. Free public API, no key required. Attribution
encouraged. See https://adsb.lol/api for terms.

**adsb.fi** — https://opendata.adsb.fi — Community-run ADS-B opendata
mirror. Used as automatic fallback when adsb.lol is unreachable.
Free public API. See https://github.com/adsbfi for project info.

**AISStream.io** — https://aisstream.io — Real-time AIS vessel position
stream over WebSocket. Free tier with API key registration. We honor
their bounding-box subscription protocol and rate limits.

**Celestrak / ivanstanojevic.me TLE mirror** — https://tle.ivanstanojevic.me
— Two-line element catalog mirror sourced from Celestrak
(https://celestrak.org). Used to seed the 15,304-object satellite
catalog for client-side SGP4 propagation. Celestrak data is in the
public domain.

**GPSJam.org** — https://gpsjam.org — Daily GPS interference reports
binned to H3 hexes, maintained by John Wiseman. Used to render the
"jamming" layer. Attribution: John Wiseman, gpsjam.org.

**NASA FIRMS** — https://firms.modaps.eosdis.nasa.gov — Fire Information
for Resource Management System. We use the VIIRS_SNPP_NRT and
MODIS_C6_1_Global_24h fire hotspot products. Data is in the public
domain. Citation: "We acknowledge the use of data and/or imagery from
NASA's Fire Information for Resource Management System (FIRMS)
(https://earthdata.nasa.gov/firms), part of NASA's Earth Science Data
and Information System (ESDIS)."

**USGS Earthquake Hazards Program** — https://earthquake.usgs.gov —
Real-time earthquake GeoJSON feeds. Data is in the public domain.

**TeleGeography Submarine Cable Map** — https://www.submarinecablemap.com
— Cable topology data (711 cables). Used under TeleGeography's open
data terms; full attribution required. Map data © TeleGeography,
www.telegeography.com.

**Google Maps Photorealistic 3D Tiles** — https://developers.google.com/maps/documentation/tile/3d-tiles
— World surface mesh. Used under the Google Maps Platform Terms of
Service. The on-screen attribution "Imagery © Google" is rendered at
the bottom-left of the viewport at all times, as required.

## Libraries

**CesiumJS** — https://cesium.com/cesiumjs — Apache 2.0 license.
Cesium ion tokens not used; we run with the open-source build only.

**satellite.js** — https://github.com/shashwatak/satellite-js — MIT
license. Client-side SGP4 propagator.

**h3-js** — https://github.com/uber/h3-js — Apache 2.0 license. Used
for GPS jamming hex rendering.

**React** — https://react.dev — MIT license.

**Vite** — https://vitejs.dev — MIT license.

**TailwindCSS** — https://tailwindcss.com — MIT license.

**Zustand** — https://github.com/pmndrs/zustand — MIT license.

**Express** — https://expressjs.com — MIT license.

**Pino** — https://github.com/pinojs/pino — MIT license.

**Zod** — https://github.com/colinhacks/zod — MIT license.

**Drizzle ORM** — https://orm.drizzle.team — Apache 2.0 license.

## Fonts

**JetBrains Mono** — https://www.jetbrains.com/lp/mono — SIL Open Font
License 1.1. Primary terminal typeface.

**IBM Plex Mono** — https://www.ibm.com/plex — SIL Open Font License
1.1. Fallback monospace.

## 3D Models

**ISS hero model** (`public/assets/models/iss.glb`) — Procedural,
hand-built for this project. Released under CC0. Models the
recognizable ISS silhouette (central truss, four pressurised module
clusters, eight solar array wings, radiators, comm dishes, Canadarm2
stub). A search of Sketchfab for "ISS CC0" did not yield a model that
both met the <2MB size budget and was unambiguously CC0-licensed at
the time of authoring, so we ship a procedural stand-in instead.
Source: `artifacts/architects-eye/scripts/build-sat-models.mjs`.

**Generic LEO satellite model** (`public/assets/models/satellite-generic.glb`)
— Procedural, hand-built for this project. Released under CC0. Octagonal
bus, two solar arrays, antenna stub. Used (instanced via Cesium's URI
cache) for every non-ISS satellite when within the 100km LOD threshold.
Source: `artifacts/architects-eye/scripts/build-sat-models.mjs`.

**Procedural fallback** (`public/assets/satellite.glb`) — Original 4KB
procedural model. Released under CC0. Used as a graceful fallback if
either tiered model fails to load.

## Acknowledgments

Special thanks to the maintainers of every feed and library above —
this project would not be possible without your work being free,
open, and well-documented.
