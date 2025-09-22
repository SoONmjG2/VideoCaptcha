// samples/gaze/user_index.js
// ✅ 클릭 전용 버전: 시선추적/캘리브레이션/시선 판정 전부 제거

/* ===== 기본 설정 ===== */
const SUCCESS_URL = 'success/success.html';
const CAMERA_ERROR_URL = null; // 사용 안 함

/* ===== 정규화 유틸 ===== */
const PREC = 4;
const roundN = v => Number(v.toFixed(PREC));
const clamp01 = v => Math.max(0, Math.min(1, v));
const distN = (x1,y1,x2,y2) => Math.hypot(x1-x2, y1-y2);

/* ===== 정답 반경(클릭만) ===== */
// 눈금 완화 그대로 유지 (원하면 줄여도 됨: GAZE_R_N=0.11 등)
const GAZE_R_N = 0.16;
const GAZE_R_MULT = 1.30;
const rEff = () => GAZE_R_N * GAZE_R_MULT;

/* ===== 정답 평탄화 ===== */
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
  return dedupByRadius(pts, 0.02); // 가까운 중복 제거(필요 시 조정)
}
function dedupByRadius(arr, rN = 0.02) {
  const out = [];
  for (const p of arr) {
    const dup = out.find(q => distN(p.xn, p.yn, q.xn, q.yn) <= rN);
    if (!dup) out.push(p);
  }
  return out;
}

let ANSWER = [];  // [{xn,yn,t?}, ...] 유지

/* ===== 상태 & 데이터 ===== */
let videoStarted = false;
let clickDataArray = [];

/* 클릭 토글 반경(정규화) - 우클릭 삭제용 범위 */
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
      pointerEvents: 'auto' // 클릭 받도록
    });
    document.body.appendChild(c);
  }
  return c;
}
function getCanvas() { return ensureCanvas(); }
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

/* ===== UI helpers ===== */
function placeSubmitInline(){
  const el = document.getElementById('submitButton');
  if (!el) return;
  Object.assign(el.style,{position:'static',right:'',bottom:'',zIndex:'',marginLeft:'10px', display:'inline-block'});
}
function placeResetInline(){
  const el = document.getElementById('resetButton');
  if (!el) return;
  Object.assign(el.style,{position:'static',right:'',bottom:'',zIndex:'',marginLeft:'10px', display:'inline-block'});
}

/* ===== 녹화 중 오버레이 (클릭만 표시) ===== */
function renderOverlay(){
  clearCanvas();
  // 클릭은 반투명 파란 점
  for (const c of clickDataArray) drawDotNorm(c.xn,c.yn,6,'rgba(0,0,255,0.5)');
}

/* ===== 클릭(왼쪽=추가, 오른쪽=삭제) ===== */
function addCanvasClickListener(video){
  const canvas=getCanvas();
  canvas.style.pointerEvents='auto';

  // 우클릭 기본 메뉴 막기
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  // 버튼 기반으로 분기: 0=좌, 2=우
  canvas.addEventListener('mousedown', e => {
    const rect=canvas.getBoundingClientRect();
    const px=e.clientX-rect.left, py=e.clientY-rect.top;
    const {xn:rx,yn:ry}=p2n(px,py);
    const xn=roundN(rx), yn=roundN(ry);
    const tVideoMs=Math.round((video?.currentTime||0)*1000);

    if (e.button === 0) {
      // ✅ 왼쪽 클릭 → 항상 추가 (토글/상쇄 제거)
      clickDataArray.push({ t:tVideoMs, xn, yn });
      renderOverlay();
    } else if (e.button === 2) {
      // ✅ 오른쪽 클릭 → 가장 가까운 클릭 삭제
      const idx=findNearestClickIndex(xn,yn,CLICK_TOGGLE_RADIUS_N);
      if (idx!==-1){
        clickDataArray.splice(idx,1);
        renderOverlay();
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

/* ===== 제출 처리 (클릭만 판정) ===== */
function nearAnswer(c, A, rN){
  return (A||[]).some(a => distN(c.xn, c.yn, Number(a.xn), Number(a.yn)) <= rN);
}

async function onSubmit(){
  // 클릭만으로 판정 (체류/엔트리 규칙 없음)
  const EFFECTIVE_R_N = rEff();
  const passed = clickDataArray.some(c => nearAnswer(c, ANSWER, EFFECTIVE_R_N));

  if (passed) {
    // 성공 → 바로 이동 (파일 저장 안 함)
    window.location.href = SUCCESS_URL;
  } else {
    // 오답 → 리셋
    await fullReset();
  }
}

/* ===== 리셋 ===== */
function resetRecording(){ clickDataArray=[]; clearCanvas(); }

async function fullReset(){
  resetRecording();

  try{
    const res=await fetch('http://localhost:3000/video-data');
    const data=await res.json();

    ANSWER = normalizeAnswer(data.answer);

    const video=document.getElementById('myVideo');
    if (video) {
      video.src=`http://localhost:3000/video/${data.id}?ts=${Date.now()}`;
      try { await video.play(); } catch {}
    }

    const overlay=document.getElementById('overlayText');
    if (overlay) overlay.textContent=data.question;

    placeSubmitInline();
    placeResetInline();
  }catch(e){
    console.error('❌ /video-data 재호출 실패', e);
  }
}

/* ===== 초기화 ===== */
(async ()=>{
  // 캔버스 준비
  sizeCanvasToWindow();
  window.addEventListener('resize', sizeCanvasToWindow);

  try{
    const res=await fetch('http://localhost:3000/video-data');
    const data=await res.json();

    // ✅ 정답 평탄화
    ANSWER = normalizeAnswer(data.answer);

    const video=document.getElementById('myVideo');
    if (video){
      video.addEventListener('loadeddata', ()=>{ placeSubmitInline(); placeResetInline(); });
      video.addEventListener('playing', ()=>{ videoStarted=true; });
      video.src=`http://localhost:3000/video/${data.id}?ts=${Date.now()}`;
    }

    const overlay=document.getElementById('overlayText');
    if (overlay) overlay.textContent=data.question;

    addCanvasClickListener(video);
  }catch(e){
    console.error('❌ DB에서 영상/텍스트 로딩 실패', e);
  }

  // DOM 바인딩 (제출/다시하기만 사용)
  const submitButton=document.getElementById('submitButton');
  if (submitButton){
    placeSubmitInline();
    submitButton.style.display='inline-block';  // 항상 보이게
    submitButton.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { await onSubmit(); } catch (err) { console.error(err); }
    });
  }

  const resetButton=document.getElementById('resetButton');
  if (resetButton){
    placeResetInline();
    resetButton.style.display='inline-block';   // 항상 보이게
    resetButton.addEventListener('click', fullReset);
  }
})();
