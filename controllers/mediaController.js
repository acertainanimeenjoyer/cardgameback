// controllers/mediaController.js
const http = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULT_LIMITS = {
  smallImage: { types: ['image/jpeg','image/png'], maxKB: 90 },
  cardImage:  { types: ['image/jpeg','image/png'], maxKB: 160 },
  bgImage:    { types: ['image/jpeg','image/png'], maxKB: 400 },
  effectAudio:{ types: ['audio/mpeg'], maxKB: 200 },
  roomAudio:  { types: ['audio/mpeg'], maxKB: 3500 },
  video:      { types: ['video/mp4','video/webm','video/ogg'], maxKB: 50 * 1024 }, // 50MB
};

const ALLOWLIST = (process.env.MEDIA_HOST_ALLOWLIST || '')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean); // e.g. "cdn.yourgame.com,images.example.com"

function hostAllowed(u) {
  if (ALLOWLIST.length === 0) return true; // no allowlist == allow all
  return ALLOWLIST.includes(u.hostname.toLowerCase());
}

function head(urlStr) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch { return reject(new Error('Invalid URL')); }
    const lib = u.protocol === 'https:' ? https : http;
    if (!hostAllowed(u)) return reject(new Error('Host not allowed'));
    const req = lib.request({ method: 'HEAD', hostname: u.hostname, path: u.pathname + u.search, port: u.port }, (res) => {
      const ct = (res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const cl = Number(res.headers['content-length'] || '0');
      resolve({ status: res.statusCode || 0, contentType: ct, contentLength: cl });
    });
    req.on('error', reject);
    req.end();
  });
}

// POST /api/media/validate  (route will be added later)
exports.validate = async (req, res) => {
  try {
    const { url, profile = 'smallImage' } = req.body || {};
    if (!url) return res.status(400).json({ message: 'Missing url' });
    const limits = DEFAULT_LIMITS[profile] || DEFAULT_LIMITS.smallImage;

    const { status, contentType, contentLength } = await head(url);
    if (status < 200 || status >= 400) return res.status(status || 400).json({ message: `Upstream responded ${status}` });

    if (!limits.types.includes(contentType)) {
      return res.status(415).json({ message: `Unsupported media type: ${contentType}` });
    }
    const sizeKB = Math.round((contentLength || 0) / 1024);
    if (contentLength && limits.maxKB && sizeKB > limits.maxKB) {
      return res.status(413).json({ message: `Media too large (> ${limits.maxKB}KB)`, sizeKB });
    }
    return res.json({ ok: true, mime: contentType, sizeKB });
  } catch (e) {
    return res.status(500).json({ message: 'Validation failed', error: String(e.message || e) });
  }
};
