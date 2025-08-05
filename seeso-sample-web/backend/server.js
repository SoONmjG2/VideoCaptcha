// backend/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const app = express();
app.use(cors());
app.use(express.json());

// 환경변수에서 MongoDB URI 가져오기
const mongoUri = process.env.MONGO_URI;
console.log("✅ MONGO_URI:", mongoUri);

const client = new MongoClient(mongoUri);
let collection;

async function startServer() {
  try {
    await client.connect();
    console.log("✅ MongoDB connected!");

    const db = client.db("test"); // ← DB명
    collection = db.collection("gazeData"); // ← 컬렉션명

    // ✅ 영상 정보 제공 API
    app.get("/video-data", async (req, res) => {
      try {
        const doc = await collection.findOne({ videoUrl: { $exists: true } });
        console.log("✅ 찾은 문서:", doc);

        const videoUrl = doc?.videoUrl;

        console.log("💬 typeof videoUrl:", typeof videoUrl);
        console.log("💬 videoUrl 내용:", videoUrl);

        if (!videoUrl || typeof videoUrl !== 'string') {
          console.error("❌ videoUrl이 존재하지 않거나 문자열이 아님:", videoUrl);
          return res.status(400).json({ error: "Invalid videoUrl" });
        }

        // Google Drive ID 추출
        const match = videoUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
        const fileId = match ? match[1] : null;

        if (!fileId) {
          console.error("❌ Google Drive ID 추출 실패:", videoUrl);
          return res.status(400).json({ error: "Invalid Google Drive URL format" });
        }

        const previewUrl = `https://drive.google.com/uc?id=${fileId}&export=download`;

        res.json({
          videoUrl: previewUrl,
          question: doc.question || "이 영상은 시선 추적 테스트용입니다."
        });
      } catch (err) {
        console.error("❌ /video-data error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // ✅ 서버 시작
    app.listen(3000, () => {
      console.log("🚀 Server running at http://localhost:3000");
    });
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
  }
}

startServer();
