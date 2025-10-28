// backend/server.js — 배포용 (랜덤/중복방지 풀 + Range 프록시 + 스트림 안전 가드)

const express = require('express');
const path = require('path');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const axios = require('axios');

// 로컬에서는 .env 사용, Render에서는 ENV 탭 사용
// 필요 시 주석 해제
// try { require('dotenv').config({ path: path.resolve(__dirname, '../.env') }); } catch (_) {}

const PORT       = process.env.PORT || 3000;
const MONGO_URI  = process.env.MONGO_URI;
const DB_NAME    = process.env.DB_NAME || 'test';
const COLLECTION = process.env.COLLECTION || 'gazeData';

// 필수 환경변수 체크 (없으면 503 방지용 조기 종료)
if (!MONGO_URI) {
  console.error('❌ MONGO_URI is not set');
  process.exit(1);
}

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
const client = new MongoClient(MONGO_URI, { ignoreUndefined: true });
let collection;

/* ---------- 랜덤 풀 (중복 방지) ---------- */
let randomPool = []; // _id 문자열 배열
let round = 0;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function reloadPool() {
  const docs = await collection.find(
    { videoUrl: { $exists: true, $ne: null } },
    { projection: { _id: 1 } }
  ).toArray();

  randomPool = docs.map(d => String(d._id));
  shuffle(randomPool);
  round++;
  console.log(`🔁 랜덤 풀 리셋 (라운드 ${round}, 총 ${randomPool.length}개)`);
}

function toMongoId(idStr) {
  return ObjectId.isValid(idStr) ? new ObjectId(idStr) : idStr;
}

/* ---------- Healthcheck ---------- */
app.get('/healthz', (_req, res) => res.status(200).send('ok'));

/* ---------- reCAPTCHA 검증 ---------- */
app.post("/recaptcha/verify", async (req, res) => {
  const { token } = req.body;
  const secretKey = process.env.RECAPTCHA_SECRET_KEY;

  if (!token) {
    return res.status(400).json({ success: false, error: "Missing token" });
  }
  if (!secretKey) {
    return res.status(500).json({ success: false, error: "Missing secret key on server" });
  }

  try {
    const verifyRes = await axios.post(
      `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${token}`
    );
    const data = verifyRes.data;

    if (data.success) {
      res.json({ success: true, score: data.score || null, action: data.action || null });
    } else {
      res.status(400).json({ success: false, error: data["error-codes"] });
    }
  } catch (err) {
    console.error("🔥 reCAPTCHA verify error:", err.message);
    res.status(500).json({ success: false, error: "Verification failed" });
  }
});

/* ---------- API: 영상 메타 (중복 없이 랜덤) ---------- */
app.get('/video-data', async (_req, res) => {
  try {
    if (randomPool.length === 0) await reloadPool();
    if (randomPool.length === 0) {
      return res.status(404).json({ error: 'EMPTY_POOL' });
    }

    const pickId = randomPool.pop();
    const doc = await collection.findOne({ _id: toMongoId(pickId) });
    if (!doc?.videoUrl) return res.status(404).json({ error: 'NOT_FOUND' });

    res.json({
      id: String(doc._id),
      question: doc.question || '영상 질문입니다.',
      answer: Array.isArray(doc.answer) ? doc.answer : [],
      videoPath: `/video/${doc._id}`,
      round,
      remaining: randomPool.length,
    });
  } catch (err) {
    console.error('🔥 /video-data error:', err.message);
    res.status(500).send('server error');
  }
});

/* ---------- 공통: 비디오 프록시 (Range 지원 + 스트림 안전 가드) ---------- */
async function proxyVideoById(req, res, id) {
  const doc = await collection.findOne({ _id: toMongoId(id) });
  const videoUrl = doc?.videoUrl;
  if (!videoUrl) return res.status(404).send('NOT_FOUND');

  const forwardHeaders = {};
  ['range', 'if-range'].forEach((h) => {
    if (req.headers[h]) forwardHeaders[h] = req.headers[h];
  });

  const upstream = await axios.get(videoUrl, {
    responseType: 'stream',
    headers: forwardHeaders,
    maxRedirects: 5,
    validateStatus: () => true,
    timeout: 30_000,
  });

  res.status(upstream.status);
  ['content-type','content-length','accept-ranges','content-range','etag','last-modified','cache-control']
    .forEach((h) => {
      const v = upstream.headers[h];
      if (v) res.setHeader(h, v);
    });
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  const src = upstream.data;

  const abort = (err) => {
    if (err && !['EPIPE','ECONNRESET'].includes(err.code || '')) {
      console.warn('🔴 stream aborted:', err.message || err);
    }
    try { src.destroy(); } catch {}
    try {
      if (!res.headersSent) res.status(502).end('upstream error');
      else res.end();
    } catch {}
  };
  src.on('error', abort);
  res.on('close', abort);
  req.on('aborted', abort);

  src.pipe(res);
}

/* ---------- API: 영상 프록시 ---------- */
app.get('/video/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).send('id required');
    await proxyVideoById(req, res, id);
  } catch (err) {
    console.error('🔥 /video/:id proxy error:', err.message);
    if (!res.headersSent) res.status(500).send('proxy error');
  }
});

// 하위호환: /video?id=<id>
app.get('/video', async (req, res) => {
  try {
    const id = req.query.id;
    if (!id) return res.status(400).send('id query required (e.g., /video?id=...)');
    await proxyVideoById(req, res, id);
  } catch (err) {
    console.error('🔥 /video?id proxy error:', err.message);
    if (!res.headersSent) res.status(500).send('proxy error');
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
          <code>GET /healthz</code>
        </div>
        <div class="api">
          <h3>/recaptcha/verify</h3>
          <p>Google reCAPTCHA 토큰 검증</p>
          <code>POST /recaptcha/verify</code>
        </div>
        <div class="api">
          <h3>/video-data</h3>
          <p>중복 없는 랜덤으로 메타(JSON) 반환</p>
          <code>GET /video-data</code>
        </div>
        <div class="api">
          <h3>/video/:id</h3>
          <p>Firebase Storage 프록시 (Range/시크 지원)</p>
          <code>GET /video/&lt;ObjectId&gt;</code>
        </div>
      </div>
      <p style="margin-top:16px">프론트에서 <span class="kbd">&lt;video src="/video/&lt;id&gt;"&gt;</span> 형태로 쓰면 됩니다. (하위호환: <span class="kbd">/video?id=&lt;id&gt;</span>)</p>
    </div>
  </div>
</body>
</html>`;
  res.type('html').send(html);
});

/* ---------- 전역 에러 가드 ---------- */
process.on('unhandledRejection', (err) => {
  console.error('🔴 UnhandledRejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('🔴 UncaughtException:', err);
});

/* ---------- 서버 시작 ---------- */
(async () => {
  try {
    await client.connect();
    console.log('✅ MongoDB connected!');
    const db = client.db(DB_NAME);
    collection = db.collection(COLLECTION);

    await reloadPool(); // 부팅 시 1회 로딩

    const server = app.listen(PORT, '0.0.0.0', () =>
      console.log(`🚀 Listening on :${PORT}`)
    );
    server.keepAliveTimeout = 65_000;
    server.headersTimeout   = 66_000;
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  }
})();
