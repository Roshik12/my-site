/* Vercel serverless function: GET /api/turn
   Returns ICE (STUN/TURN) servers for calls, so the Metered key never appears in your website code.
   Vercel > Project > Settings > Environment Variables:
     METERED_APP      your Metered app name, e.g. "roshik"   (from https://roshik.metered.live)
     METERED_API_KEY  your Metered API key (secret)
     ALLOWED_HOSTS    optional, comma list. Default: roshik.com.np,www.roshik.com.np  (*.vercel.app previews are also allowed)
   Without the env vars the function returns STUN only, so calls still work on friendly networks. */
const FALLBACK = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
const hits = new Map();               // best-effort per-IP rate limit (resets when the function instance recycles)
let cache = { at: 0, servers: null };

function allowed(req) {
  const hosts = (process.env.ALLOWED_HOSTS || 'roshik.com.np,www.roshik.com.np').split(',').map(s => s.trim()).filter(Boolean);
  const ok = h => !!h && (hosts.includes(h) || /\.vercel\.app$/.test(h));
  if (req.headers['sec-fetch-site'] === 'same-origin') return true;
  for (const k of ['origin', 'referer']) {
    try { if (req.headers[k] && ok(new URL(req.headers[k]).hostname)) return true; } catch (_) {}
  }
  return false;
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') { res.statusCode = 405; return res.end('{"error":"method"}'); }
  if (!allowed(req)) { res.statusCode = 403; return res.end('{"error":"forbidden"}'); }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown', now = Date.now();
  const h = (hits.get(ip) || []).filter(t => now - t < 60000); h.push(now); hits.set(ip, h);
  if (hits.size > 5000) hits.clear();
  if (h.length > 30) { res.statusCode = 429; return res.end('{"error":"slow down"}'); }

  const app = process.env.METERED_APP, key = process.env.METERED_API_KEY;
  if (!app || !key) return res.end(JSON.stringify({ iceServers: FALLBACK, turn: false }));
  if (cache.servers && now - cache.at < 10 * 60000) return res.end(JSON.stringify({ iceServers: cache.servers, turn: true }));
  try {
    const r = await fetch(`https://${encodeURIComponent(app)}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`);
    if (!r.ok) throw new Error('metered ' + r.status);
    const list = await r.json();
    if (!Array.isArray(list) || !list.length) throw new Error('empty');
    cache = { at: now, servers: list };
    return res.end(JSON.stringify({ iceServers: list, turn: true }));
  } catch (e) {
    return res.end(JSON.stringify({ iceServers: FALLBACK, turn: false }));
  }
};
