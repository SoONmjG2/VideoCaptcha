// index.js
import 'regenerator-runtime/runtime';
import EasySeeSo from 'seeso/easy-seeso';
import { showGaze, hideGaze } from "../showGaze";

const licenseKey = 'dev_f1hvrhiqcw78h4va2xt7ajuhtdriiqan3gjbcxy3';
const dotMaxSize = 10;
const dotMinSize = 5;

let isCalibrationMode = false;
let eyeTracker = null;
let isTracking = false;
let calibrationButton;
let savePlayButton;
let videoStartTimestamp = null;

let gazeDataArray = [];
let dragDataArray = [];
let isDragging = false;
let isPlayingBack = false;
let answerPoints = [];
let currentX = 0, currentY = 0; // 🔥 calibration 점 좌표 저장

// ✅ 정답 JSON 불러오기 (click 위치 확인용)
async function loadAnswerJSON() {
  try {
    const res = await fetch('./seeso-sample-web/data/drag.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('정답 JSON 불러오기 실패');
    answerPoints = await res.json();
    console.log('정답 좌표 불러옴:', answerPoints);
  } catch (e) {
    console.error('정답 JSON 로드 에러:', e);
  }
}

// ✅ 영상 클릭 시 정답 여부 판별
function isCorrectAnswerByTime(clickX, clickY, videoTimeMs, tolerance = 20, timeWindow = 500) {
  const absoluteTime = videoStartTimestamp + videoTimeMs;
  const candidates = answerPoints.filter(p => Math.abs(p.timestamp - absoluteTime) <= timeWindow);
  return candidates.some(point => {
    const dx = point.x - clickX;
    const dy = point.y - clickY;
    return Math.sqrt(dx * dx + dy * dy) <= tolerance;
  });
}

// ✅ 영상 클릭 이벤트 등록
function addVideoClickListener() {
  const video = document.getElementById("myVideo");
  if (!video) return;

  video.addEventListener('click', (e) => {
    const rect = video.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const videoTimeMs = video.currentTime * 1000;

    if (isCorrectAnswerByTime(clickX, clickY, videoTimeMs)) {
      alert('✅ 정답입니다!');
    } else {
      alert('❌ 오답입니다!');
    }
  });
}

// ✅ 캘리브레이션 버튼 클릭 시 동작
function onClickCalibrationBtn() {
  if (!isCalibrationMode) {
    isCalibrationMode = true;

    const canvas = document.getElementById('output');
    canvas.style.display = 'block';

    hideGaze();
    eyeTracker.hideImage();

    let focusText = showFocusText();

    setTimeout(() => {
      hideFocusText(focusText);
      eyeTracker.startCalibration(onCalibrationNextPoint, onCalibrationProgress, onCalibrationFinished);
    }, 2000);

    calibrationButton.style.display = 'none';
    document.getElementById("calibrationTitle").style.display = 'none';

    const video = document.getElementById("myVideo");
    if (video) video.style.display = 'none';
  }
}

// ✅ 시선 추적 중 호출됨
function onGaze(gazeInfo) {
  if (!isCalibrationMode && isTracking) {
    showGaze(gazeInfo);
    gazeDataArray.push({ timestamp: Date.now(), x: gazeInfo.x, y: gazeInfo.y });
  } else {
    hideGaze();
  }
}

function onCalibrationNextPoint(x, y) {
  currentX = x;
  currentY = y;
  const ctx = clearCanvas();
  drawCircle(x, y, dotMinSize, ctx);
  eyeTracker.startCollectSamples();
}

function onCalibrationProgress(progress) {
  const ctx = clearCanvas();
  const dotSize = dotMinSize + (dotMaxSize - dotMinSize) * progress;
  drawCircle(currentX, currentY, dotSize, ctx);
}

function onCalibrationFinished() {
  clearCanvas();
  isCalibrationMode = false;
  calibrationButton.style.display = 'none';
  eyeTracker.showImage();
  isTracking = true;
  if (savePlayButton) savePlayButton.style.display = 'inline-block';
  const video = document.getElementById("myVideo");
  if (video) {
    video.style.display = 'block';
    video.play();
  }
  document.getElementById('overlayText').style.display = 'block';
}

function clearCanvas() {
  const canvas = document.getElementById("output");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  return ctx;
}

function drawCircle(x, y, radius, ctx) {
  ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function showFocusText() {
  const el = document.createElement("div");
  el.innerText = "Focus on point";
  el.style.position = "fixed";
  el.style.top = "50%";
  el.style.left = "50%";
  el.style.transform = "translate(-50%, -50%)";
  document.body.appendChild(el);
  return el;
}

function hideFocusText(el) {
  document.body.removeChild(el);
}

// ✅ 초기 실행
(async () => {
  try {
    // 1. 백엔드에서 영상 URL과 질문 텍스트 받아옴
    const res = await fetch("http://localhost:3000/video-data");
    const data = await res.json();
    const video = document.getElementById("myVideo");
    video.src = data.videoUrl;
    const overlay = document.getElementById("overlayText");
    overlay.textContent = data.question;
  } catch (e) {
    console.error("❌ DB에서 영상/텍스트 로딩 실패", e);
  }

  // 2. 정답좌표 JSON 로딩 + 클릭 이벤트 등록
  await loadAnswerJSON();
  addVideoClickListener();

  // 3. 캘리브레이션 버튼 초기화
  calibrationButton = document.getElementById('calibrationButton');
  calibrationButton.addEventListener('click', onClickCalibrationBtn);
  calibrationButton.disabled = true;

  // 4. save & play 버튼 동적 생성
  savePlayButton = document.createElement('button');
  savePlayButton.innerText = 'Save & Play';
  savePlayButton.style.display = 'none';
  savePlayButton.style.marginTop = '10px';
  document.querySelector('.container').appendChild(savePlayButton);

  // 5. SeeSo EyeTracker 초기화
  eyeTracker = new EasySeeSo();
  await eyeTracker.init(
    licenseKey,
    async () => {
      await eyeTracker.startTracking(onGaze, () => {});
      eyeTracker.showImage();
      calibrationButton.disabled = false;
    },
    () => console.log("❌ SeeSo 초기화 실패")
  );

  // 6. 영상 재생 시 타이밍 저장
  const video = document.getElementById("myVideo");
  video.addEventListener("play", () => {
    videoStartTimestamp = Date.now();
    if (!isCalibrationMode && eyeTracker && !isTracking) {
      eyeTracker.startTracking(onGaze, () => {});
      isTracking = true;
    }
  });

  video.addEventListener("pause", () => {
    if (eyeTracker && isTracking) {
      eyeTracker.stopTracking();
      isTracking = false;
    }
  });
})();
