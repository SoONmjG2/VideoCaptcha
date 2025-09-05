//devServer.js
const path = require('path');
const http = require('http');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const Bundler = require('parcel-bundler');
const open = require('open');

const app = express();

const PORT = Number(process.argv[3]) || 8082;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SAMPLES_DIR = path.join(__dirname, 'samples');
const CSS_DIR = path.join(__dirname, 'css');

const ENTRY_HTML = [
  // public
  path.join(PUBLIC_DIR, 'login.html'),
  path.join(PUBLIC_DIR, 'destination.html'),
  path.join(PUBLIC_DIR, 'camera-error.html'),
  path.join(PUBLIC_DIR, 'alt-login.html'),

  // samples (gaze)
  path.join(SAMPLES_DIR, 'gaze', 'index.html'),
  path.join(SAMPLES_DIR, 'gaze', 'user_index.html'),   
  path.join(SAMPLES_DIR, 'gaze', 'success', 'success.html'),
];

// COOP/COEP (SharedArrayBuffer)
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});

// API 프록시(/api → 3000)
app.use('/api', createProxyMiddleware({
  target: 'http://localhost:3000',
  changeOrigin: true,
}));


const bundler = new Bundler(ENTRY_HTML, {
  hmr: true,
  hmrPort: PORT + 1,
  hmrHostname: 'localhost',
});
app.use(bundler.middleware());

/**
 * 정적 서빙
 */
app.use('/css', express.static(CSS_DIR, {
  setHeaders: (res, fp) => {
    if (fp.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
  },
}));

app.use(express.static(PUBLIC_DIR, {
  setHeaders: (res, fp) => {
    if (fp.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
  },
}));

app.use('/public', express.static(PUBLIC_DIR, {
  setHeaders: (res, fp) => {
    if (fp.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
  },
}));

app.use('/samples', express.static(SAMPLES_DIR, {
  setHeaders: (res, fp) => {
    if (fp.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
  },
}));

app.use('/success', express.static(path.join(SAMPLES_DIR, 'gaze', 'success'), {
  setHeaders: (res, fp) => {
    if (fp.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
  },
}));

// 라우팅
app.get('/', (_req, res) => res.redirect('/public/login.html'));

// 서버 시작
const server = http.createServer(app);
server.listen(PORT);
server.on('listening', async () => {
  console.info('Server is running');
  console.info(`  NODE_ENV=[${process.env.NODE_ENV}]`);
  console.info(`  PORT=[${PORT}]`);
  try { await open(`http://localhost:${PORT}`); } catch {}
});
process.on('SIGINT', () => server.close(() => process.exit(0)));  