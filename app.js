const TABLE_NAME = 'Tespit';

const $ = (s, r = document) => r.querySelector(s);
const toLocalISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => /^https:\/\/[^\s"'<>`]+$/i.test(String(u ?? '')) ? String(u) : '';
const toLogin = () => location.replace('login.html');
async function apiError(res) {
  let msg = '';
  try { msg = (await res.json()).error || ''; } catch (e) { }
  return new Error(msg || `İstek başarısız (${res.status})`);
}

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
    const res = await fetch('/api/db', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, method, body })
    });
    if (res.status === 401) { toLogin(); throw new Error('Oturum süresi doldu.'); }
    if (!res.ok) throw await apiError(res);
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  },
  async all() {
    const rows = await this.req(`/rest/v1/${TABLE_NAME}?select=*`);
    return rows.map(r => ({ ...r, id: r.id ?? recKey(r), durum: normalizeBool(r.durum), member: normalizeBool(r.member) }));
  },
  async save(rec) {
    const isUpdate = !!rec.id && !isSyntheticId(rec.id);
    const isSyntheticRow = isSyntheticId(rec.id);
    const filter = `kurul=eq.${encodeURIComponent(rec.kurul)}&tarih=eq.${encodeURIComponent(rec.tarih)}&plaka=eq.${encodeURIComponent(rec.plaka)}`;
    const payload = { ...stripSyntheticId(rec), durum: normalizeBool(rec.durum ?? false) };

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
      const [oK, oT, oP] = String(id).split('::');
      const oldFilter = `kurul=eq.${encodeURIComponent(oK)}&tarih=eq.${encodeURIComponent(oT)}&plaka=eq.${encodeURIComponent(oP)}`;
      return this.req(`/rest/v1/${TABLE_NAME}?${oldFilter}`, 'PATCH', { ...stripSyntheticId(data), durum: normalizeBool(data.durum ?? false) });
    }

    return this.req(`/rest/v1/${TABLE_NAME}`, 'POST', payload);
  },
  async remove(id) {
    if (isSyntheticId(id)) {
      const [k, t, p] = String(id).split('::');
      return this.req(`/rest/v1/${TABLE_NAME}?kurul=eq.${encodeURIComponent(k)}&tarih=eq.${encodeURIComponent(t)}&plaka=eq.${encodeURIComponent(p)}`, 'DELETE');
    }
    return this.req(`/rest/v1/${TABLE_NAME}?id=eq.${encodeURIComponent(id)}`, 'DELETE');
  }
};

let records = [];
let editing = null;
let files = { htt: [], fatura: [] };

let applied = {};
let sorunluFilterActive = false;
let memberFilterActive = false;
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
  updateMemberButton();
}

function updateMemberButton() {
  const btn = $('#memberBtn');
  if (!btn) return;
  const n = records.filter(r => normalizeBool(r.member)).length;
  btn.textContent = `Dernek Üyesi${memberFilterActive ? ` (${n})` : ''}`;
  btn.setAttribute('aria-pressed', String(memberFilterActive));
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
  if (memberFilterActive && !normalizeBool(r.member)) return false;
  return true;
}
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

function render() {
  const rows = records.filter(r => matches(r, applied));
  $('#count').textContent = `${rows.length} kayıt`;
  $('#list').innerHTML = rows.map(r => {
    const status = normalizeBool(r.durum);
    return `
    <tr data-id="${esc(rowId(r))}" data-status="${status}">
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
  const fieldNames = ['kurul', 'plaka', 'tarih', 'driver', 'not'];
  fieldNames.forEach(k => {
    const el = $(`#form [name="${k}"]`);
    if (el) el.value = rec?.[k] ?? '';
  });
  if (!rec) f.elements.tarih.value = toLocalISO(new Date());
  if (f.elements.plaka) {
    f.elements.plaka.addEventListener('input', e => {
      e.target.value = normalizePlateValue(e.target.value);
    }, { once: true });
  }
  if (f.elements.durum) f.elements.durum.checked = normalizeBool(rec?.durum ?? false);
  if (f.elements.member) f.elements.member.checked = normalizeBool(rec?.member ?? false);
  
  files = { htt: [], fatura: [] };
  if (rec) {
    try { files.htt = rec.htt ? JSON.parse(rec.htt).map(u => ({ url: u, name: u.split('/').pop() })) : []; } catch(e){}
    try { files.fatura = rec.fatura ? JSON.parse(rec.fatura).map(u => ({ url: u, name: u.split('/').pop() })) : []; } catch(e){}
  }
  try { delete window.files; } catch(e) { window.files = undefined; }
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
          ${safeUrl(f.url) ? `<a href="${esc(safeUrl(f.url))}" target="_blank" rel="noopener noreferrer" class="link small">Aç</a>` : ''}
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

const baseNoExt = n => (String(n || '').split(/[\\/]/).pop() || '').replace(/\.[^.]+$/, '');
const isNoteName = n => /not/i.test(baseNoExt(n));

async function readTextSmart(file) {
  let buf;
  try {
    buf = await file.arrayBuffer();
  } catch (e1) {
    try {
      buf = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsArrayBuffer(file);
      });
    } catch (e2) {
      const url = URL.createObjectURL(file);
      try { buf = await (await fetch(url)).arrayBuffer(); }
      finally { URL.revokeObjectURL(url); }
    }
  }
  let t = new TextDecoder('utf-8').decode(buf);
  if (t.includes('\uFFFD')) {
    try { t = new TextDecoder('windows-1254').decode(buf); } catch (e) {}
  }
  return t.replace(/\uFEFF/g, '').trim();
}

async function readBestNote(list) {
  const cands = (list || []).filter(f => /\.txt$/i.test(f.name || '') || (!/\./.test(f.name || '') && isNoteName(f.name)));
  cands.sort((a, b) => (isNoteName(b.name) - isNoteName(a.name)) || ((b.size || 0) - (a.size || 0)));
  for (const f of cands) {
    try {
      const t = await readTextSmart(f);
      if (t) return t;
    } catch (e) { console.warn('Not okunamadı:', f.name, e); }
  }
  return '';
}

async function pickDirectoryFallbackAndProcess() {
  const input = $('#dirPickerFallback');
  return new Promise(res => {
    const handler = async () => {
      try {
        const files = [...input.files];
        console.log('Fallback picker selected files:', files.map(f=>f.name));
        toast(`${files.length} dosya seçildi (klasör fallback).`);
        
        let preReadNoteContent = null;
        
        const txtFiles = files.filter(f => {
          const lname = (f.name || '').toLowerCase();
          return lname.endsWith('.txt');
        });
        
        txtFiles.sort((a, b) => {
          const aHasNot = /\bnot\b/i.test((a.name.split(/[\\/]/).pop() || '').replace(/\.[^.]+$/, ''));
          const bHasNot = /\bnot\b/i.test((b.name.split(/[\\/]/).pop() || '').replace(/\.[^.]+$/, ''));
          if (aHasNot && !bHasNot) return -1;
          if (!aHasNot && bHasNot) return 1;
          return (b.size || 0) - (a.size || 0);
        });
        
        for (const txtFile of txtFiles) {
          try {
            console.log('Attempting to read txt file:', txtFile.name);
            preReadNoteContent = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const content = String(reader.result || '');
                console.log('Successfully read', txtFile.name, '(len):', content.length);
                resolve(content);
              };
              reader.onerror = () => {
                console.warn('FileReader error for', txtFile.name, ':', reader.error);
                reject(reader.error);
              };
              reader.readAsText(txtFile);
            });
            break;
          } catch (e) {
            console.warn('Failed to read', txtFile.name, ':', e);
            continue;
          }
        }
        
        if (preReadNoteContent) {
          console.log('Pre-read note content successful (len):', preReadNoteContent.length);
        } else {
          console.warn('No txt files could be read from fallback input');
        }
        
        preReadNoteContent = (await readBestNote(files)) || preReadNoteContent;
        await processPickedFiles(files, null, preReadNoteContent);
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
  if (window.showDirectoryPicker) {
    try {
      const dir = await window.showDirectoryPicker();
      toast(`Klasör seçildi: ${dir.name}`);
      const files = [];
      let failedReads = 0;
      async function recurse(d, prefix = '') {
        for await (const [name, handle] of d.entries()) {
          try {
            if (handle.kind === 'file') {
              try {
                const f = await handle.getFile();
                Object.defineProperty(f, 'webkitRelativePath', { value: prefix ? (prefix + '/' + name) : name, configurable: true });
                files.push(f);
              } catch (fe) {
                console.warn('file read failed', name, fe);
                failedReads++;
                continue;
              }
            } else if (handle.kind === 'directory') {
              await recurse(handle, prefix ? (prefix + '/' + name) : name);
            }
          } catch (entErr) {
            console.warn('entry iteration failed', name, entErr);
            failedReads++;
            continue;
          }
        }
      }
      await recurse(dir);
      console.log('Picked files from showDirectoryPicker:', files.map(f=>f.name));
      toast(`${files.length} dosya bulundu. (${failedReads} okunamadı)`);
      if (failedReads > 0) {
        console.warn('Some showDirectoryPicker reads failed; invoking fallback input');
        toast('Bazı dosyalar okunamadı; alternatif seçim penceresi açılıyor...');
        await pickDirectoryFallbackAndProcess();
        return;
      }
      await processPickedFiles(files, dir.name, await readBestNote(files));
    } catch (e) {
      console.error(e);
      await pickDirectoryFallbackAndProcess();
    }
  } else {
    await pickDirectoryFallbackAndProcess();
  }
}

async function processPickedFiles(pickedFiles, rootName, preReadNoteContent) {
  if (!pickedFiles || pickedFiles.length === 0) return;
  console.log('processPickedFiles called, rootName=', rootName, 'files=', pickedFiles.map(f=>f.name));

  if (!editing) {
    try { openForm(); } catch(e) { console.warn('Could not open form before processing files', e); }
  }

  let candidate = rootName || '';
  if (!candidate) {
    const p = pickedFiles[0].webkitRelativePath || pickedFiles[0].name;
    const parts = (p && p.indexOf('/') >= 0) ? p.split('/') : [];
    if (parts.length > 1) candidate = parts[0];
  }
  if (!candidate) candidate = pickedFiles[0].name;

  const meta = parseMetaFromName(candidate);
  console.log('Parsed meta from candidate:', candidate, meta);

  const f = $('#form');
  const setField = (name, value) => {
    const el = $(`#form [name="${name}"]`);
    if (!el) return false;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      el.value = value || '';
      return true;
    }
    return false;
  };

  if (meta.kurul) setField('kurul', meta.kurul);
  if (meta.plaka) setField('plaka', normalizePlateValue(meta.plaka));
  if (meta.tarih) {
    const d = parseDateString(meta.tarih);
    if (d) setField('tarih', toLocalISO(d));
  }
  if (meta.driver) setField('driver', meta.driver);

  if (!meta.plaka) {
    for (const file of pickedFiles) {
      const m = (file.name || '').match(/([A-ZÇŞĞÜİÖ]{1,3}\s*\d{2,4})/i);
      if (m) { f.elements.plaka.value = normalizePlateValue(m[1]); break; }
    }
  }

  let txtCandidates = [];
  for (const file of pickedFiles) {
    const name = file.name || '';
    const lname = name.toLowerCase();
    console.log('Checking file for note candidate:', name);
    if (!lname.endsWith('.txt')) continue;
    const baseName = (name.split(/[\\/]/).pop() || '').toLowerCase();
    const baseNoExt = baseName.replace(/\.[^.]+$/, '');
    if (baseNoExt === 'not' || /\bnot\b/i.test(baseNoExt)) {
      txtCandidates.push({ file, score: 100 });
      console.log('Marked as strong note candidate:', name);
      continue;
    }
    txtCandidates.push({ file, score: 1 });
  }

  let chosen = null;
  if (txtCandidates.length) {
    const strong = txtCandidates.filter(c => c.score === 100);
    if (strong.length) chosen = strong[0].file;
    else {
      txtCandidates.sort((a, b) => {
        const sa = (a.file.size || 0);
        const sb = (b.file.size || 0);
        if (sb !== sa) return sb - sa;
        return b.file.name.length - a.file.name.length;
      });
      chosen = txtCandidates[0].file;
    }
  }

  let noteAssigned = false;
  {
    let txt = preReadNoteContent || await readBestNote(pickedFiles) || '';

    if (!txt && chosen) {
      try {
        txt = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error);
          reader.readAsText(chosen);
        });
      } catch (e) {
        console.warn('Not dosyası okunamadı:', e);
      }
    }

    if (txt) {
      txt = txt.replace(/\uFEFF/g, '').trim();
      const ta = document.querySelector('#form textarea[name="not"]');
      if (ta) {
        ta.value = txt;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        noteAssigned = true;
      }
    }
  }

  files = { htt: [], fatura: [] };
  window.files = files;
  syncFileBoxes();
  toast(noteAssigned
    ? 'Klasörden meta ve not dolduruldu. HTT/Fatura dosyalarını manuel ekleyin.'
    : 'Meta dolduruldu ama not okunamadı. "Not dosyası seç" düğmesiyle NOT.txt dosyasını tek başına seçin.');
  const nb = document.getElementById('noteBtn');
  if (nb && !noteAssigned) nb.classList.add('primary');
}

function parseMetaFromName(name) {
  const out = {};
  if (!name) return out;
  let s = name.replace(/[_\[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
  const S = s;

  let m = s.match(/\b(KURUL)\s*[:\-]?\s*(\d+)\b/i);
  if (m) {
    out.kurul = (m[1] + ' ' + m[2]).toUpperCase();
    s = s.replace(m[0], ' ');
  } else {
    m = s.match(/\b(KURUL\s*\d+)\b/i);
    if (m) {
      out.kurul = m[1].toUpperCase();
      s = s.replace(m[0], ' ');
    }
  }

  m = s.match(/(\d{1,2}[\.\-\/]\d{1,2}[\.\-\/]\d{2,4})/);
  if (m) {
    out.tarih = m[1];
    s = s.replace(m[0], ' ');
  }

  m = s.match(/\b([A-ZÇŞĞÜİÖ]{1,3})\s*(\d{2,4})\b/i);
  if (m) {
    out.plaka = (m[1] + ' ' + m[2]).toUpperCase();
    s = s.replace(m[0], ' ');
  }

  if (!out.driver) {
    s = s.replace(/\b(faturali|fatural[iı]|fatura|faturalar|fatural[ıi]|faturali|invoice)\b/ig, ' ');
    s = s.replace(/\b(üst\s*yaz[iı](?:\s*yaz[iı]l[ıi]?)?)\b/ig, ' ');
    s = s.replace(/\b(hemencecik|eklenmiştir|eklenmis)\b/ig, ' ');
    const tokens = s.split(/[^A-Za-zÇŞĞÜİÖçşğıüö]+/).filter(Boolean);
    let bestSeq = [];
    let seq = [];
    for (const t of tokens) {
      if (/^\d+$/.test(t) || t.length === 1) {
        if (seq.length >= 2 && seq.length > bestSeq.length) bestSeq = seq.slice();
        seq = [];
        continue;
      }
      seq.push(t);
    }
    if (seq.length >= 2 && seq.length > bestSeq.length) bestSeq = seq.slice();
    if (bestSeq.length >= 2) {
      const cleaned = bestSeq.filter(w => !/^\d+$/.test(w) && w.length > 1 && !/^(faturali|fatura|üst|yazı|yazildi|yazıldı)$/i.test(w));
      out.driver = cleaned.map(w => capitalizeWord(w)).join(' ');
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
      durum: !!(f.durum ? f.durum.checked : false),
      member: !!(f.member ? f.member.checked : false)
    };

    for (const key of ['htt', 'fatura']) {
      let urls = [];
      for (const item of files[key]) {
        if (item.url) urls.push(item.url);
        else if (item.blob) urls.push(await uploadFile(item.blob));
      }
      rec[key] = JSON.stringify(urls);
    }

    await DB.save(rec);
    records = await DB.all();
    render();
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

function showFile(jsonStr, title) {
  try {
    const arr = JSON.parse(jsonStr || '[]');
    if (!arr || arr.length === 0) return;
    $('#viewTitle').textContent = `${title} (${arr.length} dosya)`;
    $('#viewBody').innerHTML = arr.map(safeUrl).filter(Boolean).map(raw => {
      const url = esc(raw);
      const isPdf = raw.toLowerCase().includes('.pdf');
      return `<div style="margin-bottom:15px; border-bottom:1px solid var(--line); padding-bottom:10px;">
        <a href="${url}" target="_blank" rel="noopener noreferrer" class="link" style="display:block;margin-bottom:5px;">Tam ekran aç</a>
        ${isPdf ? `<iframe src="${url}" style="width:100%;height:400px;border:none;"></iframe>` : `<img src="${url}" alt="" style="max-width:100%;">`}
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
  memberFilterActive = false;
  updateSorunluButton();
  return ara();
}
window.toggleMemberFilter = function () {
  memberFilterActive = !memberFilterActive;
  updateSorunluButton();
  ara();
};
window.toggleSorunluFilter = function () {
  sorunluFilterActive = !sorunluFilterActive;
  updateSorunluButton();
  ara();
};

$('#sorunluBtn').addEventListener('click', window.toggleSorunluFilter);
$('#memberBtn').addEventListener('click', window.toggleMemberFilter);
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
$('#autoLoadBtn')?.addEventListener('click', async () => {
  if (!editing) openForm();
  await pickDirectoryAndProcess();
});
$('#noteBtn')?.addEventListener('click', () => $('#notePicker').click());
$('#notePicker')?.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const txt = await readTextSmart(file);
    const ta = document.querySelector('#form textarea[name="not"]');
    if (ta) { ta.value = txt; ta.dispatchEvent(new Event('input', { bubbles: true })); }
    toast(txt ? 'Not eklendi.' : 'Dosya boş.');
  } catch (err) {
    console.error(err);
    toast('Dosya okunamadı: ' + (err.message || err));
  }
  e.target.value = '';
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

$('#logoutBtn').addEventListener('click', async () => {
  try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) { }
  toLogin();
});

DB.all().then(rows => { records = rows; render(); }).catch(e => {
  toast('Veriler yüklenemedi: ' + String(e.message || e).slice(0, 150));
});

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

async function uploadFile(file) {
  const comp = await compressImage(file);
  const res = await fetch('/api/upload', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': comp.type || 'application/octet-stream' },
    body: comp
  });
  if (res.status === 401) { toLogin(); throw new Error('Oturum süresi doldu.'); }
  if (!res.ok) throw await apiError(res);
  return (await res.json()).url;
}

async function compressImage(file, maxDim = 1200) {
  if (file.type === 'application/pdf') return file;
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
