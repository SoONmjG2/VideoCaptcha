# VideoCaptcha
# 로봇이 아닙니다 (영상 기반 CAPTCHA 시스템)

Human Pose와 실시간 시선 추적(Eye Tracking)을 결합하여 AI의 우회 공격을 차단하는 사용자 행동 기반의 영상 CAPTCHA 시스템입니다.

## 프로젝트 개요\
* **소속**: 덕성여자대학교 사이버보안학과 졸업작품
* **개발 기간**: 2024년 11월 11일 ~ 2025년 12월 1일
* **팀 구성**: 3인 
* **배경**: 기존 텍스트 및 이미지 CAPTCHA는 AI의 발전으로 우회가 가능해져 보안성이 크게 저하되었습니다 (참고 논문: Breaking reCAPTCHAv2).
* **해결책**: AI 모델이 정확히 인식하지 못하는 지점(관절 신뢰도 임곗값 0.3 이하)을 문제 영역으로 설정하고, 사용자의 클릭 행동과 실시간 시선 추적 데이터를 함께 분석하여 사람과 AI 봇을 구분합니다.

## Tech Stack
* **Backend**: Node.js, JavaScript, Linux
* **Database / Storage**: MongoDB, Firebase
* **API & Tools**: MMPose, Seeso API, Google ReCAPTCHA v3, Render

## 주요 기능
* **문제 데이터셋 구축**: MMPose를 사용해 2,000개 오픈 소스 영상의 프레임별 관절 좌표와 신뢰도를 분석하고, AI 미인식 구간이 명확한 50개의 영상을 선별해 출제합니다.[cite: 2]
* **시선 추적 기반 인증**: Seeso API로 웹캠 기반 사용자 시선 데이터를 실시간 추적 및 수집합니다.[cite: 2]
* **복합 인증 체계**: 시선 시계열 분석, 클릭 이벤트 정답 판정, ReCaptcha v3 점수를 종합 평가하여 로그인 성공 여부를 판정합니다.[cite: 2]
* **대체 인증 지원**: 카메라를 사용할 수 없는 환경을 위해 소리 기반 대체 인증을 제공합니다.[cite: 2]
* **관리자 페이지**: 사용자 시선 데이터 좌표를 시각적으로 표시하는 페이지를 제공합니다.[cite: 2]

## 데이터셋 검증 (MMPose 영상 분석)

MMPose를 사용해 2,000개 오픈 소스 영상의 프레임별 관절 좌표와 신뢰도(Confidence)를 JSON으로 추출하고, 대표적 Human Pose Estimation 오픈소스인 MMPose로 영상을 분석했습니다.[cite: 2]

> **Human Pose Estimation(관절 추정)이란?**
> 이미지나 영상 속 사람의 주요 신체 관절 위치를 AI가 탐지하고 추적하는 컴퓨터 비전 기술

<br>

### 1. MMPose를 적용한 영상 분석 결과
```python
from mmpose.apis import MMPoseInferencer

# 비디오 절대 경로 설정 (분석 대상 영상)
video_path = '/home/ds/cctv-action-recognition-dataset/Videos/Videos/fall/NTU_fight0003_fall_1.mp4'

# MMPose 모델 초기화 (Human Pose 추정용)
inferencer = MMPoseInferencer('human')

# 영상 추론 실행 및 결과물 디렉토리 저장
results = list(inferencer(video_path, show=False, out_dir='outputs'))

# 추출된 데이터 구조 확인
for r in results:
    print(r.keys())

print("Inference 완료! 'outputs/vis/' 폴더를 확인하세요.")
'''
<img width="917" height="515" alt="image" src="https://github.com/user-attachments/assets/7fa7c541-b768-4b0e-b4f0-27c0b337b3f3" />
*MMPose를 통한 영상 속 사람 관절 인식 결과 화면*

<br>

### 2. 관절 신뢰도(Confidence) 시각화 및 데이터 선별
`THRESHOLD = 0.3` 기준으로 인식 성공(초록색) / 인식 실패(빨간색) 점을 영상 위에 매핑하여 시각화했습니다.[cite: 2]

<img width="897" height="570" alt="image" src="https://github.com/user-attachments/assets/3358093d-110c-4eac-a170-82b687f2462a" />


**최종 선별 결과**
분석 결과, AI 미인식 구간이 명확하여 CAPTCHA 문제용으로 적합한 **50개의 영상 데이터셋을 선별**했습니다.[cite: 2]

## 주요 백엔드 구현 로직
* **클릭 좌표 오차 거리 측정**: 사용자의 클릭 좌표(`c`)가 정답 좌표(`A`) 근처(`rN` 반경) 안에 있는지 유클리드 거리를 계산하여 확인합니다.[cite: 2]
```javascript
function nearAnswer(c, A, rN) {
  return (A||[]).some(a => distN(c.xn, c.yn, Number(a.xn), Number(a.yn)) <= rN);
}
