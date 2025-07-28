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
    collection = db.collection("gazeData");   // ← 컬렉션명

    // // ✅ gaze data 저장
    // app.post("/save-data", async (req, res) => {
    //   try {
    //     const { gazeData } = req.body;
    //     if (!Array.isArray(gazeData)) {
    //       return res.status(400).json({ success: false, message: "gazeData must be an array" });
    //     }
    //     await collection.insertMany(gazeData.map(d => ({ type: "gaze", ...d })));
    //     res.json({ success: true });
    //   } catch (err) {
    //     console.error("❌ Insert error:", err);
    //     res.status(500).json({ success: false });
    //   }
    // });

    // ✅ 영상 정보 제공 (MongoDB에서 읽음)
    app.get("/video-data", async (req, res) => {
      try {
        const doc = await collection.findOne({ drive_url: { $exists: true } }); // 조건은 필요에 따라 수정
        if (!doc) return res.status(404).json({ error: "No video data found" });

        // Google Drive 링크에서 ID 추출
        const match = doc.drive_url.match(/\/d\/(.+?)\//);
        const fileId = match ? match[1] : null;

        if (!fileId) return res.status(400).json({ error: "Invalid drive_url" });

        const previewUrl = `https://drive.google.com/uc?id=${fileId}&export=download`;

        res.json({
          drive_url: previewUrl,
          overlay_text: doc.question || "이 영상은 시선 추적 테스트용입니다."
        });
      } catch (err) {
        console.error("❌ /video-data error:", err);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // ✅ 테스트용 API
    app.get("/test", (req, res) => res.send("✅ API is working"));

    // ✅ 서버 실행
    app.listen(3000, () => {
      console.log("🚀 Server running at http://localhost:3000");
    });
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
  }
}

startServer();
