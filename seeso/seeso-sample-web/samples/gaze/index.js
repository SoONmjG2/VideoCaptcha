import 'regenerator-runtime/runtime';
import EasySeeSo from 'seeso/easy-seeso';
import { showGaze, hideGaze } from "../showGaze";

const licenseKey = 'dev_f1hvrhiqcw78h4va2xt7ajuhtdriiqan3gjbcxy3';
const dotMaxSize = 10;
const dotMinSize = 5;

let isCalibrationMode = false;
let eyeTracker = null;
let currentX, currentY;
let calibrationButton;
let savePlayButton;
let gazeDataArray = [];
let dragDataArray = [];
let playInterval = null;
let isTracking = false;
let isDragging = false;

let answerPoints = [];

async function loadAnswerJSON() {
  try {
    const res = await fetch('./seeso-sample-web/data/drag.json',{ cache: "no-store" });  // JSON 파일 경로 맞춰주세요
    if (!res.ok) throw new Error('정답 JSON 불러오기 실패');
    
    answerPoints = await res.json();
    console.log('정답 좌표 불러옴:', answerPoints);
  } catch (e) {
    console.error('정답 JSON 로드 에러:', e);
  }
}


function getVideoClickCoordinates(event) {
  const video = event.target;
  const rect = video.getBoundingClientRect();
  const clickX = event.clientX - rect.left;
  const clickY = event.clientY - rect.top;
  return { x: clickX, y: clickY };
}

let videoStartTimestamp = null;  // 영상 재생 시작 시점 절대 시간(ms)

const video = document.getElementById("myVideo");

video.addEventListener('play', () => {
  videoStartTimestamp = Date.now();  // 영상 시작 시점의 절대 시간 기록
});

function isCorrectAnswerByTime(clickX, clickY, videoTimeMs, tolerance = 20, timeWindow = 500) {
  // 영상 기준 시간(ms)을 절대 시간으로 변환
  const absoluteTime = videoStartTimestamp + videoTimeMs;

  // 정답 데이터 timestamp는 절대 시간이므로, 영상 절대 시간과 비교
  const candidates = answerPoints.filter(p => Math.abs(p.timestamp - absoluteTime) <= timeWindow);

  return candidates.some(point => {
    const dx = point.x - clickX;
    const dy = point.y - clickY;
    return Math.sqrt(dx * dx + dy * dy) <= tolerance;
  });
}



function addVideoClickListener() {
  const video = document.getElementById("myVideo");
  if (!video) return;

  video.addEventListener('click', (e) => {
    const { x, y } = getVideoClickCoordinates(e);
    const videoTimeMs = video.currentTime * 1000;

    if (isCorrectAnswerByTime(x, y, videoTimeMs)) {
      alert('정답입니다!');
    } else {
      alert('정답입니다!');
    }
  });
}


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
    hideCalibrationTitle();

    const video = document.getElementById("myVideo");
    if (video) video.style.display = 'none';
  }
}

function onGaze(gazeInfo) {
  if (!isCalibrationMode && isTracking) {
    showGaze(gazeInfo);
    gazeDataArray.push({
      timestamp: Date.now(),
      x: gazeInfo.x,
      y: gazeInfo.y
    });
  } else {
    hideGaze();
  }
}

function onCalibrationNextPoint(pointX, pointY) {
  currentX = pointX;
  currentY = pointY;
  let ctx = clearCanvas();
  drawCircle(currentX, currentY, dotMinSize, ctx);
  eyeTracker.startCollectSamples();
}

function onCalibrationProgress(progress) {
  let ctx = clearCanvas();
  let dotSize = dotMinSize + (dotMaxSize - dotMinSize) * progress;
  drawCircle(currentX, currentY, dotSize, ctx);
}

function drawCircle(x, y, dotSize, ctx) {
  ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
  ctx.beginPath();
  ctx.arc(x, y, dotSize, 0, Math.PI * 2, true);
  ctx.fill();
}

function onCalibrationFinished(calibrationData) {
  clearCanvas();
  isCalibrationMode = false;
  calibrationButton.style.display = 'none';
  hideCalibrationTitle();

  eyeTracker.showImage();
  isTracking = true;

  if (savePlayButton) savePlayButton.style.display = 'inline-block';

  const video = document.getElementById("myVideo");
  if (video) {
    video.style.display = 'block';
    video.play();
  }

  const overlayText = document.getElementById('overlayText');
  if (overlayText) overlayText.style.display = 'block';
}

function clearCanvas() {
  let canvas = document.getElementById("output");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  let ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  return ctx;
}

function showFocusText() {
  let focusText = document.createElement("div");
  focusText.innerText = "Focus on point";
  focusText.style.position = "fixed";
  focusText.style.top = "50%";
  focusText.style.left = "50%";
  focusText.style.transform = "translate(-50%, -50%)";
  document.body.appendChild(focusText);
  return focusText;
}

function hideFocusText(focusText) {
  document.body.removeChild(focusText);
}

function hideCalibrationTitle() {
  const calibrationTitle = document.getElementById("calibrationTitle");
  if (calibrationTitle) calibrationTitle.style.display = "none";
}

function showCalibrationTitle() {
  const calibrationTitle = document.getElementById("calibrationTitle");
  if (calibrationTitle) calibrationTitle.style.display = "block";
}

function saveSeparateJsonFiles() {
  if (gazeDataArray.length === 0 && dragDataArray.length === 0) {
    alert("저장할 데이터가 없습니다.");
    return false;
  }

  // 시선 데이터 JSON 생성
  const gazeJsonContent = JSON.stringify(gazeDataArray, null, 2);

  // 드래그 데이터 JSON 생성
  const dragJsonContent = JSON.stringify(dragDataArray, null, 2);

  // JSON 다운로드 헬퍼
  function downloadJson(filename, content) {
    const blob = new Blob([content], { type: 'application/json;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // 시선 데이터 저장
  downloadJson(`gaze_data_${new Date().toISOString()}.json`, gazeJsonContent);
  // 드래그 데이터 저장
  downloadJson(`drag_data_${new Date().toISOString()}.json`, dragJsonContent);

  return true;
}


let isPlayingBack = false;

function playGazeAndDragWithVideoSync() {

  if (isPlayingBack) return;  // 이미 재생 중이면 중복 실행 막기
  isPlayingBack = true;

  const video = document.getElementById("myVideo");
  if (!video) {
    alert("비디오 요소가 없습니다.");
    return;
  }

  const ctx = document.getElementById("output").getContext("2d");

  let startTime = Math.min(
    gazeDataArray.length ? gazeDataArray[0].timestamp : Infinity,
    dragDataArray.length ? dragDataArray[0].timestamp : Infinity
  );

  let lastGazeTime = gazeDataArray.length ? gazeDataArray[gazeDataArray.length - 1].timestamp : 0;
  let lastDragTime = dragDataArray.length ? dragDataArray[dragDataArray.length - 1].timestamp : 0;
  let lastTimestamp = Math.max(lastGazeTime, lastDragTime);

  function drawFrame() {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    const currentVideoTimeMs = video.currentTime * 1000;

    // 누적 데이터 그리기
    for (let i = 0; i < gazeDataArray.length; i++) {
      if (gazeDataArray[i].timestamp - startTime <= currentVideoTimeMs) {
        drawCircle(gazeDataArray[i].x, gazeDataArray[i].y, dotMinSize, ctx);
      }
    }

    let prevDragPoint = null;
    for (let i = 0; i < dragDataArray.length; i++) {
      if (dragDataArray[i].timestamp - startTime <= currentVideoTimeMs) {
        const point = dragDataArray[i];
        if (point.type === 'start') {
          prevDragPoint = { x: point.x, y: point.y };
        } else if (point.type === 'move' && prevDragPoint) {
          ctx.strokeStyle = '#0000FF';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(prevDragPoint.x, prevDragPoint.y);
          ctx.lineTo(point.x, point.y);
          ctx.stroke();
          prevDragPoint = { x: point.x, y: point.y };
        } else if (point.type === 'end') {
          prevDragPoint = null;
        }
      }
    }

    // 재생 시간이 데이터 끝에 도달하면 영상 멈춤
    if (currentVideoTimeMs >= (lastTimestamp - startTime)) {
      if (!video.paused) {
        video.pause();
      }
      isPlayingBack = false;  // 재생 종료 표시
      return;
    }

    if (!video.paused && !video.ended) {
      requestAnimationFrame(drawFrame);
    }
  }

  requestAnimationFrame(drawFrame);
}



function onClickSavePlayBtn() {
  if (eyeTracker && isTracking) {
    eyeTracker.stopTracking();
    isTracking = false;
  }

  const saved = saveSeparateJsonFiles();
  if (!saved) return;

  playGazeAndDragWithVideoSync();

  const video = document.getElementById("myVideo");
  if (video) {
    video.currentTime = 0;  // 영상 처음으로 이동
    video.play();
  }
  
}

async function main() {
  if (!calibrationButton) {
    calibrationButton = document.getElementById('calibrationButton');
    calibrationButton.addEventListener('click', onClickCalibrationBtn);
    calibrationButton.disabled = true;
  }

  if (!savePlayButton) {
    savePlayButton = document.createElement('button');
    savePlayButton.id = 'savePlayButton';
    savePlayButton.innerText = 'Save & Play';
    savePlayButton.style.padding = '10px 20px';
    savePlayButton.style.fontSize = '16px';
    savePlayButton.style.display = 'none';
    savePlayButton.style.marginTop = '10px';
    document.querySelector('.container').appendChild(savePlayButton);

    savePlayButton.addEventListener('click', onClickSavePlayBtn);
  }

  if (!eyeTracker) {
    eyeTracker = new EasySeeSo();

    await eyeTracker.init(
      licenseKey,
      async () => {
        await eyeTracker.startTracking(onGaze, () => {});
        eyeTracker.showImage();

        if (!eyeTracker.checkMobile()) {
          eyeTracker.setMonitorSize(14);
          eyeTracker.setFaceDistance(50);
          eyeTracker.setCameraPosition(window.outerWidth / 2, true);
        }

        calibrationButton.disabled = false;
      },
      () => console.log("callback when init failed.")
    );
  } else {
    calibrationButton.disabled = false;
  }

  document.addEventListener('mousedown', (e) => {
    if (!isCalibrationMode && isTracking&& videoStartTimestamp) {
      isDragging = true;
      dragDataArray.push({
        type: 'start',
        timestamp: Date.now(),
        x: e.clientX,
        y: e.clientY
      });
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (isDragging && isTracking) {
      dragDataArray.push({
        type: 'move',
        timestamp: Date.now(),
        x: e.clientX,
        y: e.clientY
      });
      const canvas = document.getElementById('output');
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0000FF';
      ctx.beginPath();
      ctx.arc(e.clientX, e.clientY, 3, 0, Math.PI * 2, true);
      ctx.fill();
    }
  });

  document.addEventListener('mouseup', (e) => {
    if (isDragging && isTracking) {
      isDragging = false;
      dragDataArray.push({
        type: 'end',
        timestamp: Date.now(),
        x: e.clientX,
        y: e.clientY
      });
    }
  });

  // 정답 CSV 파일 읽기
  await loadAnswerJSON();

  // 영상 클릭 이벤트 등록
  addVideoClickListener();

}

(async () => {
  await main();

  const video = document.getElementById("myVideo");
  if (video) {
    video.style.display = 'none';

    video.addEventListener("play", () => {
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
  }
})();
