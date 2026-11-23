/* Vercel serverless function: GET /api/ip
   Returns the visitor's IP as the server sees it, so devices on the same Wi-Fi get the same key.
   IPv6 is cut to its /64 network prefix (devices on one Wi-Fi share it). No env vars needed. */
function expandV6(ip) {
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const fill = ip.includes('::') ? Array(Math.max(0, 8 - h.length - t.length)).fill('0') : [];
  return [...h, ...fill, ...t].map(g => (g || '0').toLowerCase());
}

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  let ip = String(req.headers['x-real-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '').trim();
  const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i); // IPv4 wrapped in IPv6
  if (m) ip = m[1];
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return res.status(200).json({ ip, key: ip.replace(/\./g, '_') });
  if (/^[0-9a-f:]+$/i.test(ip) && ip.includes(':')) {
    const prefix = expandV6(ip).slice(0, 4);
    if (prefix.length === 4) return res.status(200).json({ ip: prefix.join(':') + '::/64', key: 'v6-' + prefix.join('-') });
  }
  res.status(200).json({ ip: null, key: null });
};
