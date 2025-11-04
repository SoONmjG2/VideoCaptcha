// ===== Canvas =====
const canvas = document.getElementById("testCanvas");
const ctx = canvas.getContext("2d");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const startBtn = document.getElementById("startBtn");
const startContainer = document.getElementById("startContainer");
const successModal = document.getElementById("successModal");
const failModal = document.getElementById("failModal");
const retryBtn = document.getElementById("retryBtn");

const progressContainer = document.getElementById("progressContainer");
const successBar = document.getElementById("successBar");
const barText = document.getElementById("barText");

// ===== 상태 =====
let success = false;
let dot = null;
let canClick = false;
let startTime = 0;

let beepSuccessCount = 0;
let attemptCount = 0;
let randomTimer = null;
let beepTimes = [];
let suppressUntil = 0;

const totalBeepsNeeded = 3;

// ===== beeps 자동 탐지 =====
let BEEPS_BASE = null;
async function resolveBeepsBase() {
  if (BEEPS_BASE) return BEEPS_BASE;
  const pageDir = location.pathname.replace(/[^/]+$/, "");
  const candidates = [
    "beeps", "./beeps", pageDir + "beeps",
    "/public/beeps", "/samples/gaze/beeps", "/beeps"
  ];
  for (const base of [...new Set(candidates.map(b => b.replace(/\/+$/, "")))]) {
    try {
      const res = await fetch(`${base}/file_count.json`, { cache: "no-store" });
      if (!res.ok) continue;
      await res.clone().json();
      BEEPS_BASE = base;
      return BEEPS_BASE;
    } catch {}
  }
  throw new Error("beeps 경로를 찾지 못했습니다.");
}

function beepUrl(name) {
  if (!BEEPS_BASE) throw new Error("BEEPS_BASE not resolved");
  return `${BEEPS_BASE}/${name}`;
}

// ===== 유틸 =====
function drawDot(x, y, r = 15, isBeep = false) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = "#0066FF"; // ✅ 항상 파란색 (불투명)
  ctx.fill();
  dot = { x, y, r, appearTime: performance.now(), isBeep };
  canClick = true;
}

function clearDot() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  dot = null;
  canClick = false;
}

function randomPos() {
  return {
    x: Math.random() * (canvas.width - 40) + 20,
    y: Math.random() * (canvas.height - 40) + 20
  };
}

// ===== 게이지 업데이트 =====
function updateBars() {
  const successPct = (beepSuccessCount / totalBeepsNeeded) * 100;
  successBar.style.width = successPct + "%";
  barText.textContent = `성공 ${beepSuccessCount} / ${totalBeepsNeeded}`;

  if (beepSuccessCount >= totalBeepsNeeded) {
    success = true;
    successModal.style.display = "flex";
    setTimeout(() => {
      window.location.href = "../samples/gaze/noseeso_index.html";
    }, 2000);
  }
}

// ===== 랜덤 dot 루프 =====
function startRandomDots() {
  if (success) return;
  if (dot && dot.isBeep) return; // ✅ beep 점 있으면 랜덤 금지

  const delay = 1200 + Math.random() * 800;

  randomTimer = setTimeout(() => {
    if (success) return;
    if (dot && dot.isBeep) return;

    const nowSec = (performance.now() - startTime) / 1000;
    const nearBeep = beepTimes.some(t => Math.abs(nowSec - t) < 1.2);

    if (nearBeep || nowSec < suppressUntil) {
      startRandomDots();
      return;
    }

    if (!dot) {
      const { x, y } = randomPos();
      drawDot(x, y);

      setTimeout(() => {
        if (!dot || dot.isBeep) return;
        clearDot();
        startRandomDots();
      }, 1500 + Math.random() * 500);
    } else {
      startRandomDots();
    }
  }, delay);
}

// ===== 클릭 =====
canvas.addEventListener("click", (e) => {
  if (!dot || !canClick) return;

  const dx = e.clientX - dot.x;
  const dy = e.clientY - dot.y;
  const inCircle = Math.hypot(dx, dy) <= dot.r;

  if (inCircle) {
    if (dot.isBeep) {
      beepSuccessCount++;
      updateBars();
    }
    clearDot();
  }
});

// ===== 시작 버튼 =====
startBtn.addEventListener("click", async () => {
  success = false;
  beepSuccessCount = 0;
  attemptCount = 0;
  clearDot();
  updateBars();

  progressContainer.style.display = "flex";
  startContainer.style.display = "none";

  try {
    await resolveBeepsBase();
    const info = await fetch(beepUrl("file_count.json")).then(r => r.json());
    const fileIndex = Math.floor(Math.random() * info.count) + 1;

    const audio = new Audio(beepUrl(`beep_${fileIndex}.wav`));
    const data = await fetch(beepUrl(`beep_${fileIndex}.json`)).then(r => r.json());
    beepTimes = data.beeps;

    audio.onplay = () => {
      startTime = performance.now();

      beepTimes.forEach((time, idx) => {
        setTimeout(() => {
          if (success) return;

          suppressUntil = (performance.now() - startTime) / 1000 + 1.5;

          const { x, y } = randomPos();
          drawDot(x, y, 15, true); // ✅ beep 점도 파란색

          setTimeout(() => {
            clearDot();
            setTimeout(() => startRandomDots(), 300); // ✅ 딜레이 후 랜덤 재시작
          }, 1600);

          if (idx === beepTimes.length - 1) {
            setTimeout(() => {
              if (!success && beepSuccessCount < totalBeepsNeeded)
                failModal.style.display = "flex";
            }, 1500);
          }
        }, time * 1000);
      });

      startRandomDots();
    };

    audio.play();
  } catch (err) {
    console.error("❌ beeps 로딩 실패:", err);
    failModal.style.display = "flex";
  }
});

// ===== 모달 =====
retryBtn.onclick = () => window.location.href = "./nocamera_index.html";

// 반응형
window.addEventListener("resize", () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});
