const $ = s => document.querySelector(s);
const form = $('#loginForm'), err = $('#err'), btn = $('#submit');

fetch('/api/session', { credentials: 'same-origin' })
  .then(r => { if (r.ok) location.replace('index.html'); })
  .catch(() => { });

$('#toggle').addEventListener('click', e => {
  const p = $('#pass'), show = p.type === 'password';
  p.type = show ? 'text' : 'password';
  e.target.textContent = show ? 'Gizle' : 'Göster';
  e.target.setAttribute('aria-pressed', show);
});

$('#user').addEventListener('input', e => {
  e.target.value = e.target.value.toLocaleLowerCase('tr-TR');
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  err.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Giriş yapılıyor...';

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('#user').value.trim(), password: $('#pass').value })
    });
    if (res.ok) {
      location.replace('index.html');
      return;
    }
    let message = 'Giriş yapılamadı.';
    try { message = (await res.json()).error || message; } catch (x) { }
    $('#pass').value = '';
    $('#pass').focus();
    err.textContent = message;
  } catch (error) {
    err.textContent = 'Bağlantı hatası. Lütfen tekrar deneyin.';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Giriş yap';
  }
});
