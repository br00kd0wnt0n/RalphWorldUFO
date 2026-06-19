# Ralph World — UFO Planet

Explore a tiny cartoon planet in a little UFO. A single-file WebGL / Three.js
experience styled after [ralph.world](https://ralph-world-production.up.railway.app/):
a flat-grey, ink-outlined mini-planet split into five themed **zones** (TV,
Magazine, Lab, Events, Shop), strewn with real CMS discoveries you fly up to and
read, a fly-in **drive-in theatre** playing the live ralph.world broadcast with
spatialised audio, a flock of autonomous UFOs, and the ralph.world logo as a
background planet.

## Controls
- **W A S D** — fly (hold forward to speed up)
- **hold Space** — float higher (release to drift back down)
- Fly close to a signpost to open its discovery panel; fly near the theatre to hear the stream.

## Run locally
```bash
npm start          # serves on http://localhost:8080
# or just open index.html directly (works offline via an inlined content snapshot)
```

## Deploy (Railway)
Zero-config: Railway/Nixpacks detects `package.json` and runs `npm start`
(`server.js`, a dependency-free static server that binds to `$PORT`).

## Content
`index.html` reads `content.json` (the scattered articles / events / lab items /
magazine issues + the HLS stream URL). When served it fetches the live file;
opened directly it falls back to an inlined copy embedded in `index.html`.

### Refresh content from the CMS
```bash
PGURL='postgresql://…' ./build-content.sh
```
Re-queries the published rows via `build-content.sql`, rewrites `content.json`,
and re-embeds the inline snapshot in `index.html`. No credentials are stored in
the repo — the script reads `PGURL` from the environment.

## Stack
- Three.js (r160) via import map / unpkg
- hls.js for the live stream + a Web Audio graph (distance volume, stereo pan, reverb + echo)
- No build step — plain `index.html`
