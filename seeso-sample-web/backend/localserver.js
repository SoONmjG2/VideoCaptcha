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

// const app = express();
// app.use(cors());
// app.use(express.json());

// const client = new MongoClient(MONGO_URI, { ignoreUndefined: true });
// let collection;

// // ===== 랜덤 풀 (중복 방지) =====
// let randomPool = [];
// let round = 0;

// // 섞기 함수
// function shuffle(arr) {
//   for (let i = arr.length - 1; i > 0; i--) {
//     const j = Math.floor(Math.random() * (i + 1));
//     [arr[i], arr[j]] = [arr[j], arr[i]];
//   }
//   return arr;
// }

// // 풀 로딩
// async function reloadPool() {
//   const docs = await collection.find(
//     { videoUrl: { $exists: true, $ne: null } },
//     { projection: { _id: 1 } }
//   ).toArray();

//   randomPool = docs.map(d => String(d._id));
//   shuffle(randomPool);
//   round++;
//   console.log(`랜덤 풀 리셋(라운드 ${round}, 총 ${randomPool.length}개)`);
// }

// // MongoId 변환
// function toMongoId(idStr) {
//   return ObjectId.isValid(idStr) ? new ObjectId(idStr) : idStr;
// }

// // ===== 라우트 =====

// // 🎯 중복 없는 랜덤 뽑기 (다 쓰면 자동 초기화)
// app.get("/video-data", async (req, res) => {
//   try {
//     // 풀 다 썼으면 새로 로딩
//     if (randomPool.length === 0) {
//       await reloadPool();
//     }

//     const pickId = randomPool.pop();
//     const doc = await collection.findOne({ _id: toMongoId(pickId) });

//     if (!doc?.videoUrl) return res.status(404).json({ error: "NOT_FOUND" });

//     res.json({
//       id: String(doc._id),
//       question: doc.question || "영상 질문입니다.",
//       answer: Array.isArray(doc.answer) ? doc.answer : [],
//       videoPath: `/video/id=${doc._id}`, ///video/:id (path param)
//       round,
//       remaining: randomPool.length
//     });
//   } catch (err) {
//     console.error("/video-data 에러:", err.message);
//     res.status(500).send("서버 오류");
//   }
// });

// // 🎥 선택된 ID로 영상 스트리밍 (path param 방식도 지원)
// app.get("/video/:id", async (req, res) => {
//   try {
//     const id = req.params.id;
//     if (!id) return res.status(400).send("id 필요");

//     const doc = await collection.findOne({ _id: toMongoId(id) });
//     const videoUrl = doc?.videoUrl;
//     if (!videoUrl) return res.status(404).send("NOT_FOUND");

//     console.log("Proxy 비디오 URL:", videoUrl);

//     const upstream = await axios.get(videoUrl, {
//       responseType: "stream",
//       headers: { Range: req.headers.range },
//       validateStatus: () => true,
//     });

//     res.status(upstream.status);
//     for (const [k, v] of Object.entries(upstream.headers)) {
//       try { res.setHeader(k, v); } catch {}
//     }
//     if (!res.getHeader("content-type")) res.setHeader("Content-Type", "video/mp4");
//     res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

//     upstream.data.pipe(res);
//   } catch (err) {
//     console.error("/video/:id 에러:", err.message);
//     res.status(500).send("프록시 서버 오류");
//   }
// });

// // 정적 파일 (프론트 index.html)
// const gazePath = path.join(__dirname, "../samples/gaze");
// app.use(express.static(gazePath));
// app.get("/", (req, res) => res.sendFile(path.join(gazePath, "index.html")));

// // 서버 시작
// (async () => {
//   try {
//     await client.connect();
//     console.log("✅ MongoDB connected!");
//     const db = client.db(DB_NAME);
//     collection = db.collection(COLLECTION);

//     await reloadPool(); // 서버 시작 시 1회 풀 로딩

//     app.listen(PORT, () => {
//       console.log(`서버 실행됨: http://localhost:${PORT}`);
//     });
//   } catch (err) {
//     console.error(" MongoDB connection error:", err);
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
if (!MONGO_URI) {
  console.error(".env에 MONGO_URI가 없습니다");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

const client = new MongoClient(MONGO_URI, { ignoreUndefined: true });
let collection;
let DEFAULT_ID = null;

// 항상 프롬프트: 실행할 때 매번 id를 물어봄 (엔터=첫 문서)
async function askIdInteractiveOnce() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const input = await new Promise((res) =>
    rl.question("Id 입력(엔터=첫 번째 ID): ", res)
  );
  rl.close();
  DEFAULT_ID = (input || "").trim() || null;
  console.log(`ID: ${DEFAULT_ID || "첫 번째 ID"}`);
}

function buildFilterFromReq(req) {
  const id = (req.params.id || req.query.id || DEFAULT_ID || "").trim();
  if (!id) return { videoUrl: { $exists: true } }; // 엔터면 첫 문서
  return ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
}

async function startServer() {
  await askIdInteractiveOnce();

  try {
    await client.connect();
    console.log("MongoDB connected");

    const dbName = process.env.DB_NAME || "test";
    const collName = process.env.COLLECTION || "gazeData";
    const db = client.db(dbName);
    collection = db.collection(collName);

    // ===== 메타 데이터 (질문/정답/URL)
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
        console.error(" /video-data 에러:", err);
        res.status(500).send("서버 오류");
      }
    });

    // ===== 비디오 프록시 (Firebase Storage → Range 전달)
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
          validateStatus: () => true, // 200/206 그대로 전달
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

    // ===== 정적 파일 (SeeSo 프론트)
    const gazePath = path.join(__dirname, "../samples/gaze");
    app.use(express.static(gazePath));
    app.get("/", (req, res) => res.sendFile(path.join(gazePath, "index.html")));

    const server = app.listen(PORT, () => {
      console.log(`서버 실행됨: http://localhost:${PORT}`);
    });

    // // 그레이스풀 종료(배포시 필요 우선은 필요 없어서 주석처리)
    // process.on("SIGINT", async () => {
    //   console.log("\n종료 중...");
    //   await client.close().catch(() => {});
    //   server.close(() => process.exit(0));
    // });
  } catch (err) {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  }
}

startServer();