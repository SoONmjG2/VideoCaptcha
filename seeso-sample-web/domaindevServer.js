// seeso-sample-web/domaindevServer.js  (항상 COEP/COOP ON)
const path = require('path');
const express = require('express');
const compression = require('compression');
const { createProxyMiddleware } = require('http-proxy-middleware');

const PORT = process.env.PORT || 8080;
// 배포/로컬 백엔드 주소: 필요에 따라 API_TARGET만 바꿔서 실행
const API_TARGET = process.env.API_TARGET || 'https://api.peachprmoise.co.kr';

const app = express();

/** Always-on: SharedArrayBuffer용 보안 헤더 */
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});

// gzip
app.use(compression());

// 정적 파일 (빌드 산출물 루트)
const DIST = path.join(__dirname, 'dist');
app.use(express.static(DIST, {
  setHeaders(res, fp) {
    if (fp.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    else res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    // 정적 자원에도 CORP 헤더가 필요할 수 있어 동일 적용
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  },
}));

// /api → 백엔드 프록시 (같은 오리진처럼 보여 CORS 불필요)
app.use('/api', createProxyMiddleware({
  target: API_TARGET,
  changeOrigin: true,
  xfwd: true,
}));

// 엔트리 라우팅
app.get('/', (_req, res) => {
  res.sendFile(path.join(DIST, 'public', 'login.html'));
});
app.get('/destination', (_req, res) => {
  res.sendFile(path.join(DIST, 'public', 'destination.html'));
});
app.get('/gaze', (_req, res) => {
  res.sendFile(path.join(DIST, 'samples', 'gaze', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Frontend server on :${PORT}`);
  console.log(`→ Proxy /api → ${API_TARGET}`);
});
