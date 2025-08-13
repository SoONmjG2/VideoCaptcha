// backend/server.js
const express = require('express');
const path = require('path');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const axios = require('axios');

// Render에선 .env 대신 Environment Variables 사용 (로컬만 .env 로드)
try { require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); } catch (_) {}

const app = express();

// --- CORS: 배포 도메인만 허용 ---
const allowlist = [
  'https://peachprmoise.co.kr',
  'https://www.peachprmoise.co.kr',
  'https://api.peachprmoise.co.kr', // (자기 자신 호출 허용이 필요할 때)
  process.env.CORS_ORIGIN,          // 추가 도메인 있으면 ENV로
].filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // 서버-서버 호출/헬스체크 등
    return allowlist.includes(origin) ? cb(null, true) : cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());

// --- Mongo ---
const mongoUri = process.env.MONGO_URI;
const client = new MongoClient(mongoUri);
let collection;

// --- 헬스체크(옵션) ---
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

// --- 영상 메타 (질문 포함) ---
app.get('/video-data', async (_req, res) => {
  try {
    const doc = await collection.findOne({ videoUrl: { $exists: true } });
    if (!doc?.videoUrl) return res.status(404).json({ error: 'No videoUrl' });
    res.json({ videoUrl: doc.videoUrl, question: doc.question || '영상 질문입니다.' });
  } catch (err) {
    console.error('🔥 /video-data error:', err.message);
    res.status(500).send('server error');
  }
});

// --- Firebase Storage 프록시 (시크/재생바 이동 지원: Range 전달) ---
app.get('/video', async (req, res) => {
  try {
    const doc = await collection.findOne({ videoUrl: { $exists: true } });
    const videoUrl = doc?.videoUrl;
    if (!videoUrl) return res.status(404).send('no video');

    // 클라이언트의 Range/If-Range 등 핵심 헤더 전달 (시크 가능)
    const forwardHeaders = {};
    ['range', 'if-range'].forEach(h => {
      if (req.headers[h]) forwardHeaders[h] = req.headers[h];
    });

    const upstream = await axios.get(videoUrl, {
      responseType: 'stream',
      headers: forwardHeaders,
      // Firebase의 리디렉션 대응 (필요시)
      maxRedirects: 5,
      validateStatus: () => true, // 상태코드 그대로 전달
    });

    // 원본 헤더/상태 그대로 복제
    res.status(upstream.status);
    // 대표 헤더만 복제 (안전상 전부 복제 대신 핵심 위주)
    const copyHeaders = [
      'content-type', 'content-length', 'accept-ranges', 'content-range', 'etag', 'last-modified', 'cache-control'
    ];
    copyHeaders.forEach(h => {
      const v = upstream.headers[h];
      if (v) res.setHeader(h, v);
    });
    // COEP-safe
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    upstream.data.pipe(res);
  } catch (err) {
    console.error('🔥 /video proxy error:', err.message);
    res.status(500).send('proxy error');
  }
});

// --- 정적 파일 (SeeSo 프론트: 필요 시 사용) ---
const gazePath = path.join(__dirname, '../samples/gaze');
app.use(express.static(gazePath));

// --- 기본 라우트 ---
app.get('/', (_req, res) => {
  res.sendFile(path.join(gazePath, 'index.html'));
});

// --- 서버 시작 ---
async function start() {
  try {
    await client.connect();
    console.log('✅ MongoDB connected!');
    const db = client.db('test');
    collection = db.collection('gazeData');

    const PORT = process.env.PORT || 3000; // Render는 반드시 process.env.PORT 사용
    app.listen(PORT, () => console.log(`🚀 Listening on :${PORT}`));
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  }
}

start();