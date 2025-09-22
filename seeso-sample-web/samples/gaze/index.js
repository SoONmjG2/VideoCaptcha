// samples/gaze/user_index.js
import 'regenerator-runtime/runtime';
import EasySeeSo from 'seeso/easy-seeso';

/* ===== 환경 분기 ===== */
// localhost/127.0.0.1 또는 *.local, file:// 은 로컬로 간주
const IS_LOCAL =
  ['localhost', '127.0.0.1'].includes(location.hostname) ||
  location.hostname.endsWith('.local') ||
  location.protocol === 'file:';

/* ===== API ORIGIN 자동 선택 ===== */
// 필요 시 index.html 등에서 window.__API_ORIGIN 으로 강제 지정 가능
const API_ORIGIN = (() => {
  if (typeof window !== 'undefined' && window.__API_ORIGIN) return window.__API_ORIGIN;

  const { protocol, hostname } = location;

  // 로컬/파일 실행
  const isLocalHost =
    ['localhost', '127.0.0.1'].includes(hostname) ||
    hostname.endsWith('.local') ||
    protocol === 'file:';

  if (isLocalHost) return 'http://localhost:3000';

  // 배포: 도메인 기준으로 API 서브도메인 사용
  if (hostname.endsWith('peachprmoise.co.kr')) {
    return 'https://api.peachprmoise.co.kr';
  }

  // 그 외: 현재 오리진 사용(리버스 프록시 등)
  return `${protocol}//${hostname}`;
})();

// path를 안전하게 붙여주는 헬퍼
const API = (p) => `${API_ORIGIN}${p.startsWith('/') ? p : `/${p}`}`;

/* ===== reCAPTCHA v3 (브리지 우선) ===== */
const RECAPTCHA_DEV_SITE_KEY  = '6LekpcwrAAAAAHWGYmTJVRfXnPo-KxBVCexjG9M2';
const RECAPTCHA_PROD_SITE_KEY = '6LcspMwrAAAAAP5C_hIutqsKG3sLqNDKY9ZL67vU';
const RECAPTCHA_SITE_KEY =
  (typeof window !== 'undefined' && window.__RECAPTCHA_SITE_KEY)
    ? window.__RECAPTCHA_SITE_KEY
    : (IS_LOCAL ? RECAPTCHA_DEV_SITE_KEY : RECAPTCHA_PROD_SITE_KEY);

// 3A) 브리지 iframe 보장
let __bridge;
function ensureRecaptchaBridge() {
  return new Promise((resolve, reject) => {
    if (__bridge && __bridge.contentWindow) return resolve(__bridge);
    const f = document.createElement('iframe');
    f.id = 'recaptchaBridge';
    f.src = `/recaptcha-bridge.html?sitekey=${encodeURIComponent(RECAPTCHA_SITE_KEY)}`;
    f.style.display = 'none';
    f.onload = () => resolve(f);
    f.onerror = () => reject(new Error('bridge-load-failed'));
    document.body.appendChild(f);
    __bridge = f;
  });
}

// 3B) 브리지로 토큰 발급
async function getRecaptchaViaBridge(action) {
  const frame = await ensureRecaptchaBridge();
  const win = frame.contentWindow;
  const cid = Math.random().toString(36).slice(2);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMsg);
      resolve(null); // 타임아웃 → null
    }, 4000);

    function onMsg(ev) {
      if (ev.source !== win || ev.origin !== location.origin) return;
      const d = ev.data || {};
      if (d.type !== 'recaptcha-token' || d.cid !== cid) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      resolve(d.token || null);
    }
    window.addEventListener('message', onMsg);
    win.postMessage({ type: 'recaptcha-exec', action, cid }, location.origin);
  });
}

// 3C) (예비) 직접 로더 — 브리지 실패 시 폴백
let __recaptchaLoading;
async function ensureRecaptchaDirect() {
  if (window.grecaptcha?.execute) return true;
  if (!__recaptchaLoading) {
    __recaptchaLoading = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = `https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`;
      s.async = true;
      s.onload = () => {
        try { window.grecaptcha.ready(() => resolve(true)); }
        catch { resolve(!!window.grecaptcha?.execute); }
      };
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }
  return await __recaptchaLoading;
}

// 3D) 최종 API: 브리지 → 실패시 직접
async function getRecaptchaToken(action) {
  try {
    const t = await getRecaptchaViaBridge(action);
    if (t) return t;
  } catch {}
  const ok = await ensureRecaptchaDirect();
  if (!ok || !window.grecaptcha?.execute) return null;
  try { return await window.grecaptcha.execute(RECAPTCHA_SITE_KEY, { action }); }
  catch { return null; }
}

// 3E) fetch에 자동 주입
async function fetchWithRecaptcha(url, options = {}, action = 'captcha_fetch') {
  const headers = new Headers(options.headers || {});
  const token = await getRecaptchaToken(action);
  if (token) headers.set('X-Recaptcha-Token', token);
  return fetch(url, { ...options, headers });
}


/* ===== SeeSo 라이선스 키 ===== */
const SEESO_DEV_KEY  = 'dev_hhc570sz5quc3kk3wvpuvbm2zznc0wow8d5nej6v'; // dev
const SEESO_PROD_KEY = 'prod_muvxi2s8hct25hkzl989rrspxju8fb1lzdhzmoxx'; // prod
const licenseKey = IS_LOCAL ? SEESO_DEV_KEY : SEESO_PROD_KEY;

const dotMaxSize = 10;
const dotMinSize = 5;

/* 라우팅 */
const SUCCESS_URL = 'success/success.html';
// 에러 페이지를 쓰려면 경로 지정, 아니면 null로 두면 콘솔만 찍고 이동 안함
const CAMERA_ERROR_URL = null;

/* ===== 정규화 유틸 ===== */
const PREC = 4;
const roundN = v => Number(v.toFixed(PREC));
const clamp01 = v => Math.max(0, Math.min(1, v));
const distN = (x1,y1,x2,y2) => Math.hypot(x1-x2, y1-y2);

/* ===== 시선 판정 파라미터 (완화) ===== */
// 기본 반경을 키움(기존 0.11 → 0.16)
const GAZE_R_N = 0.16;
// 제출·판정시 사용할 가중 배수(기존 1.15 → 1.30)
const GAZE_R_MULT = 1.30;
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

/* ===== 정답/문항 상태 ===== */
let ANSWER = [];          // [{xn,yn,t?}, ...]
let CURRENT_ID = null;    // 현재 문항 id

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

/* ===== Canvas helpers ===== */
function getCanvas() { return document.getElementById('output'); }
function getCtx() { return getCanvas().getContext('2d'); }
function sizeCanvasToWindow() { const c=getCanvas(); c.width=window.innerWidth; c.height=window.innerHeight; }
function clearCanvas() { const c=getCanvas(); const ctx=getCtx(); ctx.clearRect(0,0,c.width,c.height); }

// 정규화 <-> 픽셀 변환
function n2p(xn, yn) { const c=getCanvas(); return { x: xn*c.width, y: yn*c.height }; }
function p2n(x, y)   { const c=getCanvas(); return { xn: x/c.width, yn: y/c.height }; }

/* ===== Drawing ===== */
function drawDotRGBA(x,y,r,rgba){
  const ctx=getCtx(); ctx.fillStyle=rgba;
  ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
}
function drawDotNorm(xn,yn,r,rgba){ const {x,y}=n2p(xn,yn); drawDotRGBA(x,y,r,rgba); }

// 재생용 십자가(필요 시)
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
  if (uploadName)        uploadName.style.display=(uploadedGaze?.length||uploadedClicks?.length)? 'inline-block':'none';

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
  if (gazeDataArray.length){
    const last=gazeDataArray[gazeDataArray.length-1];
    drawDotNorm(last.xn,last.yn,8,'rgba(255,0,0,1)');
  }
  // 클릭은 불투명 파란 점
  for (const c of clickDataArray) drawDotNorm(c.xn,c.yn,6,'rgba(0,0,255,0.5)');
}

/* ===== 시선 콜백 ===== */
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

/* ===== 클릭(왼쪽=추가, 오른쪽=삭제) ===== */
function addCanvasClickListener(video){
  const canvas=getCanvas();
  canvas.style.pointerEvents='auto';

  // 우클릭 기본 메뉴 막기
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // 버튼 기반으로 분기: 0=좌, 2=우
  canvas.addEventListener('mousedown', e => {
    if (!isRecording) return;

    const rect=canvas.getBoundingClientRect();
    const px=e.clientX-rect.left, py=e.clientY-rect.top;
    const {xn:rx,yn:ry}=p2n(px,py);
    const xn=roundN(rx), yn=roundN(ry);
    const tVideoMs=Math.round((video?.currentTime||0)*1000);

    if (e.button === 0) {
      // ✅ 왼쪽 클릭 → 항상 추가
      clickDataArray.push({ t:tVideoMs, xn, yn });
      renderRecordingOverlay();
    } else if (e.button === 2) {
      // ✅ 오른쪽 클릭 → 가장 가까운 클릭 삭제
      const idx=findNearestClickIndex(xn,yn,CLICK_TOGGLE_RADIUS_N);
      if (idx!==-1){
        clickDataArray.splice(idx,1);
        renderRecordingOverlay();
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

/* ===== 저장 전 토글/중복 정리 함수 제거됨 ===== */
// (요청대로 dedupToggle 완전 삭제)

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
function saveGazeData(){
  isRecording=false;

  // 🔥 dedup 제거: 클릭을 있는 그대로 저장
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

/* ===== 제출 처리 (서버 엄격 판정 사용) ===== */
function nearAnswer(c, A, rN){
  return (A||[]).some(a => distN(c.xn, c.yn, Number(a.xn), Number(a.yn)) <= rN);
}

async function onSubmit(){
  if (!CURRENT_ID) {
    console.warn('문항 ID가 없습니다. 다시 시도합니다.');
    await fullReset();
    return;
  }

  // 중복 제출 방지
  const prevDisabled = submitButton?.disabled;
  if (submitButton) submitButton.disabled = true;

  try{
    // 서버에 그대로 전송할 페이로드
    const payload = {
      id: CURRENT_ID,
      clicks: clickDataArray.slice(),     // dedup 없이 그대로
      gaze:   gazeDataArray.slice(),      // t/tv 포함 그대로
    };

    const res = await fetchWithRecaptcha(
      API('/submit'),
      {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify(payload),
      },
      'captcha_submit'
    );

    if (res.ok) {
      // ✅ 서버 통과 → 저장 후 성공 페이지
      if (DOWNLOAD_COMBINED_ONLY) {
        await saveCombinedThenNavigate(gazeDataArray, payload.clicks, SUCCESS_URL);
      } else {
        await saveExactlyLikeSaveAndPlayThenNavigate(gazeDataArray, payload.clicks, SUCCESS_URL);
      }
      return;
    }

    // 409: 애매 점수(retry) 또는 오답(wrong) → 다시 풀기
    if (res.status === 409) {
      let msg = '정답 확인이 필요합니다. 다시 한 번 진행해 주세요.';
      try {
        const j = await res.json();
        if (j?.error === 'recaptcha_retry') msg = '사람 확인 점수가 애매합니다. 다시 한번 진행해 주세요.';
        if (j?.error === 'wrong')          msg = '오답입니다. 다시 한번 시도해 주세요.';
      } catch {}
      showSecurityOverlay('retry', msg, { buttonText:'다시 시도', onClick: () => { hideSecurityOverlay(); fullReset(); } });
      return;
    }

    // 403: 차단
    if (res.status === 403) {
      let msg = '보안상 요청이 차단되었습니다. 잠시 후 다시 시도하세요.';
      try { const j = await res.json(); if (j?.error === 'recaptcha_blocked') msg = '사람 확인 점수가 낮아 차단되었습니다. 잠시 후 다시 시도하세요.'; } catch {}
      showSecurityOverlay('blocked', msg, { buttonText:'다시 시도', cooldownMs: 8000, onClick: () => { hideSecurityOverlay(); fullReset(); } });
      return;
    }

    // 기타
    showSecurityOverlay('error', '일시적인 오류가 발생했습니다. 다시 시도해 주세요.', { buttonText:'다시 시도', onClick: () => { hideSecurityOverlay(); fullReset(); } });
  } catch (e) {
    console.error('❌ 제출 실패:', e);
    showSecurityOverlay('error', '네트워크 오류로 제출하지 못했습니다.', { buttonText:'다시 시도', onClick: () => { hideSecurityOverlay(); fullReset(); } });
  } finally {
    if (submitButton) submitButton.disabled = prevDisabled ?? false;
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

    playbackRaf=requestAnimationFrame(render);
  };

  if (playbackRaf) cancelAnimationFrame(playbackRaf);
  playbackRaf=requestAnimationFrame(render);
}

/* ===== 유틸: 새 세션 리셋 ===== */
function resetRecording(){ gazeDataArray=[]; clickDataArray=[]; lastVideoTimeMs=0; clearCanvas(); }

/* === 보안 오버레이 도우미 === */
function showSecurityOverlay(kind, message, opts = {}) {
  hideSecurityOverlay();
  const wrap = document.createElement('div');
  wrap.id = 'secOverlay';
  Object.assign(wrap.style, {
    position:'fixed', inset:'0', background:'rgba(0,0,0,0.6)',
    display:'flex', alignItems:'center', justifyContent:'center', zIndex:'10004'
  });

  const card = document.createElement('div');
  Object.assign(card.style, {
    width:'min(520px, 92vw)', background:'#fff', borderRadius:'16px',
    padding:'24px', boxShadow:'0 10px 30px rgba(0,0,0,0.25)', textAlign:'center'
  });

  const h = document.createElement('div');
  h.textContent =
    kind==='retry'   ? '다시 한번 확인할게요' :
    kind==='blocked' ? '요청이 차단되었습니다' :
    '문제를 불러오지 못했습니다';
  h.style.fontSize='18px'; h.style.fontWeight='700'; h.style.marginBottom='10px';

  const p = document.createElement('div');
  p.textContent = message || '';
  p.style.fontSize='14px'; p.style.color='#444'; p.style.marginBottom='16px';

  const btn = document.createElement('button');
  btn.textContent = opts.buttonText || '확인';
  Object.assign(btn.style, {
    padding:'10px 16px', borderRadius:'10px', border:'0', cursor:'pointer',
    background:'#1990ff', color:'#fff', fontWeight:'600'
  });

  let cooldownTimer = null;
  if (opts.cooldownMs) {
    btn.disabled = true;
    const end = Date.now() + opts.cooldownMs;
    const tick = () => {
      const left = Math.max(0, Math.ceil((end - Date.now())/1000));
      btn.textContent = `${opts.buttonText || '다시 시도'} (${left}s)`;
      if (left <= 0) {
        btn.disabled = false;
        btn.textContent = opts.buttonText || '다시 시도';
        clearInterval(cooldownTimer);
      }
    };
    tick();
    cooldownTimer = setInterval(tick, 500);
  }

  btn.addEventListener('click', () => {
    if (cooldownTimer) clearInterval(cooldownTimer);
    opts.onClick?.();
  });

  card.appendChild(h); card.appendChild(p); card.appendChild(btn);
  wrap.appendChild(card);
  document.body.appendChild(wrap);

  setActionButtonsVisible(false);
}
function hideSecurityOverlay(){
  const el = document.getElementById('secOverlay');
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

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
    // 👉 디버그: fetch 전에 v3 토큰 실제 발급되는지 확인
    const t = await getRecaptchaToken('captcha_fetch');
    console.log('[v3:init] token?', t ? t.slice(0,12)+'…' : null);
    // v3 토큰과 함께 호출
    const res = await fetchWithRecaptcha(API('/video-data'), { method:'GET' }, 'captcha_fetch');

    // ✅ 점수 통과: 정상 진행
    if (res.ok) {
      const data=await res.json();
      CURRENT_ID = data.id || null;
      ANSWER = normalizeAnswer(data.answer);
      video.src=API(`/video/${data.id}?ts=${Date.now()}`);

      const overlay=document.getElementById('overlayText');
      overlay.textContent=data.question;

      placeSubmitInline(); placeResetInline(); setActionButtonsVisible(true);
      hideSecurityOverlay();
    } else if (res.status === 409) {
      // ❗ 애매: 다시 풀기 유도
      const msg = (await res.json().catch(()=>({})))?.message || '사람 확인이 애매합니다. 문제를 다시 불러올게요.';
      showSecurityOverlay('retry', msg, { buttonText: '다시 시도', onClick: () => { hideSecurityOverlay(); fullReset(); } });
      return;
    } else if (res.status === 403) {
      // ⛔ 차단: 쿨다운 후 재시도
      const msg = (await res.json().catch(()=>({})))?.message || '보안상 요청이 차단되었습니다. 잠시 후 다시 시도하세요.';
      showSecurityOverlay('blocked', msg, { buttonText: '다시 시도', cooldownMs: 8000, onClick: () => { hideSecurityOverlay(); fullReset(); } });
      return;
    } else {
      showSecurityOverlay('error', '일시적인 오류가 발생했습니다. 다시 시도해 주세요.', { buttonText: '다시 시도', onClick: () => { hideSecurityOverlay(); fullReset(); } });
      return;
    }
  }catch(e){
    console.error('❌ /video-data 재호출 실패:', e);
    showSecurityOverlay('error', '네트워크 오류로 문제를 불러오지 못했습니다.', { buttonText: '다시 시도', onClick: () => { hideSecurityOverlay(); fullReset(); } });
    return;
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
    // 최초 로딩에서도 v3 토큰과 함께
    const res = await fetchWithRecaptcha(API('/video-data'), { method:'GET' }, 'captcha_fetch');

    if (res.ok) {
      const data=await res.json();

      CURRENT_ID = data.id || null;

      // ✅ 정답을 평탄화해서 어떤 구조라도 좌표 배열로 사용
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

      // 절대경로 + 캐시깨기
      video.src = API(`/video/${data.id}?ts=${Date.now()}`);

      const overlay=document.getElementById('overlayText');
      overlay.textContent=data.question;

      addCanvasClickListener(video);
      hideSecurityOverlay();
    } else if (res.status === 409) {
      const msg = (await res.json().catch(()=>({})))?.message || '사람 확인이 애매합니다. 문제를 다시 불러올게요.';
      showSecurityOverlay('retry', msg, { buttonText: '다시 시도', onClick: () => { hideSecurityOverlay(); fullReset(); } });
      return;
    } else if (res.status === 403) {
      const msg = (await res.json().catch(()=>({})))?.message || '보안상 요청이 차단되었습니다. 잠시 후 다시 시도하세요.';
      showSecurityOverlay('blocked', msg, { buttonText: '다시 시도', cooldownMs: 8000, onClick: () => { hideSecurityOverlay(); fullReset(); } });
      return;
    } else {
      showSecurityOverlay('error', '일시적인 오류가 발생했습니다. 다시 시도해 주세요.', { buttonText: '다시 시도', onClick: () => { hideSecurityOverlay(); fullReset(); } });
      return;
    }
  }catch(e){
    console.error('❌ DB에서 영상/텍스트 로딩 실패', e);
    showSecurityOverlay('error', '네트워크 오류로 문제를 불러오지 못했습니다.', { buttonText: '다시 시도', onClick: () => { hideSecurityOverlay(); fullReset(); } });
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

  // 5초 타임아웃: 여전히 버튼이 disabled면 카메라 없음으로 간주
  setTimeout(() => {
    if (calibrationButton.disabled) {
      console.warn("⏳ 카메라 응답 없음");
      if (CAMERA_ERROR_URL) {
        window.location.href = CAMERA_ERROR_URL;
      }
    }
  }, 5000);

  window.addEventListener('resize', sizeCanvasToWindow);
  sizeCanvasToWindow();
})();

/* ===== 정답 ===== */
// /video-data 의 answer가 배열/중첩배열/객체 혼합이어도 {xn,yn,t?} 배열로 평탄화
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
      if (!Number.isNaN(xn) && !Number.isNaN(yn)) {
        pts.push({ xn, yn, t: Number.isNaN(t) ? null : t });
      }
    }
  })(ans);
  return dedupByRadius(pts, 0.02); // 가까운 중복 제거(정답 포인트만)
}
function dedupByRadius(arr, rN = 0.02) {
  const out = [];
  for (const p of arr) {
    const dup = out.find(q => distN(p.xn, p.yn, q.xn, q.yn) <= rN);
    if (!dup) out.push(p);
  }
  return out;
}
