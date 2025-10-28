// backend/localserver.js - 이 파일은 로컬 서버용 

// 1.랜덤으로 영상 뽑기 단, 한번 뽑힌 영상은 새로고침을 하면 안뽑히게 
// 새로고침 = 무조건 새로운 영상
// 랜덤 모두 사용시 다시 초기화해서 새로운 랜덤 시작
// const express = require("express");
// const path = require("path");
// const cors = require("cors");
// const { MongoClient, ObjectId } = require("mongodb");
// const axios = require("axios");
// require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

// const PORT = process.env.PORT || 3000;
// const MONGO_URI = process.env.MONGO_URI;
// const DB_NAME = process.env.DB_NAME || "test";
// const COLLECTION = process.env.COLLECTION || "gazeData";
// const RECAPTCHA_SECRET_KEY =
//   process.env.RECAPTCHA_SECRET_KEY ||
//   "6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe"; // ✅ Google 테스트키

// if (!MONGO_URI) {
//   console.error(".env에 MONGO_URI가 없습니다 ❌");
//   process.exit(1);
// }

// const app = express();
// app.use(cors({ origin: "http://localhost:8082" }));
// app.use(express.json());

// // 💡 브라우저 보안 정책 완화
// app.use((req, res, next) => {
//   res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
//   res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
//   res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
//   next();
// });

// const client = new MongoClient(MONGO_URI, { ignoreUndefined: true });
// let collection;

// // ✅ reCAPTCHA 검증 (최신 방식)
// app.post("/api/recaptcha/verify", async (req, res) => {
//   const { token } = req.body;
//   const secret = RECAPTCHA_SECRET_KEY;

//   if (!token) {
//     return res.status(400).json({ success: false, message: "토큰이 없습니다." });
//   }

//   try {
//     const params = new URLSearchParams();
//     params.append("secret", secret);
//     params.append("response", token);

//     const googleRes = await axios.post(
//       "https://www.google.com/recaptcha/api/siteverify",
//       params,
//       { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
//     );

//     const data = googleRes.data;
//     if (data.success && data.score >= 0.5) {
//       console.log(`✅ reCAPTCHA 검증 성공 (score=${data.score})`);
//       res.json({ success: true, score: data.score });
//     } else {
//       console.warn(`❌ reCAPTCHA 실패 (score=${data.score})`);
//       res.json({ success: false, score: data.score });
//     }
//   } catch (err) {
//     console.error("🔥 reCAPTCHA 오류:", err.message);
//     res.status(500).json({ success: false, error: "서버 검증 오류" });
//   }
// });

// // 🎲 랜덤 영상 풀 (중복 방지)
// let randomPool = [];
// let round = 0;

// function shuffle(arr) {
//   for (let i = arr.length - 1; i > 0; i--) {
//     const j = Math.floor(Math.random() * (i + 1));
//     [arr[i], arr[j]] = [arr[j], arr[i]];
//   }
//   return arr;
// }

// async function reloadPool() {
//   const docs = await collection
//     .find({ videoUrl: { $exists: true, $ne: null } }, { projection: { _id: 1 } })
//     .toArray();
//   randomPool = shuffle(docs.map((d) => String(d._id)));
//   round++;
//   console.log(`🎲 랜덤 풀 리셋 (라운드 ${round}, 총 ${randomPool.length}개)`);
// }

// function toMongoId(idStr) {
//   return ObjectId.isValid(idStr) ? new ObjectId(idStr) : idStr;
// }

// // 🎬 랜덤 영상 반환 (한 개만)
// app.get("/video-data", async (req, res) => {
//   try {
//     if (randomPool.length === 0) await reloadPool();

//     const pickId = randomPool.pop();
//     const doc = await collection.findOne({ _id: toMongoId(pickId) });

//     if (!doc?.videoUrl) return res.status(404).json({ error: "NOT_FOUND" });

//     res.json({
//       id: String(doc._id),
//       question: doc.question || "영상 질문입니다.",
//       answer: Array.isArray(doc.answer) ? doc.answer : [],
//       videoPath: `/video/id=${doc._id}`,
//       round,
//       remaining: randomPool.length,
//     });
//   } catch (err) {
//     console.error("/video-data 에러:", err.message);
//     res.status(500).send("서버 오류");
//   }
// });

// // 🎥 영상 스트리밍 (path param 및 query param 둘 다 지원)
// app.get("/video/:id", async (req, res) => {
//   try {
//     // ✅ ① 기존 path param
//     let id = req.params.id;

//     // ✅ ② 프론트가 id=xxx 형식으로 넘기는 경우
//     if (id.startsWith("id=")) id = id.slice(3);

//     const doc = await collection.findOne({ _id: toMongoId(id) });
//     const videoUrl = doc?.videoUrl;
//     if (!videoUrl) return res.status(404).send("NOT_FOUND");

//     console.log("🎬 Proxy 비디오 URL:", videoUrl);

//     const upstream = await axios.get(videoUrl, {
//       responseType: "stream",
//       headers: { Range: req.headers.range },
//       validateStatus: () => true,
//     });

//     res.status(upstream.status);
//     for (const [k, v] of Object.entries(upstream.headers)) {
//       try {
//         res.setHeader(k, v);
//       } catch {}
//     }
//     if (!res.getHeader("content-type"))
//       res.setHeader("Content-Type", "video/mp4");
//     res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

//     upstream.data.pipe(res);
//   } catch (err) {
//     console.error("/video/:id 에러:", err.message);
//     res.status(500).send("프록시 서버 오류");
//   }
// });

// // 📁 정적 파일
// const gazePath = path.join(__dirname, "../samples/gaze");
// app.use(express.static(gazePath));
// app.get("/", (req, res) => res.sendFile(path.join(gazePath, "index.html")));

// // 🚀 서버 시작
// (async () => {
//   try {
//     await client.connect();
//     console.log("✅ MongoDB connected!");
//     const db = client.db(DB_NAME);
//     collection = db.collection(COLLECTION);

//     await reloadPool();

//     app.listen(PORT, () => {
//       console.log(`✅ 백엔드 실행됨: http://localhost:${PORT}`);
//       console.log(
//         `→ reCAPTCHA 검증: http://localhost:${PORT}/api/recaptcha/verify`
//       );
//     });
//   } catch (err) {
//     console.error("MongoDB connection error:", err);
//     process.exit(1);
//   }
// })();


/////////////////////////////////////////////////////////////////////////////////////////////


// 2. 사용할 MongoDB object id 입력 (엔터=첫 문서):"ID 입력해서 원하는 영상 보이게 
const express = require("express");
const path = require("path");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const axios = require("axios");
const readline = require("readline");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const PORT = Number(process.env.PORT || 3000);
const MONGO_URI = process.env.MONGO_URI;
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY || "6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe"; // ✅ 테스트용 secret key

if (!MONGO_URI) {
  console.error(".env에 MONGO_URI가 없습니다");
  process.exit(1);
}
if (!RECAPTCHA_SECRET_KEY) {
  console.error(".env에 RECAPTCHA_SECRET_KEY가 없습니다");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

const client = new MongoClient(MONGO_URI, { ignoreUndefined: true });
let collection;
let DEFAULT_ID = null;

// ===== ✅ reCAPTCHA 검증 엔드포인트 =====
app.post("/api/recaptcha/verify", async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ success: false, error: "No token provided" });
  }

  try {
    // ✅ 반드시 x-www-form-urlencoded 형식으로 전송해야 함
    const params = new URLSearchParams();
    params.append("secret", RECAPTCHA_SECRET_KEY);
    params.append("response", token);

    const googleRes = await axios.post(
      "https://www.google.com/recaptcha/api/siteverify",
      params, // ✅ JSON 아님 — form data임
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const data = googleRes.data;
    console.log("🟢 Google 응답:", data);

    if (data.success) {
      console.log(`✅ reCAPTCHA verified | score=${data.score}`);
      return res.json({ success: true, score: data.score });
    } else {
      console.warn("❌ reCAPTCHA failed:", data["error-codes"]);
      return res.status(400).json({ success: false, score: 0, error: data["error-codes"] });
    }
  } catch (err) {
    console.error("🔥 reCAPTCHA 검증 오류:", err.response?.data || err.message);
    return res.status(500).json({ success: false, error: "Verification error" });
  }
});


// ===== MongoDB ID 입력 =====
async function askIdInteractiveOnce() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const input = await new Promise((res) =>
    rl.question("Id 입력(엔터=첫 번째 ID): ", res)
  );
  rl.close();
  DEFAULT_ID = (input || "").trim() || null;
  console.log(`ID: ${DEFAULT_ID || "첫 번째 ID"}`);
}

// ===== 필터 빌더 =====
function buildFilterFromReq(req) {
  const id = (req.params.id || req.query.id || DEFAULT_ID || "").trim();
  if (!id) return { videoUrl: { $exists: true } };
  return ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
}

// ===== 서버 시작 =====
async function startServer() {
  await askIdInteractiveOnce();

  try {
    await client.connect();
    console.log("✅ MongoDB connected");

    const dbName = process.env.DB_NAME || "test";
    const collName = process.env.COLLECTION || "gazeData";
    const db = client.db(dbName);
    collection = db.collection(collName);

    // ===== 비디오 메타데이터 =====
    app.get(["/video-data", "/video-data/:id"], async (req, res) => {
      try {
        const filter = buildFilterFromReq(req);
        const doc = await collection.findOne(filter);
        if (!doc?.videoUrl) return res.status(404).json({ error: "NOT_FOUND" });

        res.json({
          id: String(doc._id),
          videoUrl: doc.videoUrl,
          question: doc.question || "영상 질문입니다.",
          answer: Array.isArray(doc.answer) ? doc.answer : [],
        });
      } catch (err) {
        console.error("/video-data 에러:", err);
        res.status(500).send("서버 오류");
      }
    });

    // ===== 비디오 프록시 =====
    app.get(["/video", "/video/:id"], async (req, res) => {
      try {
        const filter = buildFilterFromReq(req);
        const doc = await collection.findOne(filter);
        const videoUrl = doc?.videoUrl;
        if (!videoUrl) return res.status(404).send("NOT_FOUND");

        console.log("Proxy 비디오 Url:", videoUrl);
        const upstream = await axios.get(videoUrl, {
          responseType: "stream",
          headers: { Range: req.headers.range },
          validateStatus: () => true,
        });

        res.status(upstream.status);
        for (const [k, v] of Object.entries(upstream.headers)) {
          try { res.setHeader(k, v); } catch {}
        }
        if (!res.getHeader("content-type")) res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

        upstream.data.pipe(res);
      } catch (err) {
        console.error("프록시 오류:", err.message);
        res.status(500).send("프록시 서버 오류");
      }
    });

    // ===== 정적 파일 서빙 (SeeSo 프론트)
    const gazePath = path.join(__dirname, "../samples/gaze");
    app.use(express.static(gazePath));
    app.get("/", (req, res) => res.sendFile(path.join(gazePath, "index.html")));

    app.listen(PORT, () => {
      console.log(`✅ 서버 실행됨: http://localhost:${PORT}`);
      console.log(`→ reCAPTCHA 검증 엔드포인트: http://localhost:${PORT}/api/recaptcha/verify`);
    });
  } catch (err) {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  }
}

startServer();
