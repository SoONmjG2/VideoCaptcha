// user_index.js 
import 'regenerator-runtime/runtime';
import EasySeeSo from 'seeso/easy-seeso'

/* ===== 환경 분기 ===== */
// localhost/127.0.0.1 또는 *.local, file:// 은 로컬로 간주
const IS_LOCAL =
  ['localhost', '127.0.0.1'].includes(location.hostname) ||
  location.hostname.endsWith('.local') ||
  location.protocol === 'file:';

/* ===== (추가) API ROOT (배포는 /api 프록시) =====
   필요하면 HTML에서 window.__API_ORIGIN 으로 강제 지정 가능 */
const API_ROOT = (() => {
  if (typeof window !== 'undefined' && window.__API_ORIGIN) return window.__API_ORIGIN;
  return IS_LOCAL ? 'http://localhost:3000' : '/api';
})();

/* ===== (추가) fetch helper: JSON + 429 재시도 ===== */
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

/* ===== SeeSo 라이선스 키 ===== */
const SEESO_DEV_KEY  = 'dev_hhc570sz5quc3kk3wvpuvbm2zznc0wow8d5nej6v'; // dev
const SEESO_PROD_KEY = 'prod_muvxi2s8hct25hkzl989rrspxju8fb1lzdhzmoxx'; // prod
const licenseKey = IS_LOCAL ? SEESO_DEV_KEY : SEESO_PROD_KEY;

/* ===== 설정 ===== */
const dotMaxSize = 10;
const dotMinSize = 5;

/* 라우팅 */
const SUCCESS_URL = 'success/success.html';
const CAMERA_ERROR_URL = '/public/camera-error.html';

/* ===== 정규화/수학 유틸 ===== */
const PREC = 4;
const roundN = v => Number(v.toFixed(PREC));
const clamp01 = v => Math.max(0, Math.min(1, v));
const distN = (x1,y1,x2,y2) => Math.hypot(x1-x2, y1-y2);

/* ===== 시선 판정 파라미터 (완화) ===== */
const GAZE_R_N = 0.16;       // 기존 0.11 → 0.16
const GAZE_R_MULT = 1.30;    // 제출시 반경 가중
const rEff = () => GAZE_R_N * GAZE_R_MULT;

const GAZE_DWELL_MS = 140;
const GAZE_WIN_BEFORE_MS = 1000;
const GAZE_WIN_AFTER_MS  = 300;

// (선택) 캠핑 방지
const ENABLE_ENTRY_RULE  = false;
const ENTRY_WINDOW_MS    = 600;
const ENTRY_INNER_R_N    = GAZE_R_N / 2;

/* 다운로드 동작 옵션 */
const DOWNLOAD_COMBINED_ONLY = false;

/* ===== 정답(어떤 구조든 평탄화) ===== */
function normalizeAnswer(ans) {
  const pts = [];
  (function walk(x) {
    if (!x) return;
    if (Array.isArray(x)) x.forEach(walk);
    else if (typeof x === 'object') {
      const xn = Number(x?.xn), yn = Number(x?.yn), t = Number(x?.t);
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
let gazeDataArray = [];   // 비디오 안 샘플만 기록(판정용)
let clickDataArray = [];

/* 재생 상태 */
let playbackRaf = null;
let lastVideoTimeMs = 0;

/* 클릭 토글 반경(정규화) */
const CLICK_TOGGLE_RADIUS_N = 0.025;

/* ===== 캔버스 helpers ===== */
function getCanvas() { return document.getElementById('output'); }
function getCtx() { return getCanvas().getContext('2d'); }
function sizeCanvasToWindow() { const c=getCanvas(); c.width=window.innerWidth; c.height=window.innerHeight; }
function clearCanvas() { const c=getCanvas(); const ctx=getCtx(); ctx.clearRect(0,0,c.width,c.height); }

/* ===== 비디오 사각형 & 좌표 변환 ===== */
function getVideoRect() {
  const v = document.getElementById('myVideo');
  if (!v) return null;
  return v.getBoundingClientRect(); // CSS px 기준
}
function viewportToVideoN(x, y) {
  const r = getVideoRect();
  if (!r) return null;
  const xn = (x - r.left) / r.width;
  const yn = (y - r.top)  / r.height;
  if (xn < 0 || xn > 1 || yn < 0 || yn > 1) return null;
  return { xn, yn };
}
function videoNToViewport(xn, yn) {
  const r = getVideoRect();
  if (!r) return { x: 0, y: 0 };
  return { x: r.left + xn * r.width, y: r.top + yn * r.height };
}

/* ===== 드로잉 ===== */
function drawDotRGBA(x,y,r,rgba){
  const ctx=getCtx(); ctx.fillStyle=rgba;
  ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
}
function drawDotNorm(xn,yn,r,rgba){
  const {x,y}=videoNToViewport(xn,yn);
  drawDotRGBA(x,y,r,rgba);
}
function drawClickCross(x,y,color='blue',size=6,lineWidth=2){
  const ctx=getCtx();
  ctx.beginPath();
  ctx.moveTo(x-size,y); ctx.lineTo(x+size,y);
  ctx.moveTo(x,y-size); ctx.lineTo(x,y+size);
  ctx.lineWidth=lineWidth; ctx.strokeStyle=color; ctx.stroke();
}
function drawCrossNorm(xn,yn,color='blue',size=6,lineWidth=2){
  const {x,y}=videoNToViewport(xn,yn); drawClickCross(x,y,color,size,lineWidth);
}

/* ===== “하나만” 보이는 시선점 ===== */
let lastViewportGaze = null; // 화면(뷰포트) 좌표(시각화용)
let isGazeInVideo = false;   // 현재 프레임 시선이 비디오 내부인지

function drawDotViewport(x, y, r, rgba) { drawDotRGBA(x, y, r, rgba); }

/* ===== UI helpers ===== */
function placeSubmitInline(){
  if (!submitButton) return;
  Object.assign(submitButton.style,{position:'static',right:'',bottom:'',zIndex:'',marginLeft:'10px'});
}
function placeResetInline(){
  if (!resetButton) return;
  Object.assign(resetButton.style,{position:'static',right:'',bottom:'',zIndex:'',marginLeft:'10px'});
}
function setActionButtonsVisible(show){
  const ids = ['submitButton', 'resetButton'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (show) { el.classList.remove('hidden-init'); el.style.display = 'inline-block'; }
    else { el.style.display = 'none'; }
  });
}

/* 도크(선택 기능들 배치) */
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

  if (!isGazeInVideo) {
    if (lastViewportGaze) {
      drawDotViewport(lastViewportGaze.x, lastViewportGaze.y, 8, 'rgba(255,0,0,0.9)');
    }
  } else {
    if (gazeDataArray.length){
      const last=gazeDataArray[gazeDataArray.length-1];
      drawDotNorm(last.xn,last.yn,8,'rgba(255,0,0,1)');
    }
  }
  for (const c of clickDataArray) drawDotNorm(c.xn,c.yn,6,'rgba(0,0,255,0.5)');
}

/* ===== 시선 콜백 ===== */
let gazeSeen = false;
function onGaze(gazeInfo){
  gazeSeen = true; // ✅ 워치독 통과
  if (isCalibrationMode || !videoStarted || !isRecording) return;

  // 화면(뷰포트) 좌표는 항상 기록 → 시각화용
  lastViewportGaze = { x: gazeInfo.x, y: gazeInfo.y, t: Date.now() };

  // 비디오 내부 정규화 (판정/저장용)
  const n = viewportToVideoN(gazeInfo.x, gazeInfo.y);
  isGazeInVideo = !!n;

  const video = document.getElementById('myVideo');
  const tv = Math.round((video?.currentTime || 0) * 1000);

  if (n) {
    const xn = roundN(clamp01(n.xn));
    const yn = roundN(clamp01(n.yn));
    gazeDataArray.push({ t: Date.now(), tv, xn, yn });
  }

  renderRecordingOverlay();
}

/* ===== 클릭(비디오 내부만 기록) ===== */
function addCanvasClickListener(video){
  const canvas=getCanvas();
  canvas.style.pointerEvents='auto';

  canvas.addEventListener('click',e=>{
    if (!isRecording) return;

    const n = viewportToVideoN(e.clientX, e.clientY);
    if (!n) {
      lastViewportGaze = { x: e.clientX, y: e.clientY, t: Date.now() };
      renderRecordingOverlay();
      return;
    }

    const xn=roundN(clamp01(n.xn));
    const yn=roundN(clamp01(n.yn));

    const idx=findNearestClickIndex(xn,yn,CLICK_TOGGLE_RADIUS_N);
    if (idx!==-1){ clickDataArray.splice(idx,1); renderRecordingOverlay(); return; }

    const tVideoMs=Math.round((video?.currentTime||0)*1000);
    clickDataArray.push({ t:tVideoMs, xn, yn });
    renderRecordingOverlay();
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
function dedupToggle(arr,rN=0.015,winMs=700){
  const out=[];
  for (const c of arr){
    const i=out.findIndex(o=>Math.abs(o.t-c.t)<=winMs && Math.hypot(o.xn-c.xn,o.yn-c.yn)<=rN);
    if (i>=0) out.splice(i,1); else out.push(c);
  }
  return out;
}

/* ===== Gaze 판정 유틸 ===== */
function dwellNearClick(click, gaze, rN=GAZE_R_N, before=GAZE_WIN_BEFORE_MS, after=GAZE_WIN_AFTER_MS, need=GAZE_DWELL_MS){
  const start = (click.t|0) - before;
  const end   = (click.t|0) + after;
  let dwell = 0;

  for (let i=1; i<gaze.length; i++){
    const g0 = gaze[i-1], g1 = gaze[i];
    const t0 = (g0.tv|0), t1 = (g1.tv|0);
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
  const start = (click.t|0) - win, end = (click.t|0);
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

/* ===== 공통 유틸/다운로드 ===== */
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

/* 저장 후 이동 */
async function saveTwoFilesThenNavigate(gazeArr, clicksArr, url){
  const ts = tsForFile();
  downloadJson(`gaze_at_submit_${ts}.json`, gazeArr);
  await delay(350);
  downloadJson(`clicks_at_submit_${ts}.json`, clicksArr);
  await delay(500);
  window.location.href = url;
}
async function saveCombinedThenNavigate(gazeArr, clicksArr, url){
  const ts = tsForFile();
  downloadJson(`gaze_clicks_at_submit_${ts}.json`, { gaze: gazeArr, clicks: clicksArr });
  await delay(650);
  window.location.href = url;
}
async function saveExactlyLikeSaveAndPlayThenNavigate(gazeArr, clicksArr, url){
  await downloadJsonAsync('gaze.json',  gazeArr);
  await delay(300);
  await downloadJsonAsync('clicks.json', clicksArr);
  await delay(800);
  window.location.href = url;
}

/* ===== Save & Play ===== */
function saveGazeData(){
  isRecording=false;
  clickDataArray = dedupToggle(clickDataArray);

  const gazeBlob=new Blob([JSON.stringify(gazeDataArray)],{type:'application/json'});
  const a1=document.createElement('a'); a1.href=URL.createObjectURL(gazeBlob); a1.download='gaze.json'; a1.click();

  const clicksBlob=new Blob([JSON.stringify(clickDataArray)],{type:'application/json'});
  const a2=document.createElement('a'); a2.href=URL.createObjectURL(clicksBlob); a2.download='clicks.json'; a2.click();

  clearCanvas();

  const video=document.getElementById('myVideo');
  if (video) video.loop=true;
  startPlayback();

  if (saveDataButton){ saveDataButton.disabled=true; saveDataButton.textContent='Saved & Playing'; }
}

/* ===== 제출 처리 ===== */
function nearAnswer(c, A, rN){
  return (A||[]).some(a => distN(c.xn, c.yn, Number(a.xn), Number(a.yn)) <= rN);
}
async function onSubmit(){
  const cleaned = dedupToggle(clickDataArray.slice());
  const EFFECTIVE_R_N = rEff();

  const passed = cleaned.some(c =>
    nearAnswer(c, ANSWER, EFFECTIVE_R_N) &&
    dwellNearClick(c, gazeDataArray, EFFECTIVE_R_N, GAZE_WIN_BEFORE_MS, GAZE_WIN_AFTER_MS, GAZE_DWELL_MS) &&
    entryRuleRecentIn(c, gazeDataArray, EFFECTIVE_R_N/2, ENTRY_WINDOW_MS)
  );

  if (passed) {
    if (DOWNLOAD_COMBINED_ONLY) {
      await saveCombinedThenNavigate(gazeDataArray, cleaned, SUCCESS_URL);
    } else {
      await saveExactlyLikeSaveAndPlayThenNavigate(gazeDataArray, cleaned, SUCCESS_URL);
    }
  } else {
    await fullReset(); // 오답은 저장 없이 리셋
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
    for (const c of shownClicks) drawCrossNorm(c.xn,c.yn,'blue',6,2);

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
    /* ▼▼▼ 교체: API_ROOT + 재시도 + videoPath 지원 ▼▼▼ */
    const data = await fetchJsonWithRetry(`${API_ROOT}/video-data`);

    ANSWER = normalizeAnswer(data.answer);

    const srcPath = data.videoPath ? data.videoPath.replace(/^\/+/, '') : `video/${data.id}`;
    video.src = `${API_ROOT}/${srcPath}?ts=${Date.now()}`;
    /* ▲▲▲ 교체 끝 ▲▲▲ */

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

  const gArr=Array.isArray(uploadedGaze)?uploadedGaze:[];
  const cArr=Array.isArray(uploadedClicks)?uploadedClicks:[];
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

    playbackRaf=requestAnimationFrame(render);
  };

  if (playbackRaf) cancelAnimationFrame(playbackRaf);
  playbackRaf=requestAnimationFrame(render);
}

/* ===== 초기화 ===== */
(async ()=>{
  try{
    /* ▼▼▼ 교체: API_ROOT + 재시도 + videoPath 지원 ▼▼▼ */
    const data = await fetchJsonWithRetry(`${API_ROOT}/video-data`);

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
    /* ▲▲▲ 교체 끝 ▲▲▲ */

  }catch(e){
    console.error('❌ DB에서 영상/텍스트 로딩 실패', e);
  }

  // DOM 바인딩
  calibrationButton=document.getElementById('calibrationButton');
  calibrationButton.addEventListener('click', onClickCalibrationBtn);
  calibrationButton.disabled=true;
  // ✅ 초기엔 버튼 숨김 (성공해서 트래킹 시작된 뒤에만 보여줄 것)
  calibrationButton.style.display='none';

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
    submitButton.style.display='none';
    submitButton.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { await onSubmit(); } catch (err) { console.error(err); }
    });
  }

  resetButton=document.getElementById('resetButton');
  if (resetButton){
    placeResetInline();
    resetButton.style.display='none';
    resetButton.addEventListener('click', fullReset);
  }

  eyeTracker = new EasySeeSo();

  // 5초 타임아웃: 카메라 권한 묻는 중이거나 응답이 없으면 에러 페이지로
  let camFailTimer = setTimeout(() => {
    console.warn("⏳ 카메라 응답 없음(5초). 에러 페이지로 이동");
    if (CAMERA_ERROR_URL) window.location.href = CAMERA_ERROR_URL;
  }, 5000);

  // gaze 워치독
  const GAZE_WATCHDOG_MS = 4000;
  let gazeWatchdogStarted = false;
  function startGazeWatchdog() {
    if (gazeWatchdogStarted) return;
    gazeWatchdogStarted = true;
    setTimeout(() => {
      if (!gazeSeen) {
        console.warn('👀 onGaze 미도착. 카메라/권한 문제로 간주 → 에러 페이지 이동');
        if (CAMERA_ERROR_URL) window.location.href = CAMERA_ERROR_URL;
      }
    }, GAZE_WATCHDOG_MS);
  }

  await eyeTracker.init(
    licenseKey,
    async () => {
      console.log("✅ SeeSo 초기화 성공");
      clearTimeout(camFailTimer);

      try {
        await eyeTracker.startTracking(onGaze, () => {});
      } catch (e) {
        console.error('❌ startTracking 실패(권한/디바이스 없음 가능):', e);
        if (CAMERA_ERROR_URL) return (window.location.href = CAMERA_ERROR_URL);
      }

      isTracking = true;
      eyeTracker.showImage();

      // ✅ 트래킹 성공 시에만 캘리브레이션 버튼 활성+표시
      calibrationButton.disabled = false;
      calibrationButton.classList?.remove('hidden-init');
      calibrationButton.style.display = 'inline-block';

      sizeCanvasToWindow();

      // gaze 워치독 가동
      startGazeWatchdog();
    },
    () => {
      console.log("❌ SeeSo 초기화 실패");
      clearTimeout(camFailTimer);
      if (CAMERA_ERROR_URL) window.location.href = CAMERA_ERROR_URL;
    }
  );

  // 리사이즈/스크롤/풀스크린 변화 시 갱신
  const rerender = () => { sizeCanvasToWindow(); renderRecordingOverlay(); };
  window.addEventListener('resize', rerender);
  window.addEventListener('scroll', rerender);
  document.addEventListener('fullscreenchange', rerender);

  sizeCanvasToWindow();
})();
