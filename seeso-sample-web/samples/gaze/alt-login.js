// public/alt-login.js  (카메라/시선 로직 없음: 클릭만)
const SUCCESS_URL = '/samples/gaze/success/success.html'; // 성공 페이지(샘플 위치 고정)
const PREC  = 4;
const TOL_N = 0.05;   // 위치 허용(정규화)
const TOL_MS= 800;    // 시간 허용(ms)
const roundN = v => Number(v.toFixed(PREC));

// ===== 정답/매칭 =====
let ANSWER = []; // [{t?:ms, xn, yn}]
function anyClickMatches(clicks, answer, tolN=TOL_N, tolMs=TOL_MS, prec=PREC) {
  if (!Array.isArray(clicks) || !Array.isArray(answer)) return false;
  if (!clicks.length || !answer.length) return false;
  const r = v => Number(v.toFixed(prec));
  const C = clicks.map(c => ({ t: c.t|0, xn: r(c.xn), yn: r(c.yn) }));
  const A = answer.map(a => ({ t: a.t==null?null:(a.t|0), xn: r(a.xn), yn: r(a.yn) }));
  for (const c of C) for (const a of A) {
    const dt = (a.t==null) ? 0 : Math.abs(c.t - a.t);
    if (dt > tolMs) continue;
    const d = Math.hypot(c.xn - a.xn, c.yn - a.yn);
    if (d <= tolN) return true;
  }
  return false;
}

// ===== 상태/데이터 =====
let isReady = false;
let videoStarted = false;
let clickDataArray = [];
let lastVideoTimeMs = 0;

// 클릭 토글 반경(정규화)
const CLICK_TOGGLE_RADIUS_N = 0.025;

// ===== Canvas helpers =====
const canvas = document.getElementById('output');
const ctx = canvas.getContext('2d');
function sizeCanvasToWindow() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
function clearCanvas() { ctx.clearRect(0,0,canvas.width,canvas.height); }

// 정규화 <-> 픽셀
function n2p(xn, yn){ return { x: xn * canvas.width, y: yn * canvas.height }; }
function p2n(x, y){ return { xn: x / canvas.width, yn: y / canvas.height }; }

// ===== Drawing =====
function drawDotRGBA(x, y, r, rgba) {
  ctx.fillStyle = rgba;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI*2);
  ctx.fill();
}
function drawDotNorm(xn, yn, r, rgba) {
  const {x,y} = n2p(xn, yn);
  drawDotRGBA(x, y, r, rgba);
}

// ===== 클릭 토글 =====
function findNearestClickIndex(xn, yn, rN) {
  if (!clickDataArray.length) return -1;
  let bestIdx = -1, bestDist = rN;
  for (let i = clickDataArray.length - 1; i >= 0; i--) {
    const c = clickDataArray[i];
    const d = Math.hypot(c.xn - xn, c.yn - yn);
    if (d <= bestDist) { bestDist = d; bestIdx = i; }
  }
  return bestIdx;
}

// 제출 전 중복 토글 정리
function dedupToggle(arr, rN=0.015, winMs=700){
  const out=[];
  for (const c of arr){
    const i = out.findIndex(o => Math.abs(o.t - c.t) <= winMs &&
                                 Math.hypot(o.xn - c.xn, o.yn - c.yn) <= rN);
    if (i >= 0) out.splice(i,1); else out.push(c);
  }
  return out;
}

// ===== Overlay =====
function renderOverlay() {
  if (!isReady || !videoStarted) return;
  clearCanvas();
  for (const c of clickDataArray) {
    // 요청사항: 파란 "불투명" 점
    drawDotNorm(c.xn, c.yn, 8, 'rgba(0,0,255,0.85)');
  }
}

// ===== 제출/리셋 =====
async function onSubmit() {
  const cleaned = dedupToggle(clickDataArray.slice());
  const ok = anyClickMatches(cleaned, ANSWER);
  if (ok) {
    window.location.href = SUCCESS_URL;
  } else {
    await fullReset(); // 오답 → 새 문제
  }
}

async function fullReset() {
  clickDataArray.length = 0;
  lastVideoTimeMs = 0;
  clearCanvas();

  const video = document.getElementById('myVideo');
  try{
    const res = await fetch('http://localhost:3000/video-data');
    const data = await res.json();

    ANSWER = Array.isArray(data.answer) ? data.answer : [];
    video.src = `http://localhost:3000/video/${data.id}?ts=${Date.now()}`;

    const overlay = document.getElementById('overlayText');
    overlay.textContent = data.question;

    // 버튼 재노출
    setButtonsVisible(true);
  }catch(e){
    console.error('❌ /video-data 재호출 실패:', e);
  }
}

// ===== 버튼 표시/숨김 =====
function setButtonsVisible(show){
  const ids = ['submitButton','resetButton'];
  ids.forEach(id=>{
    const el = document.getElementById(id);
    if (!el) return;
    if (show){
      el.classList.remove('hidden-init');
      el.style.display = 'inline-block';
    } else {
      el.style.display = 'none';
    }
  });
}

// ===== 초기화 =====
(async function init(){
  window.addEventListener('resize', sizeCanvasToWindow);
  sizeCanvasToWindow();

  const video = document.getElementById('myVideo');
  const overlay = document.getElementById('overlayText');

  // 버튼 바인딩
  const submitButton = document.getElementById('submitButton');
  const resetButton  = document.getElementById('resetButton');
  submitButton.addEventListener('click', onSubmit);
  resetButton.addEventListener('click', fullReset);

  // 캔버스 클릭(토글)
  canvas.style.pointerEvents = 'auto';
  canvas.addEventListener('click', (e) => {
    if (!isReady) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const { xn: rawXn, yn: rawYn } = p2n(px, py);
    const xn = roundN(rawXn);
    const yn = roundN(rawYn);

    const idx = findNearestClickIndex(xn, yn, CLICK_TOGGLE_RADIUS_N);
    if (idx !== -1) {
      clickDataArray.splice(idx, 1);
      renderOverlay();
      return;
    }

    const tVideoMs = Math.round((video?.currentTime || 0) * 1000);
    clickDataArray.push({ t: tVideoMs, xn, yn });
    renderOverlay();
  });

  // 비디오 이벤트
  video.addEventListener('loadeddata', () => {
    // main.css가 video를 기본 display:none; 이라서 보이게 변경
    video.style.display = 'block';
    setButtonsVisible(true);   // 로드되면 버튼 노출
  });
  video.addEventListener('playing', () => {
    videoStarted = true;
    renderOverlay();
  });

  // 초기 문제 로드
  try {
    const res  = await fetch('http://localhost:3000/video-data');
    const data = await res.json();

    ANSWER = Array.isArray(data.answer) ? data.answer : [];
    video.src = `http://localhost:3000/video/${data.id}?ts=${Date.now()}`;
    overlay.textContent = data.question;

    isReady = true;
  } catch (e) {
    console.error('❌ DB에서 영상/텍스트 로딩 실패', e);
  }
})();
