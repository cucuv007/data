(function () {
  const KEY = 'evrak-allow-index';
  let allowed = false;
  try {
    allowed = sessionStorage.getItem(KEY) === '1';
    sessionStorage.removeItem(KEY);
  } catch (e) { }
  if (allowed) return;
  document.documentElement.style.display = 'none';
  try {
    fetch('/api/logout', { method: 'POST', credentials: 'same-origin', keepalive: true });
  } catch (e) { }
  location.replace('login.html');
})();
