/* ======================================
 * reCAPTCHA v3 Helper (Frontend)
 * ======================================
 * - Google reCAPTCHA v3 토큰 발급 + 백엔드 검증 요청
 * - 백엔드: /api/recaptcha/verify (3000번 포트)
 * ====================================== */

const IS_LOCAL =
  ['localhost', '127.0.0.1'].includes(location.hostname) ||
  location.hostname.endsWith('.local') ||
  location.protocol === 'file:';

const API_ROOT = IS_LOCAL ? 'http://localhost:3000' : '/api';

/**
 * ✅ reCAPTCHA 검증 실행 함수
 * @param {string} action - 구글 reCAPTCHA v3 action 이름
 * @returns {Promise<{success: boolean, score: number}>}
 */
export async function verifyRecaptcha(action = 'submit') {
  try {
    if (!window.grecaptcha) {
      throw new Error('⚠️ reCAPTCHA 라이브러리가 로드되지 않았습니다.');
    }

    // 1️⃣ reCAPTCHA v3 토큰 발급
    const token = await window.grecaptcha.execute(import.meta.env.VITE_RECAPTCHA_SITE_KEY, { action });

    // 2️⃣ 백엔드로 토큰 전달 → 검증 요청
    const res = await fetch(`${API_ROOT}/api/recaptcha/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    const data = await res.json();
    if (!data.success) {
      console.warn('❌ reCAPTCHA 검증 실패:', data.error);
      return { success: false, score: 0 };
    }

    console.log(`✅ reCAPTCHA 점수: ${data.score}`);
    return data;
  } catch (err) {
    console.error('reCAPTCHA 실행 중 오류:', err);
    return { success: false, score: 0 };
  }
}
