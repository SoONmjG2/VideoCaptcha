// 이전 user_index.js  
// samples/gaze/user_index.js
import 'regenerator-runtime/runtime';
import EasySeeSo from 'seeso/easy-seeso';

// ===== 설정 =====
const licenseKey = 'dev_hhc570sz5quc3kk3wvpuvbm2zznc0wow8d5nej6v';
const dotMaxSize = 10;
const dotMinSize = 5;

// 제출 성공 시 이동할 페이지 (gaze/index.html 기준)
const SUCCESS_URL = 'success/success.html';
// 카메라 실패 시 이동할 페이지
const CAMERA_ERROR_URL = '/camera-error.html';

// 정규화 소수점 자리수
const PREC = 4;
const roundN = v => Number(v.toFixed(PREC));

// ===== 시선 판정 파라미터 (완화) =====
const GAZE_R_N = 0.11;
const GAZE_DWELL_MS = 140;
const GAZE_WIN_BEFORE_MS = 1000;
const GAZE_WIN_AFTER_MS  = 300;

// (선택) 캠핑 방지
const ENABLE_ENTRY_RULE  = false;
const ENTRY_WINDOW_MS    = 600;
const ENTRY_INNER_R_N    = GAZE_R_N / 2;

// 다운로드 동작 옵션
const DOWNLOAD_COMBINED_ONLY = false;

const clamp01 = v => Math.max(0, Math.min(1, v));
const distN = (x1,y1,x2,y2) => Math.hypot(x1-x2, y1-y2);

// ===== 정답 =====
let ANSWER = [];  // /video-data 에서 [{xn,yn}, ...]

// ===== 상태 =====
let isCalibrationMode = false;
let eyeTracker = null;
let isTracking = false;
let calibrationButton, saveDataButton, submitButton, resetButton;

let isRecording = true;
let videoStarted = false;

// 업로드/그리기(선택 기능)
let isDrawingMode = false;
let uploadedGaze = null, uploadedClicks = null;
let jsonUploader, uploadButton, drawButton, cancelDrawButton, uploadName;

// ===== 데이터 =====
let gazeDataArray = [];
let clickDataArray = [];

// 재생 상태
let playbackRaf = null;
let lastVideoTimeMs = 0;

// 클릭 토글 반경(정규화)
const CLICK_TOGGLE_RADIUS_N = 0.025;

// ===== Canvas helpers =====
function getCanvas() { return document.getElementById('output'); }
function getCtx() { return getCanvas().getContext('2d'); }
function sizeCanvasToWindow() { const c=getCanvas(); c.width=window.innerWidth; c.height=window.innerHeight; }
function clearCanvas() { const c=getCanvas(); const ctx=getCtx(); ctx.clearRect(0,0,c.width,c.height); }

// 정규화 <-> 픽셀 변환
function n2p(xn, yn) { const c=getCanvas(); return { x: xn*c.width, y: yn*c.height }; }
function p2n(x, y)   { const c=getCanvas(); return { xn: x/c.width, yn: y/c.height }; }

// ===== Drawing =====
function drawDotRGBA(x,y,r,rgba){
  const ctx=getCtx(); ctx.fillStyle=rgba;
  ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
}
function drawDotNorm(xn,yn,r,rgba){ const {x,y}=n2p(xn,yn); drawDotRGBA(x,y,r,rgba); }

// (재생용 표시에서만 십자가가 필요하면 사용)
function drawClickCross(x,y,color='blue',size=6,lineWidth=2){
  const ctx=getCtx();
  ctx.beginPath();
  ctx.moveTo(x-size,y); ctx.lineTo(x+size,y);
  ctx.moveTo(x,y-size); ctx.lineTo(x,y+size);
  ctx.lineWidth=lineWidth; ctx.strokeStyle=color; ctx.stroke();
}
function drawCrossNorm(xn,yn,color='blue',size=6,lineWidth=2){
  const {x,y}=n2p(xn,yn); drawClickCross(x,y,color,size,lineWidth);
}

// ===== UI helpers =====
function placeSubmitInline(){
  if (!submitButton) return;
  Object.assign(submitButton.style,{position:'static',right:'',bottom:'',zIndex:'',marginLeft:'10px'});
}
function placeResetInline(){
  if (!resetButton) return;
  Object.assign(resetButton.style,{position:'static',right:'',bottom:'',zIndex:'',marginLeft:'10px'});
}

// ★ show 시 hidden-init 클래스도 제거해서 !important 영향 제거
function setActionButtonsVisible(show){
  const ids = ['submitButton', 'resetButton'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (show) {
      el.classList.remove('hidden-init');   // 핵심
      el.style.display = 'inline-block';
    } else {
      el.style.display = 'none';
      // 필요하면 다시 숨김 클래스 부여
      // el.classList.add('hidden-init');
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

// ===== 캘리브레이션 =====
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
  setActionButtonsVisible(true); // ← hidden-init 제거 + 표시

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

// ===== 녹화 중 오버레이 =====
function renderRecordingOverlay(){
  if (isCalibrationMode) return;
  if (!isRecording || !videoStarted) return;
  clearCanvas();
  if (gazeDataArray.length){
    const last=gazeDataArray[gazeDataArray.length-1];
    drawDotNorm(last.xn,last.yn,8,'rgba(255,0,0,1)');
  }
  // 클릭은 불투명 파란 점(요청 사항)
  for (const c of clickDataArray) drawDotNorm(c.xn,c.yn,6,'rgba(0,0,255,0.5)');
}

// ===== 시선 콜백 =====
function onGaze(gazeInfo){
  if (isCalibrationMode || !videoStarted || !isRecording) return;
  const c=getCanvas();

  const xn = clamp01(roundN(gazeInfo.x / c.width));
  const yn = clamp01(roundN(gazeInfo.y / c.height));
  if (Number.isNaN(xn) || Number.isNaN(yn)) return;

  const video = document.getElementById('myVideo');
  const tv = Math.round((video?.currentTime || 0) * 1000);

  gazeDataArray.push({ t: Date.now(), tv, xn, yn });
  renderRecordingOverlay();
}

// ===== 클릭(정규화 토글) =====
function addCanvasClickListener(video){
  const canvas=getCanvas();
  canvas.style.pointerEvents='auto';
  canvas.addEventListener('click',e=>{
    if (!isRecording) return;
    const rect=canvas.getBoundingClientRect();
    const px=e.clientX-rect.left, py=e.clientY-rect.top;
    const {xn:rx,yn:ry}=p2n(px,py);
    const xn=roundN(rx), yn=roundN(ry);

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

// ===== 저장 전 토글/중복 정리 =====
function dedupToggle(arr,rN=0.015,winMs=700){
  const out=[];
  for (const c of arr){
    const i=out.findIndex(o=>Math.abs(o.t-c.t)<=winMs && Math.hypot(o.xn-c.xn,o.yn-c.yn)<=rN);
    if (i>=0) out.splice(i,1); else out.push(c);
  }
  return out;
}

// ===== Gaze 판정 유틸 =====
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

// ===== 공통 유틸 =====
const delay = (ms) => new Promise(res => setTimeout(res, ms));

// 다운로드 헬퍼
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

// (A) 두 파일 저장 후 이동
async function saveTwoFilesThenNavigate(gazeArr, clicksArr, url){
  const ts = tsForFile();
  downloadJson(`gaze_at_submit_${ts}.json`, gazeArr);
  await delay(350);
  downloadJson(`clicks_at_submit_${ts}.json`, clicksArr);
  await delay(500);
  window.location.href = url;
}
// (B) 합본 저장 후 이동
async function saveCombinedThenNavigate(gazeArr, clicksArr, url){
  const ts = tsForFile();
  downloadJson(`gaze_clicks_at_submit_${ts}.json`, { gaze: gazeArr, clicks: clicksArr });
  await delay(650);
  window.location.href = url;
}
// Save&Play와 동일 파일명으로 저장 후 이동
async function saveExactlyLikeSaveAndPlayThenNavigate(gazeArr, clicksArr, url){
  await downloadJsonAsync('gaze.json',  gazeArr);
  await delay(300);
  await downloadJsonAsync('clicks.json', clicksArr);
  await delay(800);
  window.location.href = url;
}

// ===== Save & Play =====
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

// ===== 제출 처리 =====
async function onSubmit(){
  const cleaned = dedupToggle(clickDataArray.slice());
  const EFFECTIVE_R_N = GAZE_R_N * 1.15;

  const passed = cleaned.some(c =>
    (ANSWER||[]).some(a => distN(c.xn, c.yn, Number(a.xn), Number(a.yn)) <= EFFECTIVE_R_N) &&
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

// ===== 재생 =====
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
    for (const c of shownClicks) drawCrossNorm(c.xn,c.yn,'blue',6,2); // 재생 표시만 십자가

    playbackRaf=requestAnimationFrame(render);
  };

  if (playbackRaf) cancelAnimationFrame(playbackRaf);
  playbackRaf=requestAnimationFrame(render);
}

// ===== 유틸: 새 세션 리셋 =====
function resetRecording(){ gazeDataArray=[]; clickDataArray=[]; lastVideoTimeMs=0; clearCanvas(); }

// === “그리기 취소”
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
    const res=await fetch('http://localhost:3000/video-data');
    const data=await res.json();

    ANSWER=Array.isArray(data.answer)?data.answer:[];
    video.src=`http://localhost:3000/video/${data.id}?ts=${Date.now()}`;

    const overlay=document.getElementById('overlayText');
    overlay.textContent=data.question;

    placeSubmitInline(); placeResetInline(); setActionButtonsVisible(true);
  }catch(e){
    console.error('❌ /video-data 재호출 실패:', e);
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

// ===== 업로드 처리(선택) =====
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

// ===== 업로드 데이터 재생(그리기 모드) =====
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

// ===== 초기화 =====
(async ()=>{
  try{
    const res=await fetch('http://localhost:3000/video-data');
    const data=await res.json();

    ANSWER=Array.isArray(data.answer)?data.answer:[];
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

    // 절대경로 + 캐시깨기
    video.src=`http://localhost:3000/video/${data.id}?ts=${Date.now()}`;

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
      console.log("❌ SeeSo 초기화 실패 (즉시 이동)");
      window.location.href = CAMERA_ERROR_URL;
    }
  );

  // 5초 타임아웃: 여전히 버튼이 disabled면 카메라 없음으로 간주
  setTimeout(() => {
    if (calibrationButton.disabled) {
      console.warn("⏳ 카메라 응답 없음 → 에러 페이지 이동");
      window.location.href = CAMERA_ERROR_URL;
    }
  }, 5000);

  window.addEventListener('resize', sizeCanvasToWindow);
  sizeCanvasToWindow();
})();
