const express = require('express');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 3000;

// SSRF protection - block private/internal IPs
const BLOCKED_HOSTS = [
  /^localhost$/i,
  /^ip6-localhost$/i,
  /^ip6-loopback$/i,
];

const BLOCKED_IP_RANGES = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^192\.0\.2\./,
  /^198\.51\.100\./,
  /^203\.0\.113\./,
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./,
  /^::1$/,
  /^::$/,
  /^fe80:/i,
  /^fc/i,
  /^fd/i,
  /^ff/i,
];

function isBlockedHost(hostname) {
  if (BLOCKED_HOSTS.some(r => r.test(hostname))) return true;
  if (BLOCKED_IP_RANGES.some(r => r.test(hostname))) return true;
  return false;
}

// CORS headers
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API help
app.get('/', (req, res) => {
  res.json({
    name: 'Fresh Browser Proxy API',
    usage: 'GET /fetch?url=https://example.com',
    endpoints: { health: '/health', fetch: '/fetch?url=<URL>' }
  });
});

// Main fetch endpoint
app.get('/fetch', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (isBlockedHost(parsedUrl.hostname)) {
    return res.status(403).json({ error: 'Blocked host' });
  }

  let browser;
  try {
    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const context = await browser.newContext({
      bypassCSP: true,
      extraHTTPHeaders: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });

    const page = await context.newPage();

    // Inject cache-busting on every request
    await page.route('**/*', route => {
      const headers = { ...route.request().headers(), 'cache-control': 'no-cache', 'pragma': 'no-cache' };
      route.continue({ headers });
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out after 30s')), 30000)
    );

    const fetchPromise = page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    const response = await Promise.race([fetchPromise, timeoutPromise]);

    const finalUrl = page.url();
    const title = await page.title();
    const statusCode = response ? response.status() : null;

    const content = await page.evaluate(() => {
      const el = document.querySelector('main') || document.querySelector('article') || document.body;
      return el ? el.innerText : '';
    });

    const cleanText = content
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    await browser.close();

    res.json({
      content: cleanText,
      title,
      finalUrl,
      fetchedAt: new Date().toISOString(),
      statusCode,
      error: null
    });

  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    res.status(500).json({
      content: null,
