// samples/gaze/tolerance_debug.js
// ES Module — 정답 오차(허용반경/체류/윈도우) 디버그 HUD & 링 오버레이
// index.js에서 GAZE(시선)와 CLICK(정답) 반경을 분리한 버전에 대응.
//
// - initToleranceDebug({...}) 로 초기화하고,
//   매 프레임: debug.renderOverlay()
//   클릭 추가/삭제 시: onClickAdded / onClickDeleted
// - 키: h(HUD), p(표시), r/R(클릭 반경↓/↑), f/F(시선 반경↓/↑),
//        [, ](dwell), ;,'(before), ,.(after)

export function initToleranceDebug({
  // ===== 필수 주입 =====
  getAnswerPoints,
  videoN2canvasP,
  getVideoRect,
  getCtx,
  getLastGazePoint,

  // ===== 파라미터 get/set =====
  getGAZE_R_N,
  getCLICK_R_MULT, setCLICK_R_MULT,
  getGAZE_R_MULT,  setGAZE_R_MULT,
  getDWELL_MS, setDWELL_MS,
  getWIN_BEFORE_MS, setWIN_BEFORE_MS,
  getWIN_AFTER_MS,  setWIN_AFTER_MS,
  getENTRY_MS,

  // ===== 선택 =====
  getClickToggleR_N = () => 0.025,
  enableKeybind = true,
}) {
  let DEBUG_HUD = true;
  let DEBUG_SHOW_RINGS = true;
  let lastEval = null;
  let lastClick = null;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const distN  = (x1,y1,x2,y2) => Math.hypot(x1-x2, y1-y2);

  // 클릭(정답) 반경, 시선 반경
  const rEffClick = () => getGAZE_R_N() * getCLICK_R_MULT();
  const rEffGaze  = () => getGAZE_R_N() * getGAZE_R_MULT();

  /* ✅ 수정됨: 영상 현재 시각 기준으로 refT 계산 */
  function currentRefTimeMs(){
    const video = document.getElementById('myVideo');
    if (video && typeof video.currentTime === 'number') {
      return Math.round(video.currentTime * 1000);
    }
    return null;
  }

  function splitAnswersByTimeWindow(refT){
    const A = getAnswerPoints?.() || [];
    if (!A.length) return { eligible: [], ineligible: [] };

    if (refT == null){
      return {
        eligible: A.filter(a => a?.t == null),
        ineligible: A.filter(a => a?.t != null),
      };
    }

    const before = getWIN_BEFORE_MS();
    const after  = getWIN_AFTER_MS();
    const tMin = refT - before;
    const tMax = refT + after;

    const eligible = [];
    const ineligible = [];
    for (const a of A){
      if (a?.t == null) { eligible.push(a); continue; }
      const at = (a.t|0);
      if (at >= tMin && at <= tMax) eligible.push(a);
      else ineligible.push(a);
    }
    return { eligible, ineligible };
  }

  function radiiPx(){
    const rc = rEffClick();
    const rg = rEffGaze();
    const { width:w, height:h } = getVideoRect();
    return {
      clickX: Math.round(rc * w),
      clickY: Math.round(rc * h),
      gazeX:  Math.round(rg * w),
      gazeY:  Math.round(rg * h),
      toggleX: Math.round(getClickToggleR_N() * w),
      toggleY: Math.round(getClickToggleR_N() * h),
    };
  }

  function drawRings(ctx){
    if (!DEBUG_SHOW_RINGS) return;
    const refT = currentRefTimeMs();
    const { eligible, ineligible } = splitAnswersByTimeWindow(refT);
    if (!eligible.length && !ineligible.length) return;

    const { width:w, height:h } = getVideoRect();
    const rcx = rEffClick()*w,  rcy = rEffClick()*h;
    const rgx = rEffGaze()*w,   rgy = rEffGaze()*h;

    ctx.save();

    // --- 시간 윈도우 밖: 회색 안내(정답 허용 반경만) ---
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(150,150,150,0.6)';
    ctx.fillStyle   = 'rgba(150,150,150,0.3)';
    for (const a of ineligible){
      const {x,y}=videoN2canvasP(+a.xn,+a.yn);
      ctx.beginPath(); ctx.ellipse(x,y,rcx,rcy,0,0,Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fill();
    }

    // --- 시선 반경(파랑, 큰 원) ---
    ctx.strokeStyle = 'rgba(50,120,255,0.9)';
    ctx.fillStyle   = 'rgba(50,120,255,0.12)';
    for (const a of eligible){
      const {x,y}=videoN2canvasP(+a.xn,+a.yn);
      ctx.beginPath(); ctx.ellipse(x,y,rgx,rgy,0,0,Math.PI*2);
      ctx.fill(); ctx.stroke();
    }

    // --- 클릭 허용 반경(검정) + 정답점(주황) ---
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.fillStyle   = 'orange';
    for (const a of eligible){
      const {x,y}=videoN2canvasP(+a.xn,+a.yn);
      ctx.beginPath(); ctx.ellipse(x,y,rcx,rcy,0,0,Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.arc(x,y,4,0,Math.PI*2); ctx.fill();
    }

    ctx.restore();
  }

  function drawHUD(ctx){
    if (!DEBUG_HUD) return;
    const pad = 10;
    const lines = [];

    const { clickX,clickY,gazeX,gazeY,toggleX,toggleY } = radiiPx();
    const rBase = getGAZE_R_N();

    lines.push(`CLICK_R = base(${rBase.toFixed(3)}) × mult(${getCLICK_R_MULT().toFixed(2)})`);
    lines.push(`GAZE_R  = base(${rBase.toFixed(3)}) × mult(${getGAZE_R_MULT().toFixed(2)})`);
    lines.push(`pixels: click≈${clickX}×${clickY} | gaze≈${gazeX}×${gazeY}`);
    lines.push(`dwell≥${getDWELL_MS()}ms | window[-${getWIN_BEFORE_MS()},+${getWIN_AFTER_MS()}]ms | entryWin=${getENTRY_MS()}ms`);
    lines.push(`toggle r_n=${getClickToggleR_N()} (px≈${toggleX}×${toggleY})`);

    const refT = currentRefTimeMs();
    const A = getAnswerPoints?.() || [];
    const { eligible } = splitAnswersByTimeWindow(refT);
    lines.push(`refT=${refT==null?'—':refT} | eligible=${eligible.length} / total=${A.length}`);

    const g = getLastGazePoint?.();
    if (g) lines.push(`gaze=(xn:${g.xn?.toFixed(3)}, yn:${g.yn?.toFixed(3)}, tv:${typeof g.tv==='number'?g.tv:'–'})`);

    if (lastEval){
      lines.push('— Last click eval —');
      lines.push(`dist_to_nearest_ans=${(lastEval.distToAns*100).toFixed(1)}%`);
      lines.push(`nearAnswer=${lastEval.nearAnswer?'✅':'❌'} | dwellMs=${lastEval.dwellMs} | entryOk=${lastEval.entryOk?'✅':'❌'} | PASS=${lastEval.pass?'🎉 YES':'❌ NO'}`);
    }

    ctx.save();
    ctx.font = '12px monospace';
    let y = 14 + pad;
    const x = pad;
    for (const line of lines){
      const w = ctx.measureText(line).width + 10;
      ctx.fillStyle='rgba(255,255,255,0.95)';
      ctx.strokeStyle='rgba(0,0,0,0.5)';
      ctx.fillRect(x-5,y-12,w,16);
      ctx.strokeRect(x-5,y-12,w,16);
      ctx.fillStyle='#000';
      ctx.fillText(line,x,y);
      y+=18;
    }
    ctx.restore();
  }

  function evaluateClick(click){
    const EFFECTIVE_R = rEffClick();
    const refT = (click && typeof click.t === 'number') ? (click.t|0) : currentRefTimeMs();
    const { eligible } = splitAnswersByTimeWindow(refT);
    if (!eligible.length){
      return { distToAns: Infinity, nearAnswer: false, dwellMs:'(main)', entryOk:'(main)', pass:'(main)' };
    }

    let best=Infinity;
    for (const a of eligible){
      const d=distN(click.xn,click.yn,Number(a.xn),Number(a.yn));
      if (d<best) best=d;
    }
    const near=best<=EFFECTIVE_R;
    return { distToAns:best, nearAnswer:near, dwellMs:'(main)', entryOk:'(main)', pass:'(main)' };
  }

  function renderOverlay(){
    const ctx = getCtx();
    if (!ctx) return;
    drawRings(ctx);
    drawHUD(ctx);
  }

  function onClickAdded(click){
    lastClick=click||null;
    const ev=evaluateClick(click);
    if(ev) lastEval={...ev};
  }
  function onClickDeleted(){ lastClick=null; lastEval=null; }
  function setHUD(v){ DEBUG_HUD=!!v; }
  function setRings(v){ DEBUG_SHOW_RINGS=!!v; }

  function attachKeybinds(){
    window.addEventListener('keydown',(e)=>{
      let redraw=false;
      switch(e.key){
        case'h':case'H':setHUD(!DEBUG_HUD);redraw=true;break;
        case'p':case'P':setRings(!DEBUG_SHOW_RINGS);redraw=true;break;

        // 클릭 반경 (r/R)
        case'r': setCLICK_R_MULT(clamp(getCLICK_R_MULT()-0.05,0.10,2.00)); redraw=true; break;
        case'R': setCLICK_R_MULT(clamp(getCLICK_R_MULT()+0.05,0.10,2.00)); redraw=true; break;

        // 시선 반경 (f/F)
        case'f': setGAZE_R_MULT(clamp(getGAZE_R_MULT()-0.05,0.10,2.00)); redraw=true; break;
        case'F': setGAZE_R_MULT(clamp(getGAZE_R_MULT()+0.05,0.10,2.00)); redraw=true; break;

        // dwell
        case'[': setDWELL_MS(Math.max(0,getDWELL_MS()-20)); redraw=true; break;
        case']': setDWELL_MS(getDWELL_MS()+20); redraw=true; break;

        // before window
        case';': setWIN_BEFORE_MS(Math.max(0,getWIN_BEFORE_MS()-50)); redraw=true; break;
        case"'": setWIN_BEFORE_MS(getWIN_BEFORE_MS()+50); redraw=true; break;

        // after window
        case',': setWIN_AFTER_MS(Math.max(0,getWIN_AFTER_MS()-20)); redraw=true; break;
        case'.': setWIN_AFTER_MS(getWIN_AFTER_MS()+20); redraw=true; break;
      }
      if(redraw){ lastEval=null; renderOverlay(); }
    });
  }

  if(enableKeybind) attachKeybinds();

  return { renderOverlay, onClickAdded, onClickDeleted, setHUD, setRings };
}
