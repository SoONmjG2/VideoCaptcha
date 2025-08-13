// backend/server.js
const express = require('express');
const path = require('path');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const axios = require('axios');

// 로컬에서는 .env 사용, Render에서는 ENV 탭 사용
try { require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); } catch (_) {}

const app = express();

/* ---------- CORS ---------- */
const allowlist = [
  'https://peachprmoise.co.kr',
  'https://www.peachprmoise.co.kr',
  'https://api.peachprmoise.co.kr',
  process.env.CORS_ORIGIN, // 필요 시 추가
].filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // 서버-서버 호출/헬스체크 허용
    return allowlist.includes(origin) ? cb(null, true) : cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());

/* ---------- Mongo ---------- */
const mongoUri = process.env.MONGO_URI;
const client = new MongoClient(mongoUri);
let collection;

/* ---------- Healthcheck ---------- */
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

/* ---------- API: 영상 메타 ---------- */
app.get('/video-data', async (_req, res) => {
  try {
    const doc = await collection.findOne({ videoUrl: { $exists: true } });
    if (!doc?.videoUrl) return res.status(404).json({ error: 'No videoUrl' });
    res.json({
      videoUrl: doc.videoUrl,
      question: doc.question || '영상 질문입니다.',
    });
  } catch (err) {
    console.error('🔥 /video-data error:', err.message);
    res.status(500).send('server error');
  }
});

/* ---------- API: 영상 프록시 (Range 지원) ---------- */
app.get('/video', async (req, res) => {
  try {
    const doc = await collection.findOne({ videoUrl: { $exists: true } });
    const videoUrl = doc?.videoUrl;
    if (!videoUrl) return res.status(404).send('no video');

    // 시크/재생바 이동을 위한 핵심 헤더 전달
    const forwardHeaders = {};
    ['range', 'if-range'].forEach((h) => {
      if (req.headers[h]) forwardHeaders[h] = req.headers[h];
    });

    const upstream = await axios.get(videoUrl, {
      responseType: 'stream',
      headers: forwardHeaders,
      maxRedirects: 5,
      validateStatus: () => true, // 원본 상태코드 그대로
    });

    res.status(upstream.status);
    // 필요한 헤더만 복제
    ['content-type','content-length','accept-ranges','content-range','etag','last-modified','cache-control']
      .forEach((h) => {
        const v = upstream.headers[h];
        if (v) res.setHeader(h, v);
      });
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    upstream.data.pipe(res);
  } catch (err) {
    console.error('🔥 /video proxy error:', err.message);
    res.status(500).send('proxy error');
  }
});

/* ---------- 루트: API 안내 페이지 ---------- */
app.get('/', (_req, res) => {
  const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>VideoCaptcha API</title>
  <style>
    :root { --bg:#0b1220; --card:#0f172a; --text:#e5e7eb; --muted:#94a3b8; --accent:#22c55e; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--text); font-family:ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans; }
    .wrap { max-width:880px; margin:40px auto; padding:24px; }
    .card { background:var(--card); border:1px solid #1f2937; border-radius:16px; padding:24px; box-shadow:0 10px 30px rgba(0,0,0,.25); }
    h1 { margin:0 0 12px; font-size:28px; }
    p { margin:8px 0 16px; color:var(--muted); }
    code { background:#111827; padding:2px 6px; border-radius:6px; }
    ul { margin:8px 0 0 20px; line-height:1.8; }
    a { color:var(--accent); text-decoration:none; }
    .grid { display:grid; grid-template-columns:1fr; gap:16px; margin-top:16px; }
    .api { background:#0b1220; border:1px solid #1f2937; border-radius:12px; padding:16px; }
    .kbd { display:inline-block; padding:2px 8px; border:1px solid #334155; border-radius:6px; background:#0b1220; color:var(--text); }
    @media (min-width:720px) { .grid { grid-template-columns: 1fr 1fr; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>VideoCaptcha API 서버</h1>
      <p>배포가 정상입니다. 아래 엔드포인트로 동작을 확인하세요.</p>
      <div class="grid">
        <div class="api">
          <h3>/healthz</h3>
          <p>서버 상태 체크</p>
          <code>GET https://api.peachprmoise.co.kr/healthz</code>
        </div>
        <div class="api">
          <h3>/video-data</h3>
          <p>영상 메타(JSON) 반환</p>
          <code>GET https://api.peachprmoise.co.kr/video-data</code>
        </div>
        <div class="api">
          <h3>/video</h3>
          <p>Firebase Storage 프록시 (시크/재생바 이동 가능)</p>
          <code>GET https://api.peachprmoise.co.kr/video</code>
        </div>
      </div>
      <p style="margin-top:16px">프론트(별도 도메인)에서 <span class="kbd">&lt;video src="/video"&gt;</span>를 쓰려면 CORS allowlist에 도메인을 추가하세요.</p>
    </div>
  </div>
</body>
</html>`;
  res.type('html').send(html);
});

/* ---------- 서버 시작 ---------- */
async function start() {
  try {
    await client.connect();
    console.log('✅ MongoDB connected!');
    const db = client.db('test');
    collection = db.collection('gazeData');

    const PORT = process.env.PORT || 3000; // Render는 PORT 필요
    app.listen(PORT, () => console.log(`🚀 Listening on :${PORT}`));
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  }
}
start();
