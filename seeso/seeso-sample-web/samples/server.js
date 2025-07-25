const express = require("express");
const { MongoClient } = require("mongodb");
const cors = require("cors");

const app = express();
app.use(cors());

const PORT = 3000;
const uri = "mongodb://localhost:27017";
const dbName = "videocaptcha";

let collection;

MongoClient.connect(uri)
  .then(client => {
    const db = client.db(dbName);
    collection = db.collection("test"); // ✅ 실제 컬렉션 이름으로 설정
    console.log("✅ MongoDB 연결 완료");
  })
  .catch(err => console.error("❌ 연결 실패:", err));

app.get("/video-data", async (req, res) => {
  try {
    const videoDoc = await collection.findOne({ drive_url: { $exists: true } });
    if (!videoDoc) return res.status(404).json({ error: "데이터 없음" });

    res.json({
      drive_url: videoDoc.drive_url,
      overlay_text: videoDoc.question || "기본 텍스트"
    });
  } catch (err) {
    res.status(500).json({ error: "서버 오류" });
  }
});