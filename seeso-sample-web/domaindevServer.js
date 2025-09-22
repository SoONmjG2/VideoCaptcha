// seeso-sample-web/domaindevServer.js
const path = require('path');
const express = require('express');
const compression = require('compression');
const { createProxyMiddleware } = require('http-proxy-middleware');

const PORT = process.env.PORT || 8080;
const API_TARGET = process.env.API_TARGET || 'https://api.peachprmoise.co.kr';

const app = express();
app.set('trust proxy', 1);

// COOP/COEP 헤더
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Origin-Agent-Cluster', '?1');
  next();
});

// gzip
app.use(compression());

// 정적 루트
const DIST = path.join(__dirname, 'dist');

app.use(express.static(DIST, {
  setHeaders(res, fp) {
    if (fp.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    else res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  },
}));

// /api 프록시
app.use('/api', createProxyMiddleware({
  target: API_TARGET,
  changeOrigin: true,
  xfwd: true,
  onProxyRes(proxyRes, req, res) {
    if (!proxyRes.headers['cross-origin-resource-policy']) {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    }
  },
  onError(err, req, res) {
    console.error('🔴 /api proxy error:', err.message);
    if (!res.headersSent) res.status(502).send('API proxy error');
  },
}));

/* ---------------- 단축 라우트 ---------------- */
// 루트
app.get('/', (_req, res) =>
  res.sendFile(path.join(DIST, 'public', 'login.html'))
);

// public
app.get('/public/login.html', (_req, res) =>
  res.sendFile(path.join(DIST, 'public', 'login.html'))
);
app.get('/public/destination.html', (_req, res) =>
  res.sendFile(path.join(DIST, 'public', 'destination.html'))
);
app.get('/public/camera-error.html', (_req, res) =>
  res.sendFile(path.join(DIST, 'public', 'camera-error.html'))
);
app.get('/public/nocamera_index.html', (_req, res) =>
  res.sendFile(path.join(DIST, 'public', 'nocamera_index.html'))
);

// samples (gaze) — ✅ 중복 제거 & 정확한 경로
app.get('/gaze', (_req, res) =>
  res.sendFile(path.join(DIST, 'samples', 'gaze', 'index.html'))
);
app.get('/gaze/user', (_req, res) =>
  res.sendFile(path.join(DIST, 'samples', 'gaze', 'user_index.html'))
);
app.get('/gaze/noseeso', (_req, res) =>
  res.sendFile(path.join(DIST, 'samples', 'gaze','noseeso_index.html'))
);
// 성공 페이지 — 배포에선 /success 로 이동하게 해둔 상태와 일치
app.get('/success', (_req, res) =>
  res.sendFile(path.join(DIST, 'samples', 'gaze', 'success', 'success.html'))
);

/* -------- 편의 리디렉션(옛 경로 정리) -------- */
app.get(['/user_index.html', '/samples/gaze/user_index.html'], (_req, res) =>
  res.redirect(302, '/gaze/user')
);
app.get(['/gaze/success', '/samples/gaze/success/success.html'], (_req, res) =>
  res.redirect(302, '/success')
);

// 헬스체크
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// 404 → 로그인
app.use((req, res) => {
  res.status(404).sendFile(path.join(DIST, 'public', 'login.html'));
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`✅ Frontend server on :${PORT}`);
  console.log(`→ Proxy /api → ${API_TARGET}`);
});
