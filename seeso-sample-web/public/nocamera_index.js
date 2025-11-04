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
let beepWindows = [];

const totalBeepsNeeded = 3;
let beepTimes = [];
let suppressUntil = 0; // 🔹 랜덤 dot 금지 시점

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
function drawDot(x, y, r = 15) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,255,0.7)";
  ctx.fill();
  dot = { x, y, r, appearTime: performance.now(), isBeep: false };
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

// ===== 랜덤 dot 루프 (beep 전후 억제 포함) =====
function startRandomDots() {
  if (success) return;
  const delay = 1200 + Math.random() * 800;

  randomTimer = setTimeout(() => {
    if (success) return;

    const nowSec = (performance.now() - startTime) / 1000;
    // 🔹 beep 전후 ±1초 동안 랜덤 dot 금지
    const nearBeep = beepTimes.some(t => Math.abs(nowSec - t) < 1.0);
    if (nearBeep || nowSec < suppressUntil) {
      // beep 근처면 다음 시도로 넘김
      startRandomDots();
      return;
    }

    if (!dot) {
      const { x, y } = randomPos();
      drawDot(x, y);
      setTimeout(() => {
        clearDot();
        startRandomDots();
      }, 1500 + Math.random() * 500);
    } else {
      startRandomDots();
    }
  }, delay);
}

// ===== 클릭 핸들러 =====
canvas.addEventListener("click", (e) => {
  if (!dot || !canClick) return;
  attemptCount++;

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
  canClick = false;
  beepSuccessCount = 0;
  attemptCount = 0;
  clearDot();

  updateBars();
  progressContainer.style.display = "flex";
  startContainer.style.display = "none";

  try {
    await resolveBeepsBase();

    const info = await fetch(beepUrl("file_count.json")).then(r => r.json());
    const maxIndex = info.count;
    const fileIndex = Math.floor(Math.random() * maxIndex) + 1;

    const audio = new Audio(beepUrl(`beep_${fileIndex}.wav`));
    const data = await fetch(beepUrl(`beep_${fileIndex}.json`)).then(r => r.json());
    beepTimes = data.beeps;

    audio.onplay = () => {
      startTime = performance.now();

      beepTimes.forEach((time, idx) => {
        setTimeout(() => {
          if (success) return;

          // 🔹 beep 전후 1초간 랜덤 dot 정지
          suppressUntil = (performance.now() - startTime) / 1000 + 1;

          // 🔹 현재 dot 있으면 교체, 없으면 새로 생성
          const { x, y } = randomPos();
          drawDot(x, y);
          dot.isBeep = true;

          setTimeout(() => {
            clearDot();
            dot = null;
            dot.isBeep = false;
            startRandomDots(); // beep 끝나면 다시 랜덤 루프 이어감
          }, 1200);

          // 마지막 beep 후 실패 체크
          if (idx === beepTimes.length - 1) {
            setTimeout(() => {
              if (!success && beepSuccessCount < totalBeepsNeeded) {
                failModal.style.display = "flex";
              }
            }, 1500);
          }
        }, time * 1000);
      });

      startRandomDots(); // 시작 직후 랜덤 dot 루프 실행
    };

    audio.play();
  } catch (err) {
    console.error("❌ beeps 리소스 로딩 실패:", err);
    failModal.style.display = "flex";
  }
});

// ===== 모달 버튼 =====
retryBtn.onclick = () => {
  window.location.href = "./nocamera_index.html";
};

// 반응형
window.addEventListener("resize", () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});
