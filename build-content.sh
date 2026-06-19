#!/usr/bin/env bash
# Refresh CMS content from the live DB.
#   1. queries published rows via build-content.sql
#   2. writes content.json (used when the page is served over http)
#   3. re-embeds the same data inline in index.html (used when opened via file://)
#
# Usage:  PGURL='postgresql://…' ./build-content.sh
set -euo pipefail
cd "$(dirname "$0")"

: "${PGURL:?Set PGURL to the database connection string}"

HLS_URL="${HLS_URL:-https://relay-production-8ff1.up.railway.app/hls/stream.m3u8}"

psql "$PGURL" -tA -f build-content.sql > items.raw.json

HLS_URL="$HLS_URL" node - <<'NODE'
const fs = require('fs');
const items = JSON.parse(fs.readFileSync('items.raw.json', 'utf8'));
const data = {
  _note: 'Generated from the live CMS via build-content.sh. Re-run that to refresh.',
  site: 'https://ralph-world-production.up.railway.app',
  hlsUrl: process.env.HLS_URL,
  theatre: {
    zone: 'tv',
    title: 'ralph one — live transmission',
    blurb: 'the always-on ralph.world broadcast. fly up, hover, and tune in.',
    url: 'https://ralph-world-production.up.railway.app/tv',
  },
  items,
};
const json = JSON.stringify(data, null, 2);
fs.writeFileSync('content.json', json);

// embed inline so the page also works opened directly (file://). Escape "<"
// so a stray "</script>" can never terminate the block early.
const safe = json.replace(/</g, '\\u003c');
const block = `<!-- CONTENT:START --><script type="application/json" id="ralph-content">\n${safe}\n</script><!-- CONTENT:END -->`;

let html = fs.readFileSync('index.html', 'utf8');
if (/<!-- CONTENT:START -->[\s\S]*?<!-- CONTENT:END -->/.test(html)) {
  html = html.replace(/<!-- CONTENT:START -->[\s\S]*?<!-- CONTENT:END -->/, block);
} else {
  html = html.replace(/<script type="importmap">/, `${block}\n\n<script type="importmap">`);
}
fs.writeFileSync('index.html', html);

const z = {}; items.forEach(i => z[i.zone] = (z[i.zone] || 0) + 1);
console.log('refreshed:', items.length, 'items', JSON.stringify(z), '| withImage:', items.filter(i => i.image).length);
console.log('→ content.json written, inline block synced in index.html');
NODE

rm -f items.raw.json
