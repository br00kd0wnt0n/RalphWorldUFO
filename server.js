// Static file server + a live /api/content endpoint that reads the CMS Postgres.
// Falls back gracefully: if DATABASE_URL is unset or the query fails, /api/content
// returns the committed static content.json instead, and the page still works.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const SITE = 'https://ralph-world-production.up.railway.app';
const HLS_URL = process.env.HLS_URL || 'https://relay-production-8ff1.up.railway.app/hls/stream.m3u8';
const CACHE_MS = Number(process.env.CONTENT_CACHE_MS || 60000);

// ---- optional Postgres pool (only if DATABASE_URL is provided) ----
let pool = null;
if (process.env.DATABASE_URL) {
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : false,
      max: 4,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
    });
    pool.on('error', (e) => console.warn('pg pool error:', e.message));
  } catch (e) {
    console.warn('pg not available — /api/content will serve the static snapshot:', e.message);
  }
}

const strip = (s) => String(s || '').replace(/<[^>]*>/g, '').trim().slice(0, 200);
const isImg = (u) => /\.(jpg|jpeg|png|webp)(\?|$)/i.test(u || '');

const THEATRE = {
  zone: 'tv',
  title: 'ralph one — live transmission',
  blurb: 'the always-on ralph.world broadcast. fly up, hover, and tune in.',
  url: `${SITE}/tv`,
};

// Build the same item shape as build-content.sql, live from the DB.
async function queryContent() {
  const [arts, mags, events, labs] = await Promise.all([
    pool.query(`select title, slug, subtitle, intro, card_image_url, lead_media_url, lead_media_type
                from articles where status='published' and title is not null
                order by coalesce(sort_order, 2147483647), published_at desc nulls last limit 10`),
    pool.query(`select issue_number, title from magazine_issues where status='published' order by issue_number`),
    pool.query(`select title, slug, description_short, thumbnail_url from events
                where status='published' order by event_date desc nulls last limit 6`),
    pool.query(`select title, slug, description, thumbnail_url, external_url from lab_items
                where status='published' order by coalesce(sort_order, 2147483647) limit 7`),
  ]);

  const items = [];
  arts.rows.forEach((r, i) => {
    const image = r.card_image_url
      || ((r.lead_media_type === 'image' || isImg(r.lead_media_url)) ? r.lead_media_url : null);
    items.push({
      zone: (i % 2 === 0) ? 'tv' : 'mag',   // 1-based odd → tv (i is 0-based here)
      type: 'article',
      title: r.title,
      image: image || null,
      excerpt: strip(r.subtitle || r.intro),
      url: `${SITE}/magazine/${r.slug}`,
    });
  });
  mags.rows.forEach((r) => items.push({
    zone: 'mag', type: 'magazine',
    title: r.title || `Issue ${r.issue_number}`,
    image: null,
    excerpt: `Issue ${r.issue_number} — out now from the ralph.world press.`,
    url: `${SITE}/magazine`,
  }));
  events.rows.forEach((r) => items.push({
    zone: 'events', type: 'event',
    title: r.title, image: r.thumbnail_url || null,
    excerpt: strip(r.description_short),
    url: `${SITE}/events/${r.slug}`,
  }));
  labs.rows.forEach((r) => items.push({
    zone: 'lab', type: 'lab',
    title: r.title, image: r.thumbnail_url || null,
    excerpt: strip(r.description),
    url: r.external_url || `${SITE}/lab`,
  }));
  items.push({
    zone: 'shop', type: 'shop', title: 'The ralph shop', image: null,
    excerpt: 'Print, merch and curios from the ralph.world store.', url: `${SITE}/shop`,
  });

  return { site: SITE, hlsUrl: HLS_URL, source: 'db', theatre: THEATRE, items };
}

let cache = { at: 0, body: null };
async function getContent() {
  if (!pool) throw new Error('no DATABASE_URL');
  const now = Date.now();
  if (cache.body && now - cache.at < CACHE_MS) return cache.body;
  const data = await queryContent();
  cache = { at: now, body: JSON.stringify(data) };
  return cache.body;
}

// ---- static types ----
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

// always revalidate HTML so browsers never run a stale (buggy) cached copy
const cacheFor = (ext) => (ext === '.html') ? 'no-cache, must-revalidate' : 'public, max-age=300';

function serveStatic(req, res, urlPath) {
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      return fs.readFile(path.join(ROOT, 'index.html'), (e, data) => {
        if (e) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache, must-revalidate' });
        res.end(data);
      });
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': cacheFor(ext) });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

  // live content: DB → cached JSON. On any failure, fall back to static content.json.
  if (urlPath === '/api/content') {
    try {
      const body = await getContent();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(body);
    } catch (e) {
      return fs.readFile(path.join(ROOT, 'content.json'), (err, data) => {
        if (err) { res.writeHead(503); return res.end('{"error":"content unavailable"}'); }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(data);
      });
    }
  }

  serveStatic(req, res, urlPath);
});

server.listen(PORT, () => console.log(`Ralph World UFO serving on :${PORT} (db: ${pool ? 'on' : 'off'})`));
