const SUPABASE_URL = 'https://rcvyytkxcgmydkcicxdz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_GpnawTaymipKiC-n4HEUcw_D5_eyEgT';
const TABLE_NAME = 'Tespit';
const STORAGE_BUCKET = 'evrak_files';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Veri katmanı (Supabase) ---------- */
const recKey = rec => [rec?.kurul ?? '', rec?.tarih ?? '', rec?.plaka ?? ''].join('::');
const isSyntheticId = id => typeof id === 'string' && id.includes('::');
const normalizeBool = v => v === true || v === 'true' || v === 1 || v === '1';
const stripSyntheticId = data => {
  const out = { ...data };
  if (isSyntheticId(out.id)) delete out.id;
  return out;
};

const DB = {
  async req(path, method = 'GET', body = null) {
    const opts = {
      method,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'return=representation'
      }
    };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${SUPABASE_URL}${path}`, opts);
    if (!res.ok) throw new Error(await res.text());
    if (method === 'DELETE' || res.status === 204) return null;
    return await res.json();
  },
  async all() {
    const rows = await this.req(`/rest/v1/${TABLE_NAME}?select=*`);
    return rows.map(r => ({ ...r, id: r.id ?? recKey(r), durum: normalizeBool(r.durum) }));
  },
  async save(rec) {
    const isUpdate = !!rec.id && !isSyntheticId(rec.id);
    const isSyntheticRow = isSyntheticId(rec.id);
    const filter = `kurul=eq.${encodeURIComponent(rec.kurul)}&tarih=eq.${encodeURIComponent(rec.tarih)}&plaka=eq.${encodeURIComponent(rec.plaka)}`;
    const payload = { ...stripSyntheticId(rec), durum: normalizeBool(rec.durum ?? false) };

    // Mükerrer kontrolü (kurul, tarih, plaka)
    if (!isUpdate) {
      const dup = await this.req(`/rest/v1/${TABLE_NAME}?${filter}&select=*`);
      const sameRow = dup.some(r => r.kurul === rec.kurul && r.tarih === rec.tarih && r.plaka === rec.plaka && (isSyntheticRow ? true : !(r.kurul === rec.kurul && r.tarih === rec.tarih && r.plaka === rec.plaka)));
      if (dup && dup.length > 0 && !sameRow) {
        throw new Error('Bu Kurul, Tarih ve Plaka ile daha önce bir kayıt girilmiş (Mükerrer Kayıt).');
      }
    }

    if (isUpdate) {
      const { id, ...data } = rec;
      return this.req(`/rest/v1/${TABLE_NAME}?id=eq.${id}`, 'PATCH', { ...data, durum: normalizeBool(data.durum ?? false) });
    }

    if (isSyntheticRow) {
      const { id, ...data } = rec;
      return this.req(`/rest/v1/${TABLE_NAME}?${filter}`, 'PATCH', { ...stripSyntheticId(data), durum: normalizeBool(data.durum ?? false) });
    }

    return this.req(`/rest/v1/${TABLE_NAME}`, 'POST', payload);
  },
  async remove(id) {
    if (isSyntheticId(id)) {
      const [kurul, tarih, plaka] = String(id).split('::');
      return this.req(`/rest/v1/${TABLE_NAME}?kurul=eq.${encodeURIComponent(kurul)}&tarih=eq.${encodeURIComponent(tarih)}&plaka=eq.${encodeURIComponent(plaka)}`, 'DELETE');
    }
    return this.req(`/rest/v1/${TABLE_NAME}?id=eq.${id}`, 'DELETE');
  }
};

/* ---------- Dosya Sıkıştırma ve Yükleme ---------- */
async function compressImage(file, maxDim = 1200) {
  if (file.type === 'application/pdf') return file; // PDF'ler sıkıştırılmaz
  return new Promise(res => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => res(new File([blob], file.name, { type: 'image/jpeg' })), 'image/jpeg', 0.8);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadFile(file) {
  const comp = await compressImage(file);
  const ext = (comp.name.split('.').pop() || 'jpg').toLowerCase();
  const fileName = Date.now() + '_' + Math.random().toString(36).substr(2, 5) + '.' + ext;
  
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${fileName}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': comp.type || 'application/octet-stream'
    },
    body: comp
  });
  if (!res.ok) {
    throw new Error(`Dosya yüklenemedi. Supabase Storage bucket "${STORAGE_BUCKET}" mevcut değil veya erişim kapalı. Önce Supabase > Storage > New bucket ile "${STORAGE_BUCKET}" adında public bucket oluşturup tekrar deneyin.`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${fileName}`;
}

/* ---------- Durum ---------- */
let records = [];
let editing = null;
let files = { htt: [], fatura: [] };
let viewUrl = null;

/* ---------- Liste ---------- */
let applied = {};
let sorunluFilterActive = false;
const tr = s => String(s ?? '').toLocaleLowerCase('tr');
const plakaKey = s => tr(s).replace(/\s+/g, '');
const rowId = r => String(r?.id ?? recKey(r));

function normalizePlateValue(raw) {
  let v = String(raw ?? '').replace(/[^A-Za-z0-9\s]/g, '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('tr');
  if (!v) return '';
  if (/^\d{2}\b/.test(v)) return v;
  return `07 ${v}`;
}

function updateSorunluButton() {
  const btn = $('#sorunluBtn');
  if (!btn) return;
  const flagged = records.filter(r => normalizeBool(r.durum)).length;
  btn.textContent = `Sorunlu${sorunluFilterActive ? ` (${flagged})` : ''}`;
  btn.classList.remove('ghost', 'primary');
  btn.classList.add('danger');
  btn.setAttribute('aria-pressed', String(sorunluFilterActive));
}

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
  if (sorunluFilterActive && !normalizeBool(r.durum)) return false;
  return true;
}
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

function render() {
  const rows = records.filter(r => matches(r, applied));
  $('#count').textContent = `${rows.length} kayıt`;
  $('#list').innerHTML = rows.map(r => {
    const status = normalizeBool(r.durum);
    return `
    <tr data-id="${rowId(r)}" data-status="${status}">
      <td class="plaka"><span class="plate"><b>${esc(r.plaka)}</b></span></td>
      <td class="tarih date">${fmtDate(r.tarih)}</td>
      <td class="kurul">${esc(r.kurul)}</td>
      <td class="driver">${esc(r.driver)}</td>
      <td class="note" title="${esc(r.not)}">${esc(r.not || '—')}</td>
      <td class="durum">${status ? '<span class="doc has">Sorunlu</span>' : '<span class="doc none">Normal</span>'}</td>
      <td class="htt">${docChip('htt', r.htt)}</td>
      <td class="fatura">${docChip('fatura', r.fatura)}</td>
      <td class="act">
        <button class="btn ghost small" data-act="edit">Düzenle</button>
        <button class="btn ghost small danger" data-act="del">Sil</button>
      </td>
    </tr>`;
  }).join('');

  $('#grid').hidden = rows.length === 0;
  $('#empty').hidden = rows.length > 0;
  $('#empty').textContent = records.length ? 'Aramanızla eşleşen kayıt yok.' : 'Henüz kayıt yok. “Yeni kayıt” ile ilk evrakı ekleyin.';
  updateSorunluButton();
  refreshKurulLists();
}

function docChip(key, jsonStr) {
  try {
    const arr = JSON.parse(jsonStr || '[]');
    if (arr && arr.length > 0) {
      return `<button class="doc has" data-act="view" data-key="${key}">${arr.length} Dosya</button>`;
    }
  } catch(e) {}
  return `<span class="doc none">Yok</span>`;
}

function refreshKurulLists() {
  const kurullar = [...new Set(records.map(r => r.kurul).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
  const sel = $('#kurulFilter'), cur = sel.value;
  sel.innerHTML = '<option value="">Tüm kurullar</option>' + kurullar.map(k => `<option>${esc(k)}</option>`).join('');
  sel.value = kurullar.includes(cur) ? cur : '';
  $('#kurulList').innerHTML = kurullar.map(k => `<option value="${esc(k)}">`).join('');
}

/* ---------- Form ---------- */
function setSaveStatus(msg = '', mode = 'info') {
  const status = $('#saveState');
  if (!status) return;
  status.hidden = !msg;
  status.textContent = msg;
  status.classList.remove('is-busy', 'is-success', 'is-error');
  if (msg) status.classList.add(`is-${mode}`);
}

function openForm(rec = null) {
  editing = rec;
  const f = $('#form');
  f.reset();
  $('#formTitle').textContent = rec ? 'Kaydı düzenle' : 'Yeni kayıt';
  setSaveStatus('', 'info');
  ['kurul', 'plaka', 'tarih', 'driver', 'not'].forEach(k => f.elements[k].value = rec?.[k] ?? '');
  if (!rec) f.elements.tarih.value = new Date().toISOString().slice(0, 10);
  if (f.elements.plaka) {
    f.elements.plaka.addEventListener('input', e => {
      e.target.value = normalizePlateValue(e.target.value);
    }, { once: true });
  }
  if (f.elements.durum) f.elements.durum.checked = normalizeBool(rec?.durum ?? false);
  
  files = { htt: [], fatura: [] };
  if (rec) {
    try { files.htt = rec.htt ? JSON.parse(rec.htt).map(u => ({ url: u, name: u.split('/').pop() })) : []; } catch(e){}
    try { files.fatura = rec.fatura ? JSON.parse(rec.fatura).map(u => ({ url: u, name: u.split('/').pop() })) : []; } catch(e){}
  }
  syncFileBoxes();
  const formDlg = $('#formDlg');
  formDlg.setAttribute('open', 'open');
  formDlg.focus();
}

function syncFileBoxes() {
  $$('.file').forEach(box => {
    const key = box.dataset.key;
    const fs = (window.files || files)[key];
    box.classList.toggle('has', fs.length > 0);
    const boxInner = $('.file-box', box);
    
    if (fs.length > 0) {
      boxInner.innerHTML = fs.map((f, i) => `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;background:var(--line);padding:4px 8px;border-radius:4px;">
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;">${esc(f.name)}</span>
          ${f.url ? `<a href="${f.url}" target="_blank" class="link small">Aç</a>` : ''}
          <button type="button" class="link danger small" data-remove-idx="${i}">Sil</button>
        </div>
      `).join('');
    } else {
      boxInner.innerHTML = `<span class="file-name">Dosya seçilmedi</span>`;
    }

    $$('[data-remove-idx]', box).forEach(btn => {
       btn.onclick = (e) => {
         e.preventDefault();
         files[key].splice(btn.dataset.removeIdx, 1);
         syncFileBoxes();
       };
    });
  });
}

/* ---------- Otomatik Yükleme (Klasörden) ---------- */
async function pickDirectoryFallbackAndProcess() {
  // Fallback using webkitdirectory input
  const input = $('#dirPickerFallback');
  return new Promise(res => {
    const handler = async () => {
      try {
        const files = [...input.files];
        await processPickedFiles(files, /*rootName*/ null);
      } catch (e) { console.error(e); }
      input.value = '';
      input.removeEventListener('change', handler);
      res();
    };
    input.addEventListener('change', handler);
    input.click();
  });
}

async function pickDirectoryAndProcess() {
  // Prefer File System Access API if available
  if (window.showDirectoryPicker) {
    try {
      const dir = await window.showDirectoryPicker();
      const files = [];
      async function recurse(d, prefix = '') {
        for await (const [name, handle] of d.entries()) {
          try {
            if (handle.kind === 'file') {
              try {
                const f = await handle.getFile();
                // emulate webkitRelativePath by prefixing folder name(s)
                Object.defineProperty(f, 'webkitRelativePath', { value: prefix ? (prefix + '/' + name) : name, configurable: true });
                files.push(f);
              } catch (fe) {
                console.warn('file read failed', name, fe);
                continue;
              }
            } else if (handle.kind === 'directory') {
              await recurse(handle, prefix ? (prefix + '/' + name) : name);
            }
          } catch (entErr) {
            console.warn('entry iteration failed', name, entErr);
            continue;
          }
        }
      }
      await recurse(dir);
      await processPickedFiles(files, dir.name);
    } catch (e) {
      console.error(e);
      // fallback
      await pickDirectoryFallbackAndProcess();
    }
  } else {
    await pickDirectoryFallbackAndProcess();
  }
}

async function processPickedFiles(pickedFiles, rootName) {
  if (!pickedFiles || pickedFiles.length === 0) return;

  // Determine a candidate name to parse meta from: prefer rootName, else try to infer from path
  let candidate = rootName || '';
  if (!candidate) {
    // try to use parent folder from first file's webkitRelativePath
    const p = pickedFiles[0].webkitRelativePath || pickedFiles[0].name;
    const parts = (p && p.indexOf('/') >= 0) ? p.split('/') : [];
    if (parts.length > 1) candidate = parts[0];
  }
  // if still empty, attempt to use directory-like tokens from file name
  if (!candidate) candidate = pickedFiles[0].name;

  const meta = parseMetaFromName(candidate);

  // prepare to fill form fields
  const f = $('#form');
  if (meta.kurul) f.elements.kurul.value = meta.kurul;
  if (meta.plaka) f.elements.plaka.value = normalizePlateValue(meta.plaka);
  if (meta.tarih) {
    // convert to yyyy-mm-dd if possible
    const d = parseDateString(meta.tarih);
    if (d) f.elements.tarih.value = d.toISOString().slice(0,10);
  }
  if (meta.driver) f.elements.driver.value = meta.driver;

  // Only read .txt notes and metadata; DO NOT auto-attach PDFs (HTT/Fatura)
  for (const file of pickedFiles) {
    const name = file.name || '';
    const lname = name.toLowerCase();
    if (lname.endsWith('.txt') && /\bnot\b/i.test(name)) {
      try {
        const txt = await file.text();
        f.elements.not.value = txt;
      } catch (e) { }
    }
  }

  // Ensure PDF lists remain empty so user can add them manually
  files = { htt: [], fatura: [] };
  window.files = files;
  syncFileBoxes();

  toast('Klasörden meta ve notlar dolduruldu. HTT/Fatura dosyalarını manuel ekleyin.');
}

function parseMetaFromName(name) {
  const out = {};
  if (!name) return out;
  const s = name.replace(/[_\[\]()]/g, ' ').replace(/\s+/g, ' ').trim();

  // Kurul: look for 'KURUL' followed by number
  let m = s.match(/(KURUL)\s*[:\-]?\s*(\d+)/i);
  if (m) out.kurul = (m[1] + ' ' + m[2]).toUpperCase();
  else {
    m = s.match(/(KURUL\s*\d+)/i);
    if (m) out.kurul = m[1].toUpperCase();
  }

  // Tarih: dd.mm.yyyy or dd-mm-yyyy
  m = s.match(/(\d{1,2}[\.\-\/]\d{1,2}[\.\-\/]\d{2,4})/);
  if (m) out.tarih = m[1];

  // Plaka: letters then digits pattern (1-3 letters + space? + 2-4 digits)
  m = s.match(/([A-ZÇŞĞÜİÖ]{1,3}\s*\d{2,4})/i);
  if (m) out.plaka = m[1].toUpperCase();

  // Driver: attempt: sequence of words (at least 2) between plaka and tarih, or capitalized words
  if (out.plaka && out.tarih) {
    const idx1 = s.toUpperCase().indexOf(out.plaka.toUpperCase());
    const idx2 = s.indexOf(out.tarih);
    if (idx1 >= 0 && idx2 > idx1) {
      const mid = s.substring(idx1 + out.plaka.length, idx2).replace(/[-_\(\)\[\]]/g, ' ').trim();
      const words = mid.split(/\s+/).filter(Boolean);
      if (words.length >= 2) out.driver = words.map(w => capitalizeWord(w)).join(' ');
    }
  }
  // fallback: find sequences of 2-3 capitalized words
  if (!out.driver) {
    const wordMatches = s.match(/([A-ZÇŞĞÜİÖ][a-zçşığüö]+(?:\s+[A-ZÇŞĞÜİÖ][a-zçşığüö]+){1,2})/g);
    if (wordMatches && wordMatches.length) {
      out.driver = wordMatches[0];
    }
  }

  return out;
}

function capitalizeWord(w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); }

function parseDateString(s) {
  if (!s) return null;
  const m = s.match(/(\d{1,2})[\.\-\/]?(\d{1,2})[\.\-\/]?(\d{2,4})/);
  if (!m) return null;
  let day = parseInt(m[1],10), month = parseInt(m[2],10), year = parseInt(m[3],10);
  if (year < 100) year += 2000;
  try { return new Date(year, month-1, day); } catch(e) { return null; }
}


$$('.file').forEach(box => {
  const key = box.dataset.key, input = $('input[type=file]', box);
  input.addEventListener('change', () => {
    for (const file of input.files) {
      files[key].push({ name: file.name, type: file.type, blob: file });
    }
    input.value = '';
    syncFileBoxes();
  });
});

$('#form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target.elements;
  const btn = $('button[type=submit]', e.target);
  btn.disabled = true;
  btn.textContent = 'Kaydediliyor...';
  setSaveStatus('Kaydetme devam ediyor...', 'busy');

  try {
    const rec = {
      ...(editing || {}),
      kurul: f.kurul.value.trim(),
      plaka: normalizePlateValue(f.plaka.value),
      tarih: f.tarih.value,
      driver: f.driver.value.trim(),
      not: f.not.value.trim(),
      durum: !!(f.durum ? f.durum.checked : false)
    };

    // Dosyaları yükle
    const fileSets = (window.files || files);
    for (const key of ['htt', 'fatura']) {
      let urls = [];
      const list = fileSets[key] || [];
      for (const item of list) {
        if (item.url) urls.push(item.url);
        else if (item.blob) urls.push(await uploadFile(item.blob));
      }
      rec[key] = JSON.stringify(urls);
    }

    await DB.save(rec);
    records = await DB.all();
    render();
    // reset form state after successful save
    editing = null;
    files = { htt: [], fatura: [] };
    window.files = { htt: [], fatura: [] };
    syncFileBoxes();
    $('#form').reset();
    $('#formDlg').close();
    toast('Kaydetme tamamlandı');
    setSaveStatus('Kaydetme tamamlandı', 'success');
    setTimeout(() => setSaveStatus('', 'info'), 1200);
  } catch (err) {
    setSaveStatus('Kaydetme sırasında hata oluştu. Lütfen kontrol edin.', 'error');
    toast(err.message || 'Kaydedilemedi.');
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Kaydet';
  }
});

/* ---------- Görüntüleyici ---------- */
function showFile(jsonStr, title) {
  try {
    const arr = JSON.parse(jsonStr || '[]');
    if (!arr || arr.length === 0) return;
    $('#viewTitle').textContent = `${title} (${arr.length} dosya)`;
    $('#viewBody').innerHTML = arr.map(url => {
      const isPdf = url.toLowerCase().includes('.pdf');
      return `<div style="margin-bottom:15px; border-bottom:1px solid var(--line); padding-bottom:10px;">
        <a href="${url}" target="_blank" class="link" style="display:block;margin-bottom:5px;">Tam ekran aç</a>
        ${isPdf ? `<iframe src="${url}" style="width:100%;height:400px;border:none;"></iframe>` : `<img src="${url}" style="max-width:100%;">`}
      </div>`;
    }).join('');
    $('#viewDlg').showModal();
  } catch(e) {}
}
$('#viewDlg').addEventListener('close', () => { $('#viewBody').innerHTML = ''; });
function showNotePopup(text) {
  const box = $('#noteText');
  box.textContent = text || 'Not eklenmemiş.';
  $('#noteDlg').showModal();
}

/* ---------- Olaylar ---------- */
const docTitle = key => key === 'htt' ? 'HTT' : 'Fatura';
const recOf = tr => records.find(r => rowId(r) === tr.dataset.id);

async function deleteRec(rec) {
  if (!confirm(`${rec.plaka} plakalı kayıt silinsin mi?`)) return;
  try {
    await DB.remove(rec.id);
    records = await DB.all();
    render();
    toast('Kayıt silindi');
  } catch(e) { toast('Silinemedi.'); }
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
  if (act === 'note') showNotePopup(rec.not || 'Not eklenmemiş.');
});

async function ara() {
  applied = readFilters();
  const n = ['plaka', 'driver', 'kurul', 'not', 'from', 'to', 'htt', 'fatura'].filter(k => applied[k]).length;
  $('#advBadge').textContent = n;
  $('#advBadge').hidden = !n;
  records = await DB.all();
  render();
}
function listeleHepsi() {
  $('#q').value = '';
  $$('#adv input, #adv select').forEach(el => el.value = '');
  sorunluFilterActive = false;
  updateSorunluButton();
  return ara();
}
window.toggleSorunluFilter = function () {
  sorunluFilterActive = !sorunluFilterActive;
  updateSorunluButton();
  ara();
};

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
  $('[data-ctx=htt]', ctx).disabled = !ctxRec.htt || ctxRec.htt === '[]';
  $('[data-ctx=fatura]', ctx).disabled = !ctxRec.fatura || ctxRec.fatura === '[]';
  const toggleBtn = $('[data-ctx=toggle-status]', ctx);
  toggleBtn.textContent = normalizeBool(ctxRec.durum) ? 'Normal olarak işaretle' : 'Sorunlu işaretle';
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
$('#list').addEventListener('dblclick', e => {
  const tr = e.target.closest('tr');
  if (!tr || e.target.closest('button')) return;
  e.preventDefault();
  openCtx(tr, e.clientX || innerWidth / 2, e.clientY || innerHeight / 2);
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
  if (a === 'note') showNotePopup(rec.not || 'Not eklenmemiş.');
  if (a === 'htt' || a === 'fatura') showFile(rec[a], docTitle(a));
  if (a === 'edit') openForm(rec);
  if (a === 'del') deleteRec(rec);
  if (a === 'toggle-status') {
    const newStatus = !normalizeBool(rec.durum);
    DB.save({ ...rec, durum: newStatus }).then(async () => {
      records = await DB.all();
      render();
      toast(newStatus ? 'Kayıt sorunlu olarak işaretlendi.' : 'Kayıt normal olarak işaretlendi.');
    }).catch(err => {
      console.error(err);
      toast('Durum güncellenemedi.');
    });
  }
});
document.addEventListener('pointerdown', e => {
  if (!ctx.hidden && !ctx.contains(e.target) && !e.target.closest('dialog')) closeCtx();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCtx(); });
addEventListener('scroll', closeCtx, true);
addEventListener('resize', closeCtx);

$('#addBtn').addEventListener('click', () => openForm());
// attach auto-load handler
$('#autoLoadBtn')?.addEventListener('click', async () => {
  // open form if not already
  if (!editing) openForm();
  await pickDirectoryAndProcess();
});
$$('[data-close]').forEach(b => b.addEventListener('click', () => {
  const d = b.closest('dialog');
  if (d && d.id === 'formDlg') d.removeAttribute('open');
  else if (d) d.close();
}));
$$('dialog').forEach(d => {
  d.addEventListener('click', e => {
    const isFormDialog = d.id === 'formDlg';
    if (!isFormDialog && e.target === d) d.close();
  });
  d.addEventListener('pointerdown', e => e.stopPropagation());
});
$('#form').addEventListener('pointerdown', e => e.stopPropagation());
$('#formDlg').addEventListener('cancel', e => e.preventDefault());
$('#formDlg').addEventListener('close', () => setSaveStatus('', 'info'));

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

$('#logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('evrak-oturum');
  sessionStorage.removeItem('evrak-oturum');
  location.replace('login.html');
});

DB.all().then(rows => { records = rows; render(); }).catch(e => toast('Veriler yüklenemedi.'));

/* ---------- Dışa Aktarma ---------- */
function normalizePdfText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[ıİ]/g, ch => ch === 'ı' ? 'i' : 'I');
}

function exportRowsToExcel() {
  const rows = records.filter(r => matches(r, applied));
  if (!rows.length) {
    toast('Dışa aktarılacak kayıt bulunamadı.');
    return;
  }

  if (!window.XLSX) {
    toast('Excel kütüphanesi yüklenemedi. İnternet bağlantısını kontrol edin.');
    return;
  }

  const sheetData = rows.map(r => ({
    'Kayıt ID': r.id || '',
    Plaka: r.plaka || '',
    Tarih: fmtDate(r.tarih),
    Kurul: r.kurul || '',
    'Sürücü': r.driver || '',
    Not: r.not || '',
    Durum: normalizeBool(r.durum) ? 'Sorunlu' : 'Normal'
  }));

  const ws = XLSX.utils.json_to_sheet(sheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Kayıtlar');
  XLSX.writeFile(wb, 'evrak-kayitlari.xlsx');
  toast('Excel dosyası indirildi.');
}

function exportRowsToPdf() {
  const rows = records.filter(r => matches(r, applied));
  if (!rows.length) {
    toast('Dışa aktarılacak kayıt bulunamadı.');
    return;
  }

  if (!window.jspdf || !window.jspdf.jsPDF) {
    toast('PDF kütüphanesi yüklenemedi. İnternet bağlantısını kontrol edin.');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape' });

  const data = rows.map(r => [
    normalizePdfText(r.plaka || ''),
    normalizePdfText(fmtDate(r.tarih)),
    normalizePdfText(r.kurul || ''),
    normalizePdfText(r.driver || '')
  ]);

  doc.setFontSize(14);
  doc.text(normalizePdfText('Evrak Kontrol - Kayıt Listesi'), 14, 14);

  if (typeof doc.autoTable === 'function') {
    doc.autoTable({
      head: [[normalizePdfText('Plaka'), normalizePdfText('Tarih'), normalizePdfText('Kurul'), normalizePdfText('Sürücü')]],
      body: data,
      startY: 22,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [15, 95, 115] },
      margin: { left: 10, right: 10 }
    });
  } else {
    let y = 26;
    doc.setFontSize(9);
    doc.text(normalizePdfText('Plaka'), 10, y);
    doc.text(normalizePdfText('Tarih'), 55, y);
    doc.text(normalizePdfText('Kurul'), 95, y);
    doc.text(normalizePdfText('Sürücü'), 150, y);
    y += 7;

    rows.forEach(r => {
      if (y > 180) {
        doc.addPage();
        y = 20;
      }
      doc.text(normalizePdfText(r.plaka || ''), 10, y);
      doc.text(normalizePdfText(fmtDate(r.tarih)), 55, y);
      doc.text(normalizePdfText(r.kurul || ''), 95, y);
      doc.text(normalizePdfText(r.driver || ''), 150, y);
      y += 7;
    });
  }

  doc.save('evrak-kayitlari.pdf');
  toast('PDF dosyası indirildi.');
}

$('#exportExcelBtn').addEventListener('click', exportRowsToExcel);
$('#exportPdfBtn').addEventListener('click', exportRowsToPdf);
