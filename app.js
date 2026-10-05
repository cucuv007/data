/* Evrak Kontrol
   Alanlar: kurul, plaka, tarih, driver, not, htt (dosya), fatura (dosya)
   Veriler tarayıcıdaki IndexedDB'de tutulur. Sunucuya/SQL'e bağlarken
   yalnızca aşağıdaki "Veri katmanı" bölümünü değiştirmeniz yeterli. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Veri katmanı (IndexedDB) ---------- */
const DB = {
  _db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('evrak-kontrol', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kayitlar', { keyPath: 'id', autoIncrement: true });
      r.onsuccess = () => { this._db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  _tx(mode, fn) {
    return new Promise((res, rej) => {
      const tx = this._db.transaction('kayitlar', mode);
      const req = fn(tx.objectStore('kayitlar'));
      tx.oncomplete = () => res(req.result);
      tx.onerror = () => rej(tx.error);
    });
  },
  all()      { return this._tx('readonly',  s => s.getAll()); },
  save(rec)  { return this._tx('readwrite', s => s.put(rec)); },   // id varsa günceller
  remove(id) { return this._tx('readwrite', s => s.delete(id)); }
};

/* ---------- Durum ---------- */
let records = [];
let editing = null;           // düzenlenen kayıt (yeni ise null)
let files = { htt: null, fatura: null };
let viewUrl = null;

/* ---------- Liste ---------- */
let applied = {};   // "Listele" ile uygulanan filtreler
const tr = s => String(s ?? '').toLocaleLowerCase('tr');
const plakaKey = s => tr(s).replace(/\s+/g, '');

function readFilters() {
  return {
    q: $('#q').value.trim(), plaka: $('#fPlaka').value.trim(), driver: $('#fDriver').value.trim(),
    kurul: $('#kurulFilter').value, not: $('#fNot').value.trim(),
    from: $('#fFrom').value, to: $('#fTo').value, htt: $('#fHtt').value, fatura: $('#fFatura').value
  };
}
function matches(r, f) {
  if (f.q && !tr([r.plaka, r.driver, r.kurul].join(' ')).includes(tr(f.q))) return false;
  if (f.plaka && !plakaKey(r.plaka).includes(plakaKey(f.plaka))) return false;
  if (f.driver && !tr(r.driver).includes(tr(f.driver))) return false;
  if (f.kurul && r.kurul !== f.kurul) return false;
  if (f.not && !tr(r.not).includes(tr(f.not))) return false;
  if (f.from && (r.tarih || '') < f.from) return false;
  if (f.to && (r.tarih || '9') > f.to) return false;
  if (f.htt && (f.htt === 'var') !== !!r.htt) return false;
  if (f.fatura && (f.fatura === 'var') !== !!r.fatura) return false;
  return true;
}
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

function render() {
  const rows = records
    .filter(r => matches(r, applied))
    .sort((a, b) => (b.tarih || '').localeCompare(a.tarih || '') || b.id - a.id);

  $('#count').textContent = `${rows.length} kayıt`;
  $('#list').innerHTML = rows.map(r => `
    <tr data-id="${r.id}">
      <td class="plaka"><span class="plate"><b>${esc(r.plaka)}</b></span></td>
      <td class="tarih date">${fmtDate(r.tarih)}</td>
      <td class="kurul">${esc(r.kurul)}</td>
      <td class="driver">${esc(r.driver)}</td>
      <td class="note" title="${esc(r.not)}">${esc(r.not)}</td>
      <td class="htt">${docChip('htt', 'HTT', r.htt)}</td>
      <td class="fatura">${docChip('fatura', 'Fatura', r.fatura)}</td>
      <td class="act">
        <button class="btn ghost small" data-act="edit">Düzenle</button>
        <button class="btn ghost small danger" data-act="del">Sil</button>
      </td>
    </tr>`).join('');

  $('#grid').hidden = rows.length === 0;
  const empty = $('#empty');
  empty.hidden = rows.length > 0;
  empty.textContent = records.length ? 'Aramanızla eşleşen kayıt yok.' : 'Henüz kayıt yok. “Yeni kayıt” ile ilk evrakı ekleyin.';

  refreshKurulLists();
}

const docChip = (key, label, f) => f
  ? `<button class="doc has" data-act="view" data-key="${key}">${label} · Göster</button>`
  : `<span class="doc none">${label} yok</span>`;

function refreshKurulLists() {
  const kurullar = [...new Set(records.map(r => r.kurul).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
  const sel = $('#kurulFilter'), cur = sel.value;
  sel.innerHTML = '<option value="">Tüm kurullar</option>' + kurullar.map(k => `<option>${esc(k)}</option>`).join('');
  sel.value = kurullar.includes(cur) ? cur : '';
  $('#kurulList').innerHTML = kurullar.map(k => `<option value="${esc(k)}">`).join('');
}

/* ---------- Form ---------- */
function openForm(rec = null) {
  editing = rec;
  const f = $('#form');
  f.reset();
  $('#formTitle').textContent = rec ? 'Kaydı düzenle' : 'Yeni kayıt';
  ['kurul', 'plaka', 'tarih', 'driver', 'not'].forEach(k => f.elements[k].value = rec?.[k] ?? '');
  if (!rec) f.elements.tarih.value = new Date().toISOString().slice(0, 10);
  files = { htt: rec?.htt ?? null, fatura: rec?.fatura ?? null };
  syncFileBoxes();
  $('#formDlg').showModal();
}

function syncFileBoxes() {
  $$('.file').forEach(box => {
    const f = files[box.dataset.key];
    box.classList.toggle('has', !!f);
    $('.file-name', box).textContent = f ? f.name : 'Dosya seçilmedi';
  });
}

$$('.file').forEach(box => {
  const key = box.dataset.key, input = $('input[type=file]', box);
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    files[key] = { name: file.name, type: file.type, blob: file };
    input.value = '';
    syncFileBoxes();
  });
  $('[data-remove]', box).addEventListener('click', () => { files[key] = null; syncFileBoxes(); });
  $('[data-view]', box).addEventListener('click', () => showFile(files[key], key === 'htt' ? 'HTT' : 'Fatura'));
});

$('#form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target.elements;
  const rec = {
    ...(editing || {}),
    kurul: f.kurul.value.trim(),
    plaka: f.plaka.value.trim().toLocaleUpperCase('tr'),
    tarih: f.tarih.value,
    driver: f.driver.value.trim(),
    not: f.not.value.trim(),
    htt: files.htt,
    fatura: files.fatura
  };
  try {
    await DB.save(rec);
    records = await DB.all();
    $('#formDlg').close();
    render();
    toast(editing ? 'Kayıt güncellendi' : 'Kayıt eklendi');
  } catch (err) {
    toast('Kaydedilemedi. Depolama alanı dolu olabilir.');
    console.error(err);
  }
});

/* ---------- Görüntüleyici ---------- */
function showFile(f, title) {
  if (!f) return;
  closeViewUrl();
  viewUrl = URL.createObjectURL(f.blob);
  $('#viewTitle').textContent = `${title} · ${f.name}`;
  $('#viewOpen').href = viewUrl;
  $('#viewBody').innerHTML = f.type === 'application/pdf'
    ? `<iframe src="${viewUrl}" title="${esc(f.name)}"></iframe>`
    : `<img src="${viewUrl}" alt="${esc(f.name)}">`;
  $('#viewDlg').showModal();
}
function closeViewUrl() { if (viewUrl) { URL.revokeObjectURL(viewUrl); viewUrl = null; } }
$('#viewDlg').addEventListener('close', () => { $('#viewBody').innerHTML = ''; closeViewUrl(); });

/* ---------- Olaylar ---------- */
const docTitle = key => key === 'htt' ? 'HTT' : 'Fatura';
const recOf = tr => records.find(r => r.id === +tr.dataset.id);

async function deleteRec(rec) {
  if (!confirm(`${rec.plaka} plakalı kayıt silinsin mi?`)) return;
  await DB.remove(rec.id);
  records = await DB.all();
  render();
  toast('Kayıt silindi');
}

$('#list').addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const rec = recOf(btn.closest('tr'));
  if (!rec) return;
  const act = btn.dataset.act;
  if (act === 'edit') openForm(rec);
  if (act === 'view') showFile(rec[btn.dataset.key], docTitle(btn.dataset.key));
  if (act === 'del') deleteRec(rec);
});

/* Ara: girilen filtreleri uygular */
async function ara() {
  applied = readFilters();
  const n = ['plaka', 'driver', 'kurul', 'not', 'from', 'to', 'htt', 'fatura'].filter(k => applied[k]).length;
  $('#advBadge').textContent = n;
  $('#advBadge').hidden = !n;
  records = await DB.all();
  render();
}
/* Listele: filtreleri temizleyip tüm kayıtları getirir */
function listeleHepsi() {
  $('#q').value = '';
  $$('#adv input, #adv select').forEach(el => el.value = '');
  return ara();
}
$('#searchBtn').addEventListener('click', ara);
$('#advSearchBtn').addEventListener('click', ara);
$('#listBtn').addEventListener('click', listeleHepsi);
['#q', '#fPlaka', '#fDriver', '#fNot'].forEach(s => $(s).addEventListener('keydown', e => { if (e.key === 'Enter') ara(); }));

$('#advBtn').addEventListener('click', () => {
  const open = $('#adv').hidden;
  $('#adv').hidden = !open;
  $('#advBtn').setAttribute('aria-expanded', open);
});
$('#clearBtn').addEventListener('click', listeleHepsi);

/* Sağ tık (telefonda basılı tutma) menüsü */
const ctx = $('#ctx');
let ctxRec = null, pressTimer;

function openCtx(tr, x, y) {
  ctxRec = recOf(tr);
  if (!ctxRec) return;
  $$('#list tr.sel').forEach(t => t.classList.remove('sel'));
  tr.classList.add('sel');
  $('[data-ctx=htt]', ctx).disabled = !ctxRec.htt;
  $('[data-ctx=fatura]', ctx).disabled = !ctxRec.fatura;
  ctx.hidden = false;
  const w = ctx.offsetWidth, h = ctx.offsetHeight;
  ctx.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px';
  ctx.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + 'px';
}
function closeCtx() { ctx.hidden = true; $$('#list tr.sel').forEach(t => t.classList.remove('sel')); }

$('#list').addEventListener('contextmenu', e => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  e.preventDefault();
  openCtx(tr, e.clientX, e.clientY);
});
$('#list').addEventListener('touchstart', e => {
  const tr = e.target.closest('tr');
  if (!tr || e.target.closest('button')) return;
  const t = e.touches[0];
  pressTimer = setTimeout(() => openCtx(tr, t.clientX, t.clientY), 550);
}, { passive: true });
['touchend', 'touchmove', 'touchcancel'].forEach(ev => $('#list').addEventListener(ev, () => clearTimeout(pressTimer), { passive: true }));

ctx.addEventListener('click', e => {
  const b = e.target.closest('[data-ctx]');
  if (!b || b.disabled) return;
  const rec = ctxRec, a = b.dataset.ctx;
  closeCtx();
  if (a === 'htt' || a === 'fatura') showFile(rec[a], docTitle(a));
  if (a === 'edit') openForm(rec);
  if (a === 'del') deleteRec(rec);
});
document.addEventListener('pointerdown', e => { if (!ctx.hidden && !ctx.contains(e.target)) closeCtx(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCtx(); });
addEventListener('scroll', closeCtx, true);
addEventListener('resize', closeCtx);

$('#addBtn').addEventListener('click', () => openForm());
$$('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
$$('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); })); // dışına dokununca kapat

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- Çıkış ---------- */
$('#logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('evrak-oturum');
  sessionStorage.removeItem('evrak-oturum');
  location.replace('login.html');
});

/* ---------- Başlat ---------- */
DB.open().then(DB.all.bind(DB)).then(rows => { records = rows; render(); });
