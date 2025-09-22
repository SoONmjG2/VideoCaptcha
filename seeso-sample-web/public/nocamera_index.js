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
let dotAppearTime = 0;
let canClick = false;

let beepSuccessCount = 0;
let attemptCount = 0;

const totalBeepsNeeded = 3;  // ✅ 3회 성공 시 통과
const maxBeeps = 4;          // 음성 파일 내 총 삐음 수

// ===== 유틸 =====
function drawDot(x, y, r = 10) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0, 0, 255, 0.7)";
  ctx.fill();
  dot = { x, y, r };
  dotAppearTime = performance.now();
}

function clearDot() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  dot = null;
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

  // 성공 조건
  if (beepSuccessCount >= totalBeepsNeeded) {
    success = true;
    successModal.style.display = "flex";

    // 🔹 성공 시 자동 리다이렉트 (2초 후)
    setTimeout(() => {
      window.location.href = "../samples/gaze/noseeso_index.html";
    }, 2000);
  }
}

// ===== 클릭 핸들러 =====
canvas.addEventListener("click", (e) => {
  if (!dot || !canClick) return;

  attemptCount++;
  const dx = e.clientX - dot.x;
  const dy = e.clientY - dot.y;
  const inCircle = Math.hypot(dx, dy) <= dot.r;

  if (inCircle) {
    const reaction = performance.now() - dotAppearTime;
    if (reaction >= 20 && reaction <= 1500) {
      beepSuccessCount++;
      updateBars();
    }
    clearDot();
    canClick = false;
  }
});

// ===== 시작 버튼 =====
startBtn.addEventListener("click", () => {
  success = false;
  canClick = false;
  beepSuccessCount = 0;
  attemptCount = 0;

  updateBars();
  progressContainer.style.display = "flex";
  startContainer.style.display = "none";

  // 🔹 file_count.json 불러오기 → 랜덤 파일 선택
  fetch("/beeps/file_count.json")
    .then(res => res.json())
    .then(info => {
      const maxIndex = info.count;
      const fileIndex = Math.floor(Math.random() * maxIndex) + 1;

      console.log("🎲 선택된 파일:", fileIndex);

      const audio = new Audio(`/beeps/beep_${fileIndex}.wav`);
      fetch(`/beeps/beep_${fileIndex}.json`)
        .then(res => res.json())
        .then(data => {
          const beepTimes = data.beeps;
          audio.play();

          beepTimes.forEach((time, idx) => {
            setTimeout(() => {
              if (success) return; // 이미 성공했으면 이후 무시
              const { x, y } = randomPos();
              drawDot(x, y);
              canClick = true;

              setTimeout(() => {
                clearDot();
                canClick = false;

                // 🔹 마지막 삐음 처리 후 검사
                if (idx === beepTimes.length - 1) {
                  setTimeout(() => {
                    if (!success && beepSuccessCount < totalBeepsNeeded) {
                      failModal.style.display = "flex";
                      // ⛔ 자동 이동 제거 → Retry 버튼으로만 복귀
                    }
                  }, 1600);
                }
              }, 1500);
            }, time * 1000);
          });
        });
    })
    .catch(err => console.error("❌ file_count.json 불러오기 실패:", err));
});

// ===== 모달 버튼 =====
retryBtn.onclick = () => {
  // ✅ 초기화면으로 복귀
  window.location.href = "/nocamera_index.html";
};

// 반응형
window.addEventListener("resize", () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
});
