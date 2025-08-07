const Bundler = require('parcel-bundler');
const express = require('express');
const http = require('http');
const { createProxyMiddleware } = require('http-proxy-middleware'); // ✅ 추가
const open = require('open');

const app = express();
const bundlePath = 'public/login.html'; // 기본값 고정
const port = process.argv[3] || 8082;

// 📌 COEP, COOP 헤더
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
});

// ✅ ✅ ✅ 프록시 설정: /api 요청은 백엔드 3000으로
app.use('/api', createProxyMiddleware({
  target: 'http://localhost:3000',
  changeOrigin: true,
}));

// 📦 Parcel 번들링
const bundler = new Bundler(bundlePath);
app.use(bundler.middleware());

// 📁 정적 파일 제공
app.use('/data', express.static(__dirname + '/data'));

// 🧠 서버 시작
const server = http.createServer(app);
server.listen(port);

server.on('error', (err) => console.error(err));
server.on('listening', () => {
  console.info('Server is running');
  console.info(`  NODE_ENV=[${process.env.NODE_ENV}]`);
  console.info(`  Port=[${port}]`);
  open(`http://localhost:${port}`);
});
