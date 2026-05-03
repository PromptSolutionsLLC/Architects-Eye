P16: Mobile gate, error boundary, README, ATTRIBUTIONS. Final phase before Loom.

1. MOBILE GATE

Architect's Eye is a desktop-first WebGL experience. Cesium + 15k satellites + photoreal tiles will tank a phone. Show a friendly "desktop only" gate on mobile/narrow viewports rather than letting it crash.

components/MobileGate.tsx — new file:
- Detect: window.innerWidth < 1024 OR navigator.maxTouchPoints > 1 (touch device)
- If gate active: render full-viewport overlay, position:fixed inset:0, black background, z-index 99999 (above boot screen, above everything)
- Center-aligned content, JetBrains Mono amber:
  Line 1: "ARCHITECT'S EYE"
  Line 2: "DESKTOP TERMINAL REQUIRED"
  Line 3: "" (blank)
  Line 4: "This OSINT terminal renders 15,304 satellites,"
  Line 5: "21,000+ vessels, and Google Photoreal 3D Tiles"
  Line 6: "in real time. Mobile devices are not supported."
  Line 7: "" (blank)
  Line 8: "Open this URL on a desktop or laptop:"
  Line 9: window.location.href (rendered as monospace, selectable)
  Line 10: "" (blank)
  Line 11: "[ MIN VIEWPORT: 1024px ]"
- No "continue anyway" button — gate is hard. Judges on phones see a clean professional message instead of a broken page.
- Re-evaluate gate on window.resize — if user expands window past 1024px, gate hides automatically (covers desktop users with narrow windows).

2. ERROR BOUNDARY

Wrap App in a React ErrorBoundary so a runtime crash shows a recoverable fallback instead of a white screen.

components/ErrorBoundary.tsx — new file:
- Class component implementing componentDidCatch
- Fallback UI: full-viewport black, JetBrains Mono amber:
  Line 1: "ARCHITECT'S EYE"
  Line 2: "TERMINAL FAULT"
  Line 3: "" (blank)
  Line 4: errorMessage (caught error.message, monospace, white)
  Line 5: "" (blank)
  Line 6: [ RELOAD ] button — refreshes window
  Line 7: [ COPY ERROR ] button — copies error + stack to clipboard
- Logs error + stack to console with [ERROR BOUNDARY CAUGHT] tag
- Wraps everything inside <BootScreen> too so even Cesium init crashes are caught

main.tsx (or App.tsx root): wrap entire tree in <ErrorBoundary>

3. README.md

Project README at repo root. Should look professional for judges who clone the repo.

Structure:
- Title + tagline: "# Architect's Eye" / "Live OSINT terminal for global situational awareness."
- Live URL: https://architects-eye.replit.app
- Hero screenshot placeholder (we'll add after Loom): ![Architect's Eye](docs/hero.png)
- ## Features section — bullet list of all 8 layers + features:
  - Real-time aircraft (ADS-B)
  - Real-time vessels (AIS)
  - 15,304 satellites (SGP4 propagation, 3D models on close approach)
  - GPS jamming hexes (GPSJam.org)
  - Restricted airspace polygons
  - Live wildfires (NASA FIRMS)
  - Earthquakes (USGS)
  - Submarine cables (TeleGeography, 711 cables)
  - Time scrubber with 6h replay buffer
  - Theater flythroughs (6 named regions)
  - Universal entity search
  - Stackable EntityCards with pinning + drag
- ## Tech Stack section — Cesium + Photoreal 3D Tiles + Vite + React + TypeScript + Express + WebSocket + IndexedDB
- ## Data Sources section — link each: ADSB.lol, adsb.fi, AISStream.io, Celestrak/IvanStanojevic mirror, GPSJam.org, NASA FIRMS, USGS, TeleGeography. Note all sources are public + free.
- ## Built For section — "Replit 10 Buildathon · May 2-3, 2026 · 24-hour build"
- ## Local Development — minimal: clone, npm install, set env vars, npm run dev
- ## Acknowledgments — links to ATTRIBUTIONS.md

Tone: professional, terse, no marketing fluff. Judges will skim.

4. ATTRIBUTIONS.md

Full attribution for every data source and library that requires it.

Structure:
- Title: "# Attributions"
- Per data source, single paragraph: source name, URL, license, what we use it for, link to their full attribution requirements
- Cover: ADSB.lol, adsb.fi, AISStream.io, Celestrak, ivanstanojevic.me TLE mirror, GPSJam.org / John Wiseman, NASA FIRMS (VIIRS_SNPP_NRT + MODIS_C6_1_Global_24h), USGS Earthquake Hazards Program, TeleGeography Submarine Cable Map, Google Maps Photorealistic 3D Tiles (note Google's attribution requirements — usually "Imagery © Google"), Cesium ion / CesiumJS, satellite.js, h3-js
- Per library/font: JetBrains Mono (OFL), IBM Plex Mono (OFL), TailwindCSS (MIT), Vite (MIT), React (MIT), Zustand (MIT)

5. GOOGLE ATTRIBUTION ON-SCREEN

Google requires visible attribution when using Photoreal 3D Tiles. Add a small monospace text element bottom-left of the viewport: "Imagery © Google" or "© Google Maps". White text, 60% opacity, 11px, JetBrains Mono. Always visible (not hidden behind any panel). z-index above globe, below all UI panels.

DEFINITION OF DONE:
- Resize browser window to <1024px OR open on a phone → hard gate appears with JetBrains Mono amber message
- Resize back to ≥1024px → gate disappears, app loads
- Force a runtime crash (e.g. dev tools throw new Error in any layer) → ErrorBoundary catches, shows TERMINAL FAULT screen with reload + copy error buttons, no white screen
- README.md visible at repo root, comprehensive
- ATTRIBUTIONS.md visible at repo root, comprehensive
- "© Google" attribution visible bottom-left of running app at all times
- Boot screen still works, error boundary wraps everything including boot screen

DO NOT TOUCH:
- Any data fetching, layer rendering, click handlers, search, replay, theaters, click-to-fly, P12 cards, P14 search, P15 polish, server routes
- Pure additive — three new components + two markdown files + one attribution string

After this lands: Loom recording, then submission.