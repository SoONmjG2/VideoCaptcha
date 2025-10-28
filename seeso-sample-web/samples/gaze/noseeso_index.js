// samples/gaze/noseeso_index.js
// ✅ 클릭 전용 버전 (시선 추적 제거)
// ✅ index.js와 동일한 좌표계(비디오 박스 기준 정규화), 반경/시간창/오프셋 구조 적용
// ✅ 로컬/배포 환경에 맞춰 API 경로 자동 분기

/* ===== 환경 분기 ===== */
const IS_LOCAL =
  ['localhost', '127.0.0.1'].includes(location.hostname) ||
  location.hostname.endsWith('.local') ||
  location.protocol === 'file:';

const API_ORIGIN = (() => {
  if (typeof window !== 'undefined' && window.__API_ORIGIN) return window.__API_ORIGIN;
  const { protocol, hostname } = location;
  if (IS_LOCAL) return 'http://localhost:3000';
  if (hostname.endsWith('peachprmoise.co.kr')) return 'https://api.peachprmoise.co.kr';
  return `${protocol}//${hostname}`;
})();

/* ===== api 서브도메인일 땐 /api 프리픽스 미부착 ===== */
const API = (p) => {
  const path = p.startsWith('/') ? p : `/${p}`;
  if (IS_LOCAL) return `${API_ORIGIN}${path}`;
  let host;
  try { host = new URL(API_ORIGIN).hostname; } catch { host = location.hostname; }
  const isApiSubdomain = host === 'api.peachprmoise.co.kr' || host.startsWith('api.');
  return `${API_ORIGIN}${isApiSubdomain ? '' : '/api'}${path}`;
};

/* ===== 기본 설정 ===== */
const SUCCESS_URL = 'success/success.html';
const CAMERA_ERROR_URL = null;

/* ===== fetch helper: JSON + 429 재시도 ===== */
async function fetchJsonWithRetry(url, { retries = 4, baseDelay = 800, signal } = {}) {
  let attempt = 0;
  while (true) {
    let res;
    try {
      res = await fetch(url, { signal, headers: { 'Accept': 'application/json' } });
    } catch (e) {
      if (attempt >= retries) throw e;
      await new Promise(r => setTimeout(r, baseDelay * (2 ** attempt) + Math.random() * 300));
      attempt++; continue;
    }
    if (res.status === 429) {
      if (attempt >= retries) {
        const txt = await res.text().catch(() => '');
        throw new Error(`429 Too Many Requests: ${txt || ''}`);
      }
      const ra = res.headers.get('Retry-After');
      const waitMs = ra ? (isNaN(+ra) ? 2000 : (+ra * 1000)) : baseDelay * (2 ** attempt);
      await new Promise(r => setTimeout(r, waitMs + Math.random() * 300));
      attempt++; continue;
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`${res.status} ${res.statusText || ''} ${txt}`.trim());
    }
    const text = await res.text();
    try { return JSON.parse(text); }
    catch { throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 120)}`); }
  }
}

/* ===== 정규화 유틸 ===== */
const PREC = 4;
const roundN = v => Number(v.toFixed(PREC));
const clamp01 = v => Math.max(0, Math.min(1, v));
const distN = (x1, y1, x2, y2) => Math.hypot(x1 - x2, y1 - y2);

/* ===== 시선/클릭 반경 + 시간창 파라미터 (index.js와 정렬) ===== */
const GAZE_R_N = 0.10;          // 기준 반경(정규화)
let CLICK_R_MULT = 0.2;        // 클릭 허용 반경 배수
const rEffClick = () => GAZE_R_N * CLICK_R_MULT;

let GAZE_WIN_BEFORE_MS = 200;   // 클릭보다 최대 이만큼 이르게 허용
let GAZE_WIN_AFTER_MS  = 200;   // ✅ index.js와 동일하게 100ms로 통일

// (옵션) 미세 보정 오프셋 — 기본 0 (필요 시만 조절)
let CLICK_T_OFFSET_MS  = 0;     // 클릭 t 보정
let ANSWER_T_OFFSET_MS = 0;     // 정답 t 보정

/* ===== 정답 평탄화 (정답에는 항상 t가 존재해야 함) ===== */
/* ✅ dedup 제거: 같은 위치 다른 시간의 정답을 합치지 않음 */
function normalizeAnswer(ans) {
  const pts = [];
  (function walk(x) {
    if (!x) return;
    if (Array.isArray(x)) x.forEach(walk);
    else if (typeof x === 'object') {
      const xn = Number(x?.xn);
      const yn = Number(x?.yn);
      const t  = Number(x?.t);
      if (!Number.isNaN(xn) && !Number.isNaN(yn) && !Number.isNaN(t)) {
        pts.push({ xn, yn, t });
      }
    }
  })(ans);
  return pts;
}

/* ===== 상태 ===== */
let ANSWER = [];
let videoStarted = false;
let clickDataArray = [];
const CLICK_TOGGLE_RADIUS_N = 0.025;

/* ===== 좌표계: “비디오 박스 기준 정규화(0~1)” ===== */
function getVideoRect() {
  const v = document.getElementById('myVideo');
  return v.getBoundingClientRect();
}
// 윈도우 좌표(px) -> 비디오 정규화(0~1)
function winP2videoN(px, py) {
  const r = getVideoRect();
  const xn = clamp01((px - r.left) / r.width);
  const yn = clamp01((py - r.top)  / r.height);
  return { xn: roundN(xn), yn: roundN(yn) };
}
// 비디오 정규화(0~1) -> 화면 좌표(px) (캔버스에 그릴 때 사용)
function videoN2canvasP(xn, yn) {
  const r = getVideoRect();
  return { x: r.left + xn * r.width, y: r.top + yn * r.height };
}

/* ===== Canvas helpers ===== */
function ensureCanvas() {
  let c = document.getElementById('output');
  if (!c) {
    c = document.createElement('canvas');
    c.id = 'output';
    Object.assign(c.style, {
      position: 'fixed',
      inset: 0,
      zIndex: 10001,
      pointerEvents: 'auto'
    });
    document.body.appendChild(c);
  }
  return c;
}
function getCanvas() { return ensureCanvas(); }
function getCtx() { return getCanvas().getContext('2d'); }
function sizeCanvasToWindow() {
  const c = getCanvas();
  c.width = window.innerWidth;
  c.height = window.innerHeight;
}
function clearCanvas() {
  const c = getCanvas();
  getCtx().clearRect(0, 0, c.width, c.height);
}
function drawDotRGBA(x, y, r, rgba) {
  const ctx = getCtx();
  ctx.fillStyle = rgba;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}
function drawDotNorm(xn, yn, r, rgba) {
  const { x, y } = videoN2canvasP(xn, yn); // ✅ 비디오 기준으로 변환
  drawDotRGBA(x, y, r, rgba);
}

/* ===== UI helpers ===== */
function placeSubmitInline() {
  const el = document.getElementById('submitButton');
  if (!el) return;
  Object.assign(el.style, { position: 'static', marginLeft: '10px', display: 'inline-block' });
}
function placeResetInline() {
  const el = document.getElementById('resetButton');
  if (!el) return;
  Object.assign(el.style, { position: 'static', marginLeft: '10px', display: 'inline-block' });
}

/* ===== 오버레이 ===== */
function renderOverlay() {
  clearCanvas();
  for (const c of clickDataArray) drawDotNorm(c.xn, c.yn, 6, 'rgba(0,0,255,0.5)');
}

/* ===== 클릭 이벤트 ===== */
function addCanvasClickListener(video) {
  const canvas = getCanvas();
  canvas.style.pointerEvents = 'auto';
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mousedown', e => {
    const { xn, yn } = winP2videoN(e.clientX, e.clientY); // ✅ 비디오 정규화 좌표
    const tVideoMs = Math.round((video?.currentTime || 0) * 1000);
    if (e.button === 0) {
      clickDataArray.push({ t: tVideoMs, xn, yn });
      renderOverlay();
    } else if (e.button === 2) {
      const idx = findNearestClickIndex(xn, yn, CLICK_TOGGLE_RADIUS_N);
      if (idx !== -1) { clickDataArray.splice(idx, 1); renderOverlay(); }
    }
  });
}
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

/* ===== 저장 전 토글/중복 정리 ===== */
function dedupToggle(arr, rN = 0.015, winMs = 700) {
  const out = [];
  for (const c of arr) {
    const i = out.findIndex(o =>
      Math.abs(o.t - c.t) <= winMs &&
      Math.hypot(o.xn - c.xn, o.yn - c.yn) <= rN
    );
    if (i >= 0) out.splice(i, 1); else out.push(c);
  }
  return out;
}

/* ===== 클릭↔정답: 시간 + 거리 매칭 (시간 필수) ===== */
function nearestAnswerForClick(click, answers, rN, before = GAZE_WIN_BEFORE_MS, after = GAZE_WIN_AFTER_MS) {
  const clickT = (click.t | 0) + CLICK_T_OFFSET_MS;
  const tMin = clickT - before;
  const tMax = clickT + after;

  let best = null, bestDist = Infinity;

  for (const a of (answers || [])) {
    if (a?.t == null) continue; // 요구사항: 정답엔 항상 t
    const at = (a.t | 0) + ANSWER_T_OFFSET_MS;
    if (at < tMin || at > tMax) continue; // 시간창
    const d = distN(click.xn, click.yn, Number(a.xn), Number(a.yn)); // 거리
    if (d < bestDist) { bestDist = d; best = a; }
  }

  return (best && bestDist <= rN) ? best : null;
}

/* ===== 제출 (reCAPTCHA + 정답 검증) ===== */
async function onSubmit() {
  try {
    // ✅ 1️⃣ reCAPTCHA 인증 요청
    const result = await verifyRecaptcha();
    if (!result.success || result.score < 0.5) {
      alert(`❌ 자동화 의심 (score=${result.score})`);
      return;
    }

    // ✅ 2️⃣ 클릭 정답 검증
    const cleaned = dedupToggle(clickDataArray.slice());
    const R_CLICK = rEffClick();
    const passed = cleaned.some(click => !!nearestAnswerForClick(click, ANSWER, R_CLICK));

    if (passed) {
      window.location.href = SUCCESS_URL;
    } else {
      await fullReset();
    }
  } catch (err) {
    console.error("❌ onSubmit 중 오류:", err);
    alert("⚠️ 서버 또는 네트워크 오류");
  }
}


/* ===== reCAPTCHA 검증 ===== */
async function verifyRecaptcha() {
  try {
    const siteKey = window.__RECAPTCHA_KEY; // ✅ HTML에 선언한 Site Key
    const token = await grecaptcha.execute(siteKey, { action: "submit" });

    const res = await fetch(API("/api/recaptcha/verify"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

    const data = await res.json();
    console.log("🧠 reCAPTCHA result:", data);
    return data;
  } catch (err) {
    console.error("❌ reCAPTCHA 오류:", err);
    return { success: false, score: 0 };
  }
}


/* ===== 리셋 ===== */
function resetRecording() { clickDataArray = []; clearCanvas(); }
async function fullReset() {
  resetRecording();
  try {
    const data = await fetchJsonWithRetry(API('/video-data'));
    ANSWER = normalizeAnswer(data.answer); // t 없는 항목은 제거됨
    const video = document.getElementById('myVideo');
    if (video) {
      const srcPath = data.videoPath ? data.videoPath.replace(/^\/+/, '') : `video/${data.id}`;
      video.src = API(`/${srcPath}?ts=${Date.now()}`);
      try { await video.play(); } catch { }
    }
    const overlay = document.getElementById('overlayText');
    if (overlay) overlay.textContent = data.question;
    placeSubmitInline(); placeResetInline();
  } catch (e) { console.error('❌ /video-data 재호출 실패', e); }
}

/* ===== 초기화 ===== */
(async () => {
  sizeCanvasToWindow();
  window.addEventListener('resize', sizeCanvasToWindow);
  try {
    const data = await fetchJsonWithRetry(API('/video-data'));
    ANSWER = normalizeAnswer(data.answer);
    const video = document.getElementById('myVideo');
    if (video) {
      video.addEventListener('loadeddata', () => { placeSubmitInline(); placeResetInline(); });
      video.addEventListener('playing', () => { videoStarted = true; });
      const srcPath = data.videoPath ? data.videoPath.replace(/^\/+/, '') : `video/${data.id}`;
      video.src = API(`/${srcPath}?ts=${Date.now()}`);
    }
    const overlay = document.getElementById('overlayText');
    if (overlay) overlay.textContent = data.question;
    addCanvasClickListener(video);
  } catch (e) { console.error('❌ DB에서 영상/텍스트 로딩 실패', e); }

  const submitButton = document.getElementById('submitButton');
  if (submitButton) {
    placeSubmitInline();
    submitButton.style.display = 'inline-block';
    submitButton.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      try { await onSubmit(); } catch (err) { console.error(err); }
    });
  }

  const resetButton = document.getElementById('resetButton');
  if (resetButton) {
    placeResetInline();
    resetButton.style.display = 'inline-block';
    resetButton.addEventListener('click', fullReset);
  }
})();
