document.getElementById("loginForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const username = document.getElementById("username").value.trim().toLowerCase();
  const password = document.getElementById("password").value.trim();
  const errorBox = document.getElementById("errorBox");
  const loginButton = document.querySelector("#loginForm button[type='submit']");

  const go = (url, msg, ok = true) => {
    errorBox.innerText = msg;
    errorBox.style.color = ok ? "green" : "red";
    errorBox.style.display = "block";
    loginButton.disabled = true;
    loginButton.innerText = "이동 중...";
    setTimeout(() => { window.location.href = url; }, 1200);
  };

  // ✅ 관리자 계정: admin + 1234 또는 "admin-1234"
  if ((username === "admin" && password === "1234") || `${username}-${password}` === "admin-1234") {
    return go("/samples/gaze/index.html", "관리자 로그인 성공 ✅");
  }

  // ✅ 시연-성공: user + 1234 또는 "user-1234"
  if ((username === "user" && password === "1234") || `${username}-${password}` === "user-1234") {
    return go("/public/destination.html", "사용자 로그인 성공 ✅");
  }

  // ✅ 시연-실패: 나머지 전부
  return go("/samples/gaze/user_index.html", "로그인 실패 → CAPTCHA로 이동 중...", false);
});
