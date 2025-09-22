  let sec = 5;
  const msg = document.createElement('p');
  msg.style.marginTop = "12px";
  msg.textContent = `${sec}초 후 대체 인증 페이지로 이동합니다.`;
  document.querySelector('.card').appendChild(msg);

  const timer = setInterval(() => {
    sec--;
    msg.textContent = `${sec}초 후 대체 인증 페이지로 이동합니다.`;
    if (sec <= 0) {
      clearInterval(timer);
      window.location.href = "/public/nocamera_index.html";  // ✅ 자동 연결
    }
  }, 1000);