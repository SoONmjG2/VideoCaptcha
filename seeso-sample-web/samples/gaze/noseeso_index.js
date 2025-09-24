// samples/gaze/noseeso_index.js
// ✅ 클릭 전용 버전 (시선 추적 제거)
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
  for (;;) {
    let res;
    try {
      res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    } catch (e) {
      if (attempt >= retries) throw e;
      await new Promise(r => setTimeout(r, baseDelay * (2 ** attempt) + Math.random()*300));
      attempt++; continue;
    }
    if (res.status === 429) {
      if (attempt >= retries) {
        const txt = await res.text().catch(()=> '');
        throw new Error(`429 Too Many Requests: ${txt || ''}`);
      }
      const ra = res.headers.get('Retry-After');
      const waitMs = ra ? (isNaN(+ra) ? 2000 : (+ra * 1000)) : baseDelay * (2 ** attempt);
      await new Promise(r => setTimeout(r, waitMs + Math.random()*300));
      attempt++; continue;
    }
    if (!res.ok) {
      const txt = await res.text().catch(()=> '');
      throw new Error(`${res.status} ${res.statusText || ''} ${txt}`.trim());
    }
    const text = await res.text();
    try { return JSON.parse(text); }
    catch { throw new Error(`Invalid JSON from ${url}: ${text.slice(0,120)}`); }
  }
}

/* ===== 정규화/수학 유틸 ===== */
const PREC = 4;
const roundN = v => Number(v.toFixed(PREC));
const distN = (x1,y1,x2,y2) => Math.hypot(x1-x2, y1-y2);

/* ===== 정답 반경 ===== */
const GAZE_R_N = 0.16;
const GAZE_R_MULT = 1.30;
const rEff = () => GAZE_R_N * GAZE_R_MULT;

/* ===== 정답 평탄화 ===== */
function normalizeAnswer(ans) {
  const pts = [];
  (function walk(x) {
    if (!x) return;
    if (Array.isArray(x)) x.forEach(walk);
    else if (typeof x === 'object') {
      const xn = Number(x?.xn);
      const yn = Number(x?.yn);
      const t  = Number(x?.t);
      if (!Number.isNaN(xn) && !Number.isNaN(yn)) {
        pts.push({ xn, yn, t: Number.isNaN(t) ? null : t });
      }
    }
  })(ans);
  return dedupByRadius(pts, 0.02);
}
function dedupByRadius(arr, rN = 0.02) {
  const out = [];
  for (const p of arr) {
    const dup = out.find(q => distN(p.xn, p.yn, q.xn, q.yn) <= rN);
    if (!dup) out.push(p);
  }
  return out;
}

let ANSWER = [];
let videoStarted = false;
let clickDataArray = [];
const CLICK_TOGGLE_RADIUS_N = 0.025;

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
function sizeCanvasToWindow() { const c=getCanvas(); c.width=window.innerWidth; c.height=window.innerHeight; }
function clearCanvas() { const c=getCanvas(); getCtx().clearRect(0,0,c.width,c.height); }
function n2p(xn, yn) { const c=getCanvas(); return { x: xn*c.width, y: yn*c.height }; }
function p2n(x, y)   { const c=getCanvas(); return { xn: x/c.width, yn: y/c.height }; }
function drawDotRGBA(x,y,r,rgba){ const ctx=getCtx(); ctx.fillStyle=rgba; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill(); }
function drawDotNorm(xn,yn,r,rgba){ const {x,y}=n2p(xn,yn); drawDotRGBA(x,y,r,rgba); }

/* ===== UI helpers ===== */
function placeSubmitInline(){
  const el = document.getElementById('submitButton');
  if (!el) return;
  Object.assign(el.style,{position:'static',marginLeft:'10px',display:'inline-block'});
}
function placeResetInline(){
  const el = document.getElementById('resetButton');
  if (!el) return;
  Object.assign(el.style,{position:'static',marginLeft:'10px',display:'inline-block'});
}

/* ===== 오버레이 ===== */
function renderOverlay(){
  clearCanvas();
  for (const c of clickDataArray) drawDotNorm(c.xn,c.yn,6,'rgba(0,0,255,0.5)');
}

/* ===== 클릭 이벤트 ===== */
function addCanvasClickListener(video){
  const canvas=getCanvas();
  canvas.style.pointerEvents='auto';
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mousedown', e => {
    const rect=canvas.getBoundingClientRect();
    const px=e.clientX-rect.left, py=e.clientY-rect.top;
    const {xn:rx,yn:ry}=p2n(px,py);
    const xn=roundN(rx), yn=roundN(ry);
    const tVideoMs=Math.round((video?.currentTime||0)*1000);
    if (e.button === 0) {
      clickDataArray.push({ t:tVideoMs, xn, yn });
      renderOverlay();
    } else if (e.button === 2) {
      const idx=findNearestClickIndex(xn,yn,CLICK_TOGGLE_RADIUS_N);
      if (idx!==-1){ clickDataArray.splice(idx,1); renderOverlay(); }
    }
  });
}
function findNearestClickIndex(xn,yn,rN){
  if (!clickDataArray.length) return -1;
  let bestIdx=-1, bestDist=rN;
  for (let i=clickDataArray.length-1;i>=0;i--){
    const c=clickDataArray[i];
    const d=Math.hypot(c.xn-xn,c.yn-yn);
    if (d<=bestDist){ bestDist=d; bestIdx=i; }
  }
  return bestIdx;
}

/* ===== 저장 전 토글/중복 정리 (index.js와 동일 정책) ===== */
function dedupToggle(arr,rN=0.015,winMs=700){
  const out=[];
  for (const c of arr){
    const i=out.findIndex(o=>Math.abs(o.t-c.t)<=winMs && Math.hypot(o.xn-c.xn,o.yn-c.yn)<=rN);
    if (i>=0) out.splice(i,1); else out.push(c);
  }
  return out;
}

/* ===== 제출 ===== */
/* ▶︎ index.js와 동일: 정답 점과의 거리만으로 클릭 정답 판정 */
function nearAnswer(c, A, rN){
  return (A||[]).some(a => distN(c.xn, c.yn, Number(a.xn), Number(a.yn)) <= rN);
}
async function onSubmit(){
  const cleaned = dedupToggle(clickDataArray.slice());
  const EFFECTIVE_R_N = rEff();
  const passed = cleaned.some(c => nearAnswer(c, ANSWER, EFFECTIVE_R_N));
  if (passed) window.location.href = SUCCESS_URL;
  else await fullReset();
}

/* ===== 리셋 ===== */
function resetRecording(){ clickDataArray=[]; clearCanvas(); }
async function fullReset(){
  resetRecording();
  try{
    const data = await fetchJsonWithRetry(API('/video-data'));

    ANSWER = normalizeAnswer(data.answer);
    const video=document.getElementById('myVideo');
    if (video) {
      const srcPath = data.videoPath ? data.videoPath.replace(/^\/+/, '') : `video/${data.id}`;
      video.src = API(`/${srcPath}?ts=${Date.now()}`);
      try { await video.play(); } catch {}
    }
    const overlay=document.getElementById('overlayText');
    if (overlay) overlay.textContent=data.question;
    placeSubmitInline(); placeResetInline();
  }catch(e){ console.error('❌ /video-data 재호출 실패', e); }
}

/* ===== 초기화 ===== */
(async ()=>{
  sizeCanvasToWindow();
  window.addEventListener('resize', sizeCanvasToWindow);
  try{
    const data = await fetchJsonWithRetry(API('/video-data'));

    ANSWER = normalizeAnswer(data.answer);
    const video=document.getElementById('myVideo');
    if (video){
      video.addEventListener('loadeddata', ()=>{ placeSubmitInline(); placeResetInline(); });
      video.addEventListener('playing', ()=>{ videoStarted=true; });
      const srcPath = data.videoPath ? data.videoPath.replace(/^\/+/, '') : `video/${data.id}`;
      video.src = API(`/${srcPath}?ts=${Date.now()}`);
    }
    const overlay=document.getElementById('overlayText');
    if (overlay) overlay.textContent=data.question;
    addCanvasClickListener(video);
  }catch(e){ console.error('❌ DB에서 영상/텍스트 로딩 실패', e); }

  const submitButton=document.getElementById('submitButton');
  if (submitButton){
    placeSubmitInline();
    submitButton.style.display='inline-block';
    submitButton.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      try { await onSubmit(); } catch (err) { console.error(err); }
    });
  }
  const resetButton=document.getElementById('resetButton');
  if (resetButton){
    placeResetInline();
    resetButton.style.display='inline-block';
    resetButton.addEventListener('click', fullReset);
  }
})();
