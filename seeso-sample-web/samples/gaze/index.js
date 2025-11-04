// samples/gaze/index.js
import 'regenerator-runtime/runtime';
import EasySeeSo from 'seeso/easy-seeso';
import { initToleranceDebug } from './tolerance_debug';

/* ===== 환경 분기 ===== */
// localhost/127.0.0.1 또는 *.local, file:// 은 로컬로 간주
const IS_LOCAL =
  ['localhost', '127.0.0.1'].includes(location.hostname) ||
  location.hostname.endsWith('.local') ||
  location.protocol === 'file:';

/* ===== API ROOT (배포는 /api 프록시) =====
   필요하면 index.html 등에서 window.__API_ORIGIN 으로 강제 지정 가능 */
const API_ROOT = (() => {
  if (typeof window !== 'undefined' && window.__API_ORIGIN) return window.__API_ORIGIN;
  return IS_LOCAL ? 'http://localhost:3000' : '/api';
})();

/* ===== SeeSo 라이선스 키 ===== */
const SEESO_DEV_KEY  = 'dev_hhc570sz5quc3kk3wvpuvbm2zznc0wow8d5nej6v'; // dev
const SEESO_PROD_KEY = 'prod_muvxi2s8hct25hkzl989rrspxju8fb1lzdhzmoxx'; // prod
const licenseKey = IS_LOCAL ? SEESO_DEV_KEY : SEESO_PROD_KEY;

const dotMaxSize = 10;
const dotMinSize = 5;


/* 라우팅 */
const SUCCESS_URL = IS_LOCAL ? 'success/success.html' : '/success';
// 에러 페이지를 쓰려면 경로 지정, 아니면 null로 두면 콘솔만 찍고 이동 안함
const CAMERA_ERROR_URL = null;

/* ===== (추가) fetch helper: JSON + 429 재시도 ===== */
async function fetchJsonWithRetry(url, { retries = 4, baseDelay = 800, signal } = {}) {
  let attempt = 0;
  while (true) {
    let res;
    try {
      res = await fetch(url, { signal, headers: { 'Accept': 'application/json' } });
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

/* ===== reCAPTCHA v3 (모듈 아님 버전) ===== */

// ✅ window.__RECAPTCHA_KEY로 사이트키를 주입받음 (index.html에서 설정)
const RECAPTCHA_SITE_KEY = window.__RECAPTCHA_KEY || "YOUR_FALLBACK_KEY";

// ✅ v3 준비 대기
function waitRecaptchaReady() {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function tick() {
      if (window.grecaptcha && typeof window.grecaptcha.ready === "function") {
        return window.grecaptcha.ready(() => resolve());
      }
      if (Date.now() - start > 8000) {
        return reject(new Error("reCAPTCHA load timeout"));
      }
      setTimeout(tick, 50);
    })();
  });
}

async function verifyRecaptcha(action = "submit") {
  try {
    await waitRecaptchaReady();

    const token = await grecaptcha.execute(RECAPTCHA_SITE_KEY, { action });
    console.log("🎯 새로 받은 token:", token);

    if (!token) {
      console.error("⚠️ reCAPTCHA token 생성 실패 (null)");
      return { success: false, score: 0 };
    }

    // ✅ 환경별 API 경로 분기
    const verifyUrl = IS_LOCAL
      ? `${API_ROOT}/api/recaptcha/verify`   // 로컬 (http://localhost:3000/api/recaptcha/verify)
      : `${API_ROOT}/recaptcha/verify`;      // 배포 (/api/recaptcha/verify)

    const res = await fetch(verifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });

    const text = await res.text();
    console.log("🧾 서버 응답(raw):", text);

    const data = JSON.parse(text);
    return { success: data.success, score: data.score || 0 };
  } catch (err) {
    console.error("❌ reCAPTCHA 통신 오류:", err);
    return { success: false, score: 0 };
  }
}


/* ===== 정규화 유틸 ===== */
const PREC = 4;
const roundN = v => Number(v.toFixed(PREC));
const clamp01 = v => Math.max(0, Math.min(1, v));
const distN = (x1,y1,x2,y2) => Math.hypot(x1-x2, y1-y2);

/* ===== 시선/정답 판정 파라미터 ===== */
// 기준 반경(정규화)
const GAZE_R_N = 0.10;

// 반경 멀티플라이어: “시선 > 정답(클릭)”
let CLICK_R_MULT = 0.2;  // 정답(클릭) 허용 반경 멀티
let GAZE_R_MULT  = 1.30;  // 시선 dwell/entry 반경 멀티(더 큼)

const rEffClick = () => GAZE_R_N * CLICK_R_MULT;  // 검정 링
const rEffGaze  = () => GAZE_R_N * GAZE_R_MULT;   // 파랑 링

let GAZE_DWELL_MS = 140;
let GAZE_WIN_BEFORE_MS = 200;
let GAZE_WIN_AFTER_MS  = 200;

// (선택) 캠핑 방지
const ENABLE_ENTRY_RULE  = false;
const ENTRY_WINDOW_MS    = 600;
const ENTRY_INNER_R_N    = GAZE_R_N / 2; // 기본값(실제 호출에서는 rEffGaze()/2 사용)

/* 다운로드 동작 옵션 */
const DOWNLOAD_COMBINED_ONLY = false;

/* ===== 시간 보정(옵션) ===== */
let CLICK_T_OFFSET_MS  = 0;   // 클릭 시간 보정
let ANSWER_T_OFFSET_MS = 0;   // 정답 시간 보정

/* ===== 정답 ===== */
// /video-data 의 answer가 배열/중첩배열/객체 혼합이어도 {xn,yn,t} 배열로 평탄화
// ▶ 요구사항: 정답에는 항상 t가 존재하므로, t 없는 항목은 버림
function normalizeAnswer(ans) {
  const pts = [];
  (function walk(x) {
    if (!x) return;
    if (Array.isArray(x)) {
      x.forEach(walk);
    } else if (typeof x === 'object') {
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

let ANSWER = [];  // [{xn,yn,t}, ...] 로 유지

/* ===== 상태 ===== */
let isCalibrationMode = false;
let eyeTracker = null;
let isTracking = false;
let calibrationButton, saveDataButton, submitButton, resetButton;

let isRecording = true;
let videoStarted = false;

let isDrawingMode = false;
let uploadedGaze = null, uploadedClicks = null;
let jsonUploader, uploadButton, drawButton, cancelDrawButton, uploadName;

/* ===== 데이터 ===== */
let gazeDataArray = [];
let clickDataArray = [];

/* 재생 상태 */
let playbackRaf = null;
let lastVideoTimeMs = 0;

/* 클릭 토글 반경(정규화) */
const CLICK_TOGGLE_RADIUS_N = 0.025;

/* 디버그 모듈 핸들 */
let debug = null;

/* ===== Canvas helpers ===== */
function getCanvas() { return document.getElementById('output'); }
function getCtx() { return getCanvas().getContext('2d'); }
function sizeCanvasToWindow() { const c=getCanvas(); c.width=window.innerWidth; c.height=window.innerHeight; }
function clearCanvas() { const c=getCanvas(); const ctx=getCtx(); ctx.clearRect(0,0,c.width,c.height); }

/* ===== 좌표 변환: "비디오 박스" 기준 ===== */
function getVideoRect() {
  const v = document.getElementById('myVideo');
  return v.getBoundingClientRect();
}
// 윈도우 좌표(px) -> 비디오 정규화(0~1)
function winP2videoN(px, py) {
  const r = getVideoRect();
  const xn = (px - r.left) / r.width;
  const yn = (py - r.top)  / r.height;
  return { xn: clamp01(roundN(xn)), yn: clamp01(roundN(yn)) };
}
// 비디오 정규화(0~1) -> 윈도우 캔버스 좌표(px)
function videoN2canvasP(xn, yn) {
  const r = getVideoRect();
  return { x: r.left + xn * r.width, y: r.top + yn * r.height };
}

/* ===== Drawing ===== */
function drawDotRGBA(x,y,r,rgba){
  const ctx=getCtx(); ctx.fillStyle=rgba;
  ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
}
function drawDotNorm(xn,yn,r,rgba){
  const {x,y}=videoN2canvasP(xn,yn);
  drawDotRGBA(x,y,r,rgba);
}
// 재생용 십자가
function drawClickCross(x,y,color='blue',size=6,lineWidth=2){
  const ctx=getCtx();
  ctx.beginPath();
  ctx.moveTo(x-size,y); ctx.lineTo(x+size,y);
  ctx.moveTo(x,y-size); ctx.lineTo(x,y+size);
  ctx.lineWidth=lineWidth; ctx.strokeStyle=color; ctx.stroke();
}
function drawCrossNorm(xn,yn,color='blue',size=6,lineWidth=2){
  const {x,y}=videoN2canvasP(xn,yn);
  drawClickCross(x,y,color,size,lineWidth);
}

/* ===== UI helpers ===== */
function placeSubmitInline(){
  if (!submitButton) return;
  Object.assign(submitButton.style,{position:'static',right:'',bottom:'',zIndex:'',marginLeft:'10px'});
}
function placeResetInline(){
  if (!resetButton) return;
  Object.assign(resetButton.style,{position:'static',right:'',bottom:'',zIndex:'',marginLeft:'10px'});
}

// hidden-init(!important) 영향 제거하며 표시
function setActionButtonsVisible(show){
  const ids = ['submitButton', 'resetButton'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (show) {
      el.classList.remove('hidden-init');
      el.style.display = 'inline-block';
    } else {
      el.style.display = 'none';
    }
  });
}

// 우하단 도크(업로드/그리기/Save&Play)
function ensureRightDock(){
  let dock=document.getElementById('rightDock');
  if(!dock){
    dock=document.createElement('div');
    dock.id='rightDock';
    Object.assign(dock.style,{
      position:'fixed', right:'24px', bottom:'24px',
      display:'flex', gap:'12px', alignItems:'center', zIndex:'10002'
    });
    document.body.appendChild(dock);
  }
  while (dock.firstChild) dock.removeChild(dock.firstChild);

  if (uploadName){
    Object.assign(uploadName.style,{
      maxWidth:'28vw', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis',
      fontSize:'14px', background:'rgba(255,255,255,0.9)', padding:'4px 8px', borderRadius:'6px',
      display: uploadName.style.display==='none' ? 'none' : 'inline-block'
    });
  }

  const add = (el)=>{ if(!el || el.style.display==='none') return; el.style.position='static'; el.style.margin='0'; el.style.zIndex=''; dock.appendChild(el); };
  add(uploadName); add(uploadButton); add(drawButton); add(cancelDrawButton); add(saveDataButton);
}
function refreshDockStates(){
  const hasUpload = !!(uploadedGaze?.length || uploadedClicks?.length);
  if (drawButton)       drawButton.disabled       = !hasUpload;
  if (cancelDrawButton) cancelDrawButton.disabled = !isDrawingMode;
}

/* ===== 캘리브레이션 ===== */
let currentX=0, currentY=0;

function onClickCalibrationBtn(){
  if (isCalibrationMode) return;
  setActionButtonsVisible(false);
  const t=document.getElementById('calibrationTitle'); if (t) t.remove();

  isCalibrationMode=true;

  const canvas=getCanvas();
  canvas.style.display='block';
  eyeTracker.hideImage();

  const focusText=showFocusText();
  setTimeout(()=>{
    hideFocusText(focusText);
    eyeTracker.startCalibration(onCalibrationNextPoint,onCalibrationProgress,onCalibrationFinished);
  },2000);

  calibrationButton.style.display='none';
  const video=document.getElementById('myVideo'); if (video) video.style.display='none';
}
function onCalibrationNextPoint(x,y){ currentX=x; currentY=y; sizeCanvasToWindow(); clearCanvas(); drawCircle(x,y,dotMinSize,getCtx()); eyeTracker.startCollectSamples(); }
function onCalibrationProgress(progress){ sizeCanvasToWindow(); clearCanvas(); const s=dotMinSize+(dotMaxSize-dotMinSize)*progress; drawCircle(currentX,currentY,s,getCtx()); }
function onCalibrationFinished(){
  clearCanvas();
  isCalibrationMode=false;
  calibrationButton.style.display='none';
  eyeTracker.showImage(); isTracking=true;

  if (saveDataButton) saveDataButton.style.display='inline-block';

  resetRecording();
  isRecording=true;

  const video=document.getElementById('myVideo');
  if (video){ video.style.display='block'; video.play(); }
  document.getElementById('overlayText').style.display='block';

  placeSubmitInline();
  placeResetInline();
  setActionButtonsVisible(true);

  if (uploadButton)      uploadButton.style.display='inline-block';
  if (drawButton)        drawButton.style.display='inline-block';
  if (cancelDrawButton)  cancelDrawButton.style.display='inline-block';
  if (uploadName)        uploadName.style.display=(uploadedGaze?.length||uploadedClicks?.length)?'inline-block':'none';

  isDrawingMode=false;
  refreshDockStates();
  ensureRightDock();
}
function drawCircle(x,y,r,ctx){ ctx.fillStyle='rgba(255,0,0,0.5)'; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill(); }
function showFocusText(){ const el=document.createElement('div'); el.innerText='Focus on point'; Object.assign(el.style,{position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',zIndex:'10003'}); document.body.appendChild(el); return el; }
function hideFocusText(el){ if (el?.parentNode) el.parentNode.removeChild(el); }

/* ===== 녹화 중 오버레이 ===== */
function renderRecordingOverlay(){
  if (isCalibrationMode) return;
  if (!isRecording || !videoStarted) return;
  clearCanvas();

  // 항상 tolerance_debug 오버레이 먼저 렌더링
  if (debug) debug.renderOverlay();

  // 시선 점
  if (gazeDataArray.length){
    const last = gazeDataArray[gazeDataArray.length-1];
    drawDotNorm(last.xn,last.yn,8,'rgba(255,0,0,1)');
  }

  // 클릭 점
  for (const c of clickDataArray) {
    drawDotNorm(c.xn,c.yn,6,'rgba(0,0,255,0.5)');
  }

  // (선택) 16ms 간격으로 주기적 갱신
  requestAnimationFrame(renderRecordingOverlay);
}

/* ===== 시선 콜백 (비디오 기준 정규화) ===== */
function onGaze(gazeInfo){
  if (isCalibrationMode || !videoStarted || !isRecording) return;

  // SeeSo가 주는 윈도우 좌표 → 비디오 정규화(0~1)
  const { xn, yn } = winP2videoN(gazeInfo.x, gazeInfo.y);
  if (Number.isNaN(xn) || Number.isNaN(yn)) return;

  const video = document.getElementById('myVideo');
  const tv = Math.round((video?.currentTime || 0) * 1000);

  gazeDataArray.push({ t: Date.now(), tv, xn, yn });
  renderRecordingOverlay();
}

/* ===== 클릭(왼쪽=추가, 오른쪽=삭제) : 비디오 기준 정규화 ===== */
function addCanvasClickListener(video){
  const canvas=getCanvas();
  canvas.style.pointerEvents='auto';

  // 우클릭 기본 메뉴 막기
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // 버튼 기반으로 분기: 0=좌, 2=우
  canvas.addEventListener('mousedown', e => {
    if (!isRecording) return;

    // 윈도우 좌표 → 비디오 정규화
    const { xn, yn } = winP2videoN(e.clientX, e.clientY);
    const tVideoMs = Math.round((video?.currentTime||0)*1000);

    if (e.button === 0) {
      // 왼쪽 클릭 → 항상 추가
      const newClick = { t:tVideoMs, xn, yn };
      clickDataArray.push(newClick);
      renderRecordingOverlay();
      if (debug) debug.onClickAdded(newClick);
    } else if (e.button === 2) {
      // 오른쪽 클릭 → 가장 가까운 클릭 삭제
      const idx=findNearestClickIndex(xn,yn,CLICK_TOGGLE_RADIUS_N);
      if (idx!==-1){
        clickDataArray.splice(idx,1);
        renderRecordingOverlay();
        if (debug) debug.onClickDeleted();
      }
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

/* ===== 저장 전 토글/중복 정리 ===== */
// 오타 수정 반영: o.xn - c.xn
function dedupToggle(arr,rN=0.015,winMs=700){
  const out=[];
  for (const c of arr){
    const i=out.findIndex(o =>
      Math.abs((o.t|0)-(c.t|0))<=winMs &&
      Math.hypot((o.xn)-(c.xn),(o.yn)-(c.yn))<=rN
    );
    if (i>=0) out.splice(i,1); else out.push(c);
  }
  return out;
}

/* ===== Gaze 판정 유틸 ===== */
function dwellNearClick(click, gaze, rN=GAZE_R_N, before=GAZE_WIN_BEFORE_MS, after=GAZE_WIN_AFTER_MS, need=GAZE_DWELL_MS){
  const clickT = (click.t|0) + CLICK_T_OFFSET_MS;
  const start = clickT - before;
  const end   = clickT + after;
  let dwell = 0;

  for (let i=1; i<gaze.length; i++){
    const g0 = gaze[i-1], g1 = gaze[i];
    const t0 = (g0.tv|0); // gaze는 영상시계(tv)를 사용
    const t1 = (g1.tv|0);
    if (t1 < start || t0 > end) continue;

    const in0 = distN(g0.xn, g0.yn, click.xn, click.yn) <= rN;
    const in1 = distN(g1.xn, g1.yn, click.xn, click.yn) <= rN;

    if (in0 || in1){
      const segStart = Math.max(t0, start);
      const segEnd   = Math.min(t1, end);
      dwell += Math.max(0, segEnd - segStart);
      if (dwell >= need) return true;
    }
  }
  return false;
}
function entryRuleRecentIn(click, gaze, r_in=ENTRY_INNER_R_N, win=ENTRY_WINDOW_MS){
  if (!ENABLE_ENTRY_RULE) return true;
  const clickT = (click.t|0) + CLICK_T_OFFSET_MS;
  const start = clickT - win, end = clickT;
  let prev = null;
  for (let i=0; i<gaze.length; i++){
    const g = gaze[i];
    const tv = (g.tv|0);
    if (tv < start) { prev = g; continue; }
    if (tv > end) break;

    if (prev){
      const outPrev = distN(prev.xn, prev.yn, click.xn, click.yn) > r_in;
      const inNow   = distN(g.xn,    g.yn,    click.xn, click.yn) <= r_in;
      if (outPrev && inNow) return true;
    }
    prev = g;
  }
  return false;
}

/* ===== 클릭과 정답의 시간+공간 매칭 (시간 무조건 필요) ===== */
function nearestAnswerForClick(click, answers, rN, before=GAZE_WIN_BEFORE_MS, after=GAZE_WIN_AFTER_MS){
  const clickT = (click.t|0) + CLICK_T_OFFSET_MS;
  const tMin = clickT - before;
  const tMax = clickT + after;

  let best = null, bestDist = Infinity;

  for (const a of (answers||[])) {
    // ⛔ 정답에 시간이 없으면 비교/매칭 불가 (요구사항에 따라 항상 t가 있어야 함)
    if (a?.t == null) continue;

    const at = (a.t|0) + ANSWER_T_OFFSET_MS;

    // ⛔ 시간창 밖이면 바로 탈락
    if (at < tMin || at > tMax) continue;

    // ✅ 거리 비교
    const d = distN(click.xn, click.yn, Number(a.xn), Number(a.yn));
    if (d < bestDist) { bestDist = d; best = a; }
  }

  return (best && bestDist <= rN) ? best : null;
}

/* ===== 공통 유틸 ===== */
const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function downloadJsonAsync(filename, payload){
  return new Promise((resolve) => {
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);

    a.click();
    requestAnimationFrame(() => {
      setTimeout(() => {
        setTimeout(() => {
          URL.revokeObjectURL(a.href);
          a.remove();
        }, 2000);
        resolve();
      }, 200);
    });
  });
}
function downloadJson(filename, payload){
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1200);
}
function tsForFile(){ return new Date().toISOString().replace(/[:.]/g, '-'); }

/* (A) 두 파일 저장 후 이동 */
async function saveTwoFilesThenNavigate(gazeArr, clicksArr, url){
  const ts = tsForFile();
  downloadJson(`gaze_at_submit_${ts}.json`, gazeArr);
  await delay(350);
  downloadJson(`clicks_at_submit_${ts}.json`, clicksArr);
  await delay(500);
  window.location.href = url;
}
/* (B) 합본 저장 후 이동 */
async function saveCombinedThenNavigate(gazeArr, clicksArr, url){
  const ts = tsForFile();
  downloadJson(`gaze_clicks_at_submit_${ts}.json`, { gaze: gazeArr, clicks: clicksArr });
  await delay(650);
  window.location.href = url;
}
/* Save&Play와 동일 파일명으로 저장 후 이동 */
async function saveExactlyLikeSaveAndPlayThenNavigate(gazeArr, clicksArr, url){
  await downloadJsonAsync('gaze.json',  gazeArr);
  await delay(300);
  await downloadJsonAsync('clicks.json', clicksArr);
  await delay(800);
  window.location.href = url;
}

/* ===== Save & Play ===== */
// 저장 파일에는 '원본 클릭 전부'를 그대로 저장 (dedup 미적용)
function saveGazeData(){
  isRecording = false;

  const clicksForSave = clickDataArray.slice();

  const gazeBlob = new Blob([JSON.stringify(gazeDataArray)], { type: 'application/json' });
  const a1 = document.createElement('a'); a1.href = URL.createObjectURL(gazeBlob); a1.download = 'gaze.json'; a1.click();

  const clicksBlob = new Blob([JSON.stringify(clicksForSave)], { type: 'application/json' });
  const a2 = document.createElement('a'); a2.href = URL.createObjectURL(clicksBlob); a2.download = 'clicks.json'; a2.click();

  clearCanvas();

  const video = document.getElementById('myVideo');
  if (video) video.loop = true;
  startPlayback();

  if (saveDataButton){ saveDataButton.disabled = true; saveDataButton.textContent = 'Saved & Playing'; }
}

/* ===== 제출 처리 ===== */
async function onSubmit() {
  // 🔐 reCAPTCHA 검증
  const { success, score } = await verifyRecaptcha('submit');
  console.log("🧠 reCAPTCHA 결과:", { success, score });

  // ✅ 1. reCAPTCHA 통신 오류
  if (!success) {
    alert("❌ reCAPTCHA 통신 오류. 다시 시도해주세요.");
    await fullReset();
    return;
  }

  // ✅ 2. 점수 기준 (0.5 미만이면 차단)
  if (score < 0.5) {
    console.warn(`⚠️ 낮은 점수(${score}), 로봇 의심`);
    await fullReset();
    return;
  }

  console.log("✅ reCAPTCHA 통과 — 사람으로 판정됨 (score:", score, ")");

  // ✅ 3. CAPTCHA 실제 통과 로직
  const cleaned = dedupToggle(clickDataArray.slice());

  const R_CLICK = rEffClick();  // 클릭-정답 근접 판정 반경(검정)
  const R_GAZE  = rEffGaze();   // 시선 dwell/entry 판정 반경(파랑)

  const passed = cleaned.some(c => {
    const matched = nearestAnswerForClick(
      c, ANSWER, R_CLICK, GAZE_WIN_BEFORE_MS, GAZE_WIN_AFTER_MS
    );
    return (
      !!matched &&
      dwellNearClick(c, gazeDataArray, R_GAZE,
                     GAZE_WIN_BEFORE_MS, GAZE_WIN_AFTER_MS, GAZE_DWELL_MS) &&
      entryRuleRecentIn(c, gazeDataArray, R_GAZE / 2, ENTRY_WINDOW_MS)
    );
  });

  // ✅ 4. 정답 클릭 통과 시 → 성공 페이지 이동
  if (passed) {

    if (DOWNLOAD_COMBINED_ONLY) {
      await saveCombinedThenNavigate(gazeDataArray, cleaned, SUCCESS_URL);
    } else {
      await saveExactlyLikeSaveAndPlayThenNavigate(gazeDataArray, cleaned, SUCCESS_URL);
    }
  } else {
    await fullReset();
  }
}


/* ===== 재생 ===== */
function startPlayback(){
  const canvas=getCanvas(); const ctx=getCtx(); const video=document.getElementById('myVideo');
  if (!canvas||!ctx) return;

  gazeDataArray.sort((a,b)=>a.t-b.t);
  clickDataArray.sort((a,b)=>a.t-b.t);

  let gazePtr=0, clickPtr=0;
  const shownTrail=[], shownClicks=[];
  const gazeBaseAbs=gazeDataArray.length?gazeDataArray[0].t:null;
  const t0=performance.now();

  lastVideoTimeMs=Math.round((video?.currentTime||0)*1000);

  const render=()=>{
    const elapsed=performance.now()-t0;

    if (gazeBaseAbs!==null){
      while (gazePtr<gazeDataArray.length && (gazeDataArray[gazePtr].t-gazeBaseAbs)<=elapsed){
        shownTrail.push(gazeDataArray[gazePtr++]);
      }
    }

    const nowMs=Math.round((video?.currentTime||0)*1000);
    if (nowMs<lastVideoTimeMs){ clickPtr=0; shownClicks.length=0; }
    lastVideoTimeMs=nowMs;
    while (clickPtr<clickDataArray.length && clickDataArray[clickPtr].t<=nowMs){
      shownClicks.push(clickDataArray[clickPtr++]);
    }

    clearCanvas();
    for (const g of shownTrail) drawDotNorm(g.xn,g.yn,8,'rgba(255,0,0,0.5)');
    for (const c of shownClicks) drawCrossNorm(c.xn,c.yn,'blue',6,2); // 재생 시엔 십자가

    // tolerance_debug 오버레이
    if (debug) debug.renderOverlay();

    playbackRaf=requestAnimationFrame(render);
  };

  if (playbackRaf) cancelAnimationFrame(playbackRaf);
  playbackRaf=requestAnimationFrame(render);
}

/* ===== 유틸: 새 세션 리셋 ===== */
function resetRecording(){ gazeDataArray=[]; clickDataArray=[]; lastVideoTimeMs=0; clearCanvas(); }

/* === “그리기 취소” */
async function cancelDraw(){
  if (playbackRaf){ cancelAnimationFrame(playbackRaf); playbackRaf=null; }
  clearCanvas();

  isDrawingMode=false;
  resetRecording();
  isRecording=true;
  if (submitButton) submitButton.disabled=false;

  const video=document.getElementById('myVideo');
  if (video){
    try{ video.pause(); }catch{}
    video.currentTime=0;
    try{ await video.play(); }catch{}
  }

  if (eyeTracker && !isTracking){
    try { await eyeTracker.startTracking(onGaze, ()=>{}); isTracking=true; }
    catch (e) { console.error('❌ startTracking 실패:', e); }
  }

  refreshDockStates();
  ensureRightDock();
}

async function fullReset(){
  isDrawingMode=false;
  if (submitButton) submitButton.disabled=false;
  if (playbackRaf){ cancelAnimationFrame(playbackRaf); playbackRaf=null; }

  resetRecording(); isRecording=true;

  const video=document.getElementById('myVideo');

  try{
    // 429 재시도 + videoPath 지원
    const data = await fetchJsonWithRetry(`${API_ROOT}/video-data`);

    ANSWER = normalizeAnswer(data.answer); // t 없는 항목은 normalize에서 버림
    const srcPath = data.videoPath ? data.videoPath.replace(/^\/+/, '') : `video/${data.id}`;
    video.src = `${API_ROOT}/${srcPath}?ts=${Date.now()}`;

    const overlay=document.getElementById('overlayText');
    overlay.textContent=data.question;

    placeSubmitInline(); placeResetInline(); setActionButtonsVisible(true);
  }catch(e){
    console.error('❌ /video-data 재호출 실패', e);
  }

  if (saveDataButton){
    saveDataButton.disabled=false;
    saveDataButton.textContent='Save & Play';
    saveDataButton.style.display='inline-block';
  }

  uploadedGaze=null; uploadedClicks=null;
  if (jsonUploader) jsonUploader.value='';
  if (uploadButton) uploadButton.style.display='inline-block';
  if (drawButton){ drawButton.style.display='inline-block'; }
  if (cancelDrawButton){ cancelDrawButton.style.display='inline-block'; }
  if (uploadName){ uploadName.textContent=''; uploadName.style.display='none'; }

  refreshDockStates();
  ensureRightDock();
}

/* ===== 업로드 처리(선택) ===== */
async function loadJsonFilesFromInput(files){
  uploadedGaze=null; uploadedClicks=null;

  const arr=Array.from(files||[]);
  for (const file of arr){
    let parsed=null;
    try{ parsed=JSON.parse(await file.text()); }catch(e){ console.warn('❗ JSON 파싱 실패:', file.name, e); continue; }
    if (!Array.isArray(parsed)) continue;

    const name=(file.name||'').toLowerCase();
    if (name.includes('gaze')) uploadedGaze=parsed;
    else if (name.includes('click')) uploadedClicks=parsed;
    else {
      const maxT=Math.max(...parsed.map(o=>Number(o?.t)||0));
      if (maxT>1e9) uploadedGaze=parsed; else uploadedClicks=parsed;
    }
  }

  if (drawButton){ drawButton.style.display='inline-block'; }
  if (uploadButton){ uploadButton.style.display='inline-block'; }

  if (uploadName){
    const names=arr.map(f=>f.name);
    let label='';
    if (names.length===1) label=names[0];
    else if (names.length===2) label=`${names[0]}, ${names[1]}`;
    else if (names.length>2) label=`${names[0]}, ${names[1]} 외 ${names.length-2}개`;
    uploadName.textContent=label||'';
    uploadName.style.display = label ? 'inline-block':'none';
  }

  refreshDockStates();
  ensureRightDock();
}

/* ===== 업로드 데이터 재생(그리기 모드) ===== */
function startDrawPlayback(){
  if (!((uploadedGaze&&uploadedGaze.length)||(uploadedClicks&&uploadedClicks.length))) return;

  isDrawingMode=true;
  isRecording=false;
  const canvas=getCanvas(); if (canvas) canvas.style.display='block';
  clearCanvas();
  if (submitButton) submitButton.disabled=true;

  const video=document.getElementById('myVideo');
  if (video){ try{video.pause();}catch{} video.currentTime=0; video.play(); }

  const gArr=Array.isArray(uploadedGaze)?uploadedGaze:[];   // 절대시간 기반
  const cArr=Array.isArray(uploadedClicks)?uploadedClicks:[];// 영상 시간 기반
  startPlaybackCustom(gArr,cArr);

  refreshDockStates();
  ensureRightDock();
}
function startPlaybackCustom(gArr,cArr){
  const canvas=getCanvas(); const ctx=getCtx(); const video=document.getElementById('myVideo');
  if (!canvas||!ctx) return;

  const gaze=Array.isArray(gArr)?gArr.slice().sort((a,b) => (a.t|0)-(b.t|0)):[];
  const clicks=Array.isArray(cArr)?cArr.slice().sort((a,b) => (a.t|0)-(b.t|0)):[];
  let gazePtr=0, clickPtr=0; const shownTrail=[], shownClicks=[];
  const gazeBaseAbs=gaze.length?(gaze[0].t|0):null;
  const t0=performance.now();

  lastVideoTimeMs=Math.round((video?.currentTime||0)*1000);

  const render=()=>{
    const elapsed=performance.now()-t0;

    if (gazeBaseAbs!==null){
      while (gazePtr<gaze.length && ((gaze[gazePtr].t|0)-gazeBaseAbs)<=elapsed){
        shownTrail.push(gaze[gazePtr++]);
      }
    }

    const nowMs=Math.round((video?.currentTime||0)*1000);
    if (nowMs<lastVideoTimeMs){ clickPtr=0; shownClicks.length=0; }
    lastVideoTimeMs=nowMs;

    while (clickPtr<clicks.length && (clicks[clickPtr].t|0)<=nowMs){
      shownClicks.push(clicks[clickPtr++]);
    }

    clearCanvas();
    for (const g of shownTrail) drawDotNorm(Number(g.xn),Number(g.yn),8,'rgba(255,0,0,0.5)');
    for (const c of shownClicks) drawCrossNorm(Number(c.xn),Number(c.yn),'blue',6,2);

    // tolerance_debug 오버레이
    if (debug) debug.renderOverlay();

    playbackRaf=requestAnimationFrame(render);
  };

  if (playbackRaf) cancelAnimationFrame(playbackRaf);
  playbackRaf=requestAnimationFrame(render);
}

/* ===== 초기화 ===== */
(async ()=>{
  try{
    // 429 재시도 + videoPath 지원
    const data = await fetchJsonWithRetry(`${API_ROOT}/video-data`);
    // 정답 평탄화(t 없는 항목은 버림)
    ANSWER = normalizeAnswer(data.answer);

    const video=document.getElementById('myVideo');

    video.addEventListener('loadeddata', ()=>{ placeSubmitInline(); placeResetInline(); });

    video.addEventListener('playing', async ()=>{
      videoStarted=true;
      if (eyeTracker && !isTracking){
        try{ await eyeTracker.startTracking(onGaze, ()=>{}); isTracking=true; }
        catch(e){ console.error('❌ startTracking 실패:', e); }
      }
    });

    video.addEventListener('pause', async ()=>{
      if (eyeTracker && isTracking){
        await eyeTracker.stopTracking();
        isTracking=false;
      }
    });

    // 절대경로 + 캐시깨기 (videoPath 우선)
    const srcPath = data.videoPath ? data.videoPath.replace(/^\/+/, '') : `video/${data.id}`;
    video.src = `${API_ROOT}/${srcPath}?ts=${Date.now()}`;

    const overlay=document.getElementById('overlayText');
    overlay.textContent=data.question;

    addCanvasClickListener(video);
  }catch(e){
    console.error('❌ DB에서 영상/텍스트 로딩 실패', e);
  }

  // DOM 바인딩
  calibrationButton=document.getElementById('calibrationButton');
  calibrationButton.addEventListener('click', onClickCalibrationBtn);
  calibrationButton.disabled=true;

  saveDataButton=document.getElementById('saveDataButton');
  if (saveDataButton){
    saveDataButton.textContent='Save & Play';
    saveDataButton.addEventListener('click', saveGazeData);
  }

  jsonUploader     = document.getElementById('jsonUploader');
  uploadButton     = document.getElementById('uploadButton');
  drawButton       = document.getElementById('drawButton');
  cancelDrawButton = document.getElementById('cancelDrawButton');
  uploadName       = document.getElementById('uploadName');

  if (uploadButton){
    uploadButton.style.display='none';
    uploadButton.addEventListener('click', ()=> jsonUploader?.click());
  }
  if (jsonUploader){
    jsonUploader.addEventListener('change', (e)=> loadJsonFilesFromInput(e.target.files));
  }
  if (drawButton){
    drawButton.style.display='none';
    drawButton.disabled=true;
    drawButton.addEventListener('click', startDrawPlayback);
  }
  if (cancelDrawButton){
    cancelDrawButton.style.display='none';
    cancelDrawButton.disabled=true;
    cancelDrawButton.addEventListener('click', cancelDraw);
  }
  if (uploadName) uploadName.style.display='none';

  submitButton=document.getElementById('submitButton');
  if (submitButton){
    placeSubmitInline();
    submitButton.style.display='none'; // 초기 숨김(의도)
    submitButton.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { await onSubmit(); } catch (err) { console.error(err); }
    });
  }

  resetButton=document.getElementById('resetButton');
  if (resetButton){
    placeResetInline();
    resetButton.style.display='none'; // 초기 숨김(의도)
    resetButton.addEventListener('click', fullReset);
  }

  eyeTracker = new EasySeeSo();
  await eyeTracker.init(
    licenseKey,
    async () => {
      console.log("✅ SeeSo 초기화 성공");
      await eyeTracker.startTracking(onGaze, () => {});
      isTracking = true;
      eyeTracker.showImage();
      calibrationButton.disabled = false;
      sizeCanvasToWindow();
    },
    () => {
      console.log("❌ SeeSo 초기화 실패");
      if (CAMERA_ERROR_URL) {
        window.location.href = CAMERA_ERROR_URL;
      }
    }
  );

  // tolerance_debug 초기화 (DOM 준비 후)
  debug = initToleranceDebug({
    getAnswerPoints: () => ANSWER,
    videoN2canvasP,
    getVideoRect,
    getCtx,
    getLastGazePoint: () => gazeDataArray.length ? gazeDataArray[gazeDataArray.length-1] : null,

    // 반경 파라미터(분리)
    getGAZE_R_N: () => GAZE_R_N,

    getCLICK_R_MULT: () => CLICK_R_MULT,
    setCLICK_R_MULT: (v) => { CLICK_R_MULT = v; },

    getGAZE_R_MULT: () => GAZE_R_MULT,
    setGAZE_R_MULT: (v) => { GAZE_R_MULT = v; },

    getDWELL_MS: () => GAZE_DWELL_MS,
    setDWELL_MS: (v) => { GAZE_DWELL_MS = v; },

    getWIN_BEFORE_MS: () => GAZE_WIN_BEFORE_MS,
    setWIN_BEFORE_MS: (v) => { GAZE_WIN_BEFORE_MS = v; },

    getWIN_AFTER_MS: () => GAZE_WIN_AFTER_MS,
    setWIN_AFTER_MS: (v) => { GAZE_WIN_AFTER_MS = v; },

    getENTRY_MS: () => ENTRY_WINDOW_MS,

    getClickToggleR_N: () => CLICK_TOGGLE_RADIUS_N,
  });

  window.addEventListener('resize', sizeCanvasToWindow);
  sizeCanvasToWindow();
})();
