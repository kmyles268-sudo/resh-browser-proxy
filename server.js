const express = require('express');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 3000;

const BLOCKED_HOSTS = [/^localhost$/i, /^ip6-localhost$/i, /^ip6-loopback$/i];
const BLOCKED_IP_RANGES = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2[0-9]|3[01])\./, /^192\.168\./, /^192\.0\.2\./, /^198\.51\.100\./, /^203\.0\.113\./, /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, /^::1$/, /^::$/, /^fe80:/i, /^fc/i, /^fd/i, /^ff/i];

function isBlockedHost(h) {
  return BLOCKED_HOSTS.some(r => r.test(h)) || BLOCKED_IP_RANGES.some(r => r.test(h));
}

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({ name: 'Fresh Browser Proxy API', usage: 'GET /fetch?url=https://example.com' });
});

app.get('/test', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html>
<head><title>Fresh Browser Proxy Tester</title>
<style>
*{box-sizing:border-box}
body{font-family:sans-serif;max-width:860px;margin:40px auto;padding:0 24px;color:#222}
h2{font-size:20px;margin-bottom:20px}
input{width:100%;padding:10px 12px;font-size:14px;border:1px solid #ddd;border-radius:6px}
button{padding:10px 24px;margin-top:10px;font-size:14px;background:#000;color:#fff;border:none;border-radius:6px;cursor:pointer}
button:disabled{opacity:0.5}
#status{font-size:13px;color:#666;margin:10px 0}
#meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin:14px 0}
.card{background:#f7f7f7;border:1px solid #eee;border-radius:6px;padding:10px 14px}
.label{font-size:11px;color:#999;margin-bottom:3px}
.val{font-size:13px;font-weight:600;word-break:break-all}
#out{display:none;background:#f5f5f5;border:1px solid #eee;border-radius:6px;padding:16px;font-size:12px;font-family:monospace;white-space:pre-wrap;word-break:break-word;max-height:420px;overflow-y:auto;line-height:1.6}
#err{display:none;background:#fff0f0;border:1px solid #fcc;border-radius:6px;padding:14px;color:#c00;font-size:13px}
.copy-btn{float:right;font-size:12px;padding:4px 10px;background:#fff;color:#333;border:1px solid #ddd;border-radius:4px;cursor:pointer;margin-bottom:6px}
</style>
</head>
<body>
<h2>Fresh Browser Proxy Tester</h2>
<input id="u" value="https://marlin-viola-ac3z.squarespace.com/" placeholder="Enter any URL..." />
<button id="btn" onclick="go()">Fetch</button>
<p id="status"></p>
<div id="meta"></div>
<div id="err"></div>
<div id="outWrap" style="display:none">
  <button class="copy-btn" onclick="copyIt()">Copy content</button>
  <pre id="out"></pre>
</div>
<script>
async function go() {
  const url = document.getElementById('u').value.trim();
  if (!url) return;
  const btn = document.getElementById('btn');
  const status = document.getElementById('status');
  const meta = document.getElementById('meta');
  const out = document.getElementById('out');
  const outWrap = document.getElementById('outWrap');
  const err = document.getElementById('err');

  btn.disabled = true;
  btn.textContent = 'Fetching...';
  status.textContent = 'Calling fresh browser proxy...';
  meta.innerHTML = '';
  out.textContent = '';
  outWrap.style.display = 'none';
  err.style.display = 'none';

  const t = Date.now();
  try {
    const r = await fetch('/fetch?url=' + encodeURIComponent(url));
    const d = await r.json();
    const elapsed = ((Date.now() - t) / 1000).toFixed(1);
    if (d.error) {
      err.style.display = 'block';
      err.textContent = 'Error: ' + d.error;
      status.textContent = 'Failed after ' + elapsed + 's';
    } else {
      status.textContent = 'Done in ' + elapsed + 's — fresh real-browser fetch, zero cache';
      meta.innerHTML = [
        ['Title', d.title || '—'],
        ['Status', d.statusCode],
        ['Time', elapsed + 's'],
        ['Fetched at', new Date(d.fetchedAt).toLocaleTimeString()],
        ['Final URL', d.finalUrl]
      ].map(([l,v]) => '<div class="card"><div class="label">'+l+'</div><div class="val">'+v+'</div></div>').join('');
      out.textContent = d.content;
      outWrap.style.display = 'block';
    }
  } catch(e) {
    err.style.display = 'block';
    err.textContent = 'Network error: ' + e.message;
    status.textContent = 'Error after ' + ((Date.now() - t) / 1000).toFixed(1) + 's';
  }
  btn.disabled = false;
  btn.textContent = 'Fetch';
}

function copyIt() {
  navigator.clipboard.writeText(document.getElementById('out').textContent);
}
</script>
</body>
</html>`);
});

app.get('/fetch', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter' });

  let parsedUrl;
  try { parsedUrl = new URL(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
  if (isBlockedHost(parsedUrl.hostname)) return res.status(403).json({ error: 'Blocked host' });

  let browser;
  try {
    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const context = await browser.newContext({
      bypassCSP: true,
      extraHTTPHeaders: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
    });
    const page = await context.newPage();
    await page.route('**/*', route => {
      route.continue({ headers: { ...route.request().headers(), 'cache-control': 'no-cache', 'pragma': 'no-cache' } });
    });

    const response = await Promise.race([
      page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout after 30s')), 30000))
    ]);

    const finalUrl = page.url();
    const title = await page.title();
    const statusCode = response ? response.status() : null;
    const content = await page.evaluate(() => {
      const el = document.querySelector('main') || document.querySelector('article') || document.body;
      return el ? el.innerText : '';
    });
    await browser.close();

    res.json({
      content: content.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\n{3,}/g, '\n\n').trim(),
      title, finalUrl, fetchedAt: new Date().toISOString(), statusCode, error: null
    });
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    res.status(500).json({ content: null, title: null, finalUrl: null, fetchedAt: new Date().toISOString(), statusCode: null, error: err.message });
  }
});

app.listen(PORT, () => console.log(`Fresh Browser Proxy listening on port ${PORT}`));
