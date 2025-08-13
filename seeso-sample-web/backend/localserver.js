const express = require('express');
const path = require('path');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const axios = require('axios');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const app = express();
app.use(cors());
app.use(express.json());

const mongoUri = process.env.MONGO_URI;
const client = new MongoClient(mongoUri);
let collection;

async function startServer() {
  try {
    await client.connect();
    console.log("✅ MongoDB connected!");
    const db = client.db("test");
    collection = db.collection("gazeData");

    app.get("/video-data", async (req, res) => {
      try {
        const doc = await collection.findOne({ videoUrl: { $exists: true } });
        console.log("🎯 /video-data doc:", doc); // 이거 추가!!
        
        const videoUrl = doc?.videoUrl;
        if (!videoUrl) {
          console.error("❌ videoUrl 없음");
          return res.status(400).json({ error: "Invalid videoUrl" });
        }
        res.json({ videoUrl, question: doc.question || "영상 질문입니다." });
      } catch (err) {
        console.error("🔥 /video-data 에러:", err.message);
        res.status(500).send("서버 오류");
      }
    });

    // ✅ 🔥 프록시: Firebase 영상 스트리밍 (COEP-safe)
    // ⚠️ 정적 파일보다 위에 둬야 함!
    app.get("/video", async (req, res) => {
      try {
        console.log("✅ /video 라우트 들어옴");
        const doc = await collection.findOne({ videoUrl: { $exists: true } });
        const videoUrl = doc?.videoUrl;
        console.log("🎥 프록시 영상 URL:", videoUrl);

        const response = await axios.get(videoUrl, { responseType: "stream" });
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

        response.data.pipe(res);
      } catch (err) {
        console.error("🔥 프록시 오류:", err.message);
        res.status(500).send("프록시 서버 오류");
      }
    });

    // ✅ 정적 파일 서빙 (SeeSo 프론트) → 이거보다 위에 /video 있어야 함!
    const gazePath = path.join(__dirname, '../samples/gaze');
    app.use(express.static(gazePath));

    // ✅ 기본 라우트 (index.html)
    app.get("/", (req, res) => {
      res.sendFile(path.join(gazePath, "index.html"));
    });

    app.listen(3000, () => {
      console.log("🚀 서버 실행됨: http://localhost:3000");
    });

  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
  }
}

startServer();
