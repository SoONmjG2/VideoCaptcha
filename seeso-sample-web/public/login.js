document.getElementById("loginForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();
  const errorBox = document.getElementById("errorBox");
  const loginButton = document.querySelector("button");

  if (username === "admin" && password === "1234") {
    // 로그인 성공 → 이동 없음
    errorBox.innerText = "✅ 로그인 성공 (여기 머무름)";
    errorBox.style.color = "green";
    errorBox.style.display = "block";

    loginButton.disabled = true;
    loginButton.innerText = "로그인됨";
    setTimeout(() => {
      window.location.href = "./destination.html";  // 또는 "/destination.html"
    }, 1500);

  } else {
    // 로그인 실패 → 캘리브레이션 페이지로 이동
    errorBox.innerText = "❌ 로그인 실패 → CAPTCHA로 이동 중...";
    errorBox.style.color = "red";
    errorBox.style.display = "block";

    loginButton.disabled = true;
    loginButton.innerText = "이동 중...";

    setTimeout(() => {
      window.location.href = "/index.html";  // ✅ 실제 서빙 경로
    }, 1500);
  }
});
