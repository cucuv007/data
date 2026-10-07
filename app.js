const TABLE_NAME = 'Tespit';

// Secret key istemcide yok; işlemler /api/db ve /api/upload üzerinden yapılır.
const configReady = Promise.resolve();

const $ = (s, r = document) => r.querySelector(s);
const toLocalISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
    // Use server-side proxy to avoid exposing the Supabase secret key in the client
    const res = await fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, method, body })
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(txt || `Proxy request failed: ${res.status}`);
    }
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
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
      const [oK, oT, oP] = String(id).split('::');
      const oldFilter = `kurul=eq.${encodeURIComponent(oK)}&tarih=eq.${encodeURIComponent(oT)}&plaka=eq.${encodeURIComponent(oP)}`;
      return this.req(`/rest/v1/${TABLE_NAME}?${oldFilter}`, 'PATCH', { ...stripSyntheticId(data), durum: normalizeBool(data.durum ?? false) });
    }

    return this.req(`/rest/v1/${TABLE_NAME}`, 'POST', payload);
  },
  async remove(id) {
    return this.req(`/rest/v1/${TABLE_NAME}?id=eq.${encodeURIComponent(id)}`, 'DELETE');
  }
};

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
  // Populate form fields explicitly by name to avoid any collection-indexing issues
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
  
  files = { htt: [], fatura: [] };
  if (rec) {
    try { files.htt = rec.htt ? JSON.parse(rec.htt).map(u => ({ url: u, name: u.split('/').pop() })) : []; } catch(e){}
    try { files.fatura = rec.fatura ? JSON.parse(rec.fatura).map(u => ({ url: u, name: u.split('/').pop() })) : []; } catch(e){}
  }
  // Clear any leftover window.files from prior auto-loads so we don't accidentally
  // override the files loaded from the record when saving.
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
const baseNoExt = n => (String(n || '').split(/[\\/]/).pop() || '').replace(/\.[^.]+$/, '');
const isNoteName = n => /not/i.test(baseNoExt(n)); // not, NOT, Not, notlar, not_1 ...

async function readTextSmart(file) {
  const buf = await file.arrayBuffer();
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
  // Fallback using webkitdirectory input
  const input = $('#dirPickerFallback');
  return new Promise(res => {
    const handler = async () => {
      try {
        const files = [...input.files];
        console.log('Fallback picker selected files:', files.map(f=>f.name));
        toast(`${files.length} dosya seçildi (klasör fallback).`);
        
        // Pre-read note content while input.files is still accessible
        let preReadNoteContent = null;
        
        // Collect all .txt files, prioritize ones with 'not' in name
        const txtFiles = files.filter(f => {
          const lname = (f.name || '').toLowerCase();
          return lname.endsWith('.txt');
        });
        
        // Sort: first those with 'not' in base name, then by size (largest first)
        txtFiles.sort((a, b) => {
          const aHasNot = /\bnot\b/i.test((a.name.split(/[\\/]/).pop() || '').replace(/\.[^.]+$/, ''));
          const bHasNot = /\bnot\b/i.test((b.name.split(/[\\/]/).pop() || '').replace(/\.[^.]+$/, ''));
          if (aHasNot && !bHasNot) return -1;
          if (!aHasNot && bHasNot) return 1;
          return (b.size || 0) - (a.size || 0);
        });
        
        // Try to read each .txt file until one succeeds
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
            break; // Success, stop trying
          } catch (e) {
            console.warn('Failed to read', txtFile.name, ':', e);
            continue; // Try next file
          }
        }
        
        if (preReadNoteContent) {
          console.log('Pre-read note content successful (len):', preReadNoteContent.length);
        } else {
          console.warn('No txt files could be read from fallback input');
        }
        
        // Pass files and pre-read note content
        preReadNoteContent = (await readBestNote(files)) || preReadNoteContent;
        await processPickedFiles(files, /*rootName*/ null, preReadNoteContent);
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
      toast(`Klasör seçildi: ${dir.name}`);
      const files = [];
      let failedReads = 0;
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
      // If any reads failed it's often an environment/browser permission issue.
      // In that case proactively open the fallback input so the user doesn't need
      // to re-select the folder manually.
      if (failedReads > 0) {
        console.warn('Some showDirectoryPicker reads failed; invoking fallback input');
        toast('Bazı dosyalar okunamadı; alternatif seçim penceresi açılıyor...');
        await pickDirectoryFallbackAndProcess();
        return;
      }
      await processPickedFiles(files, dir.name, await readBestNote(files));
    } catch (e) {
      console.error(e);
      // fallback
      await pickDirectoryFallbackAndProcess();
    }
  } else {
    await pickDirectoryFallbackAndProcess();
  }
}

async function processPickedFiles(pickedFiles, rootName, preReadNoteContent) {
  if (!pickedFiles || pickedFiles.length === 0) return;
  console.log('processPickedFiles called, rootName=', rootName, 'files=', pickedFiles.map(f=>f.name));

  // Ensure the form is open
  if (!editing) {
    try { openForm(); } catch(e) { console.warn('Could not open form before processing files', e); }
  }

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
  console.log('Parsed meta from candidate:', candidate, meta);

  // prepare to fill form fields
  const f = $('#form');
  // Use explicit selectors to set fields to avoid collection/index issues
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

  // If nothing was parsed, try to infer a plate from filenames as fallback
  if (!meta.plaka) {
    for (const file of pickedFiles) {
      const m = (file.name || '').match(/([A-ZÇŞĞÜİÖ]{1,3}\s*\d{2,4})/i);
      if (m) { f.elements.plaka.value = normalizePlateValue(m[1]); break; }
    }
  }

  // Only read .txt notes and metadata; DO NOT auto-attach PDFs (HTT/Fatura)
  // Strategy:
  // 1) Prefer files whose base filename equals 'not' (case-insensitive) or contains the standalone token 'not'.
  // 2) If none found, pick the longest .txt file as a fallback.
  let txtCandidates = [];
  for (const file of pickedFiles) {
    const name = file.name || '';
    const lname = name.toLowerCase();
    console.log('Checking file for note candidate:', name);
    if (!lname.endsWith('.txt')) continue;
    // derive base filename (without path and extension)
    const baseName = (name.split(/[\\/]/).pop() || '').toLowerCase();
    const baseNoExt = baseName.replace(/\.[^.]+$/, '');
    // If base is exactly 'not' or contains token ' not ' etc., prefer it
    if (baseNoExt === 'not' || /\bnot\b/i.test(baseNoExt)) {
      txtCandidates.push({ file, score: 100 });
      console.log('Marked as strong note candidate:', name);
      continue;
    }
    // otherwise, collect as weaker candidate (length-based later)
    txtCandidates.push({ file, score: 1 });
  }

  // If we have any strong candidates (score 100), pick the first one; else pick the longest .txt
  let chosen = null;
  if (txtCandidates.length) {
    const strong = txtCandidates.filter(c => c.score === 100);
    if (strong.length) chosen = strong[0].file;
    else {
      // choose by largest file size (if available) or by name length
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

  // Ensure PDF lists remain empty so user can add them manually
  files = { htt: [], fatura: [] };
  window.files = files;
  syncFileBoxes();
  toast(noteAssigned
    ? 'Klasörden meta ve not dolduruldu. HTT/Fatura dosyalarını manuel ekleyin.'
    : 'Meta dolduruldu ancak not okunamadı (not .txt bulunamadı ya da tarayıcı dosyayı okuyamadı).');
}

function parseMetaFromName(name) {
  const out = {};
  if (!name) return out;
  // Normalize spacing and keep original for later capitalization
  let s = name.replace(/[_\[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
  const S = s; // original cleaned

  // 1) Extract KURUL token and remove it from the working string
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

  // 2) Extract date (dd.mm.yyyy etc.) and remove it
  m = s.match(/(\d{1,2}[\.\-\/]\d{1,2}[\.\-\/]\d{2,4})/);
  if (m) {
    out.tarih = m[1];
    s = s.replace(m[0], ' ');
  }

  // 3) Extract plate: look for 1-3 letters and 2-4 digits (ensure we don't match leftover 'KURUL')
  m = s.match(/\b([A-ZÇŞĞÜİÖ]{1,3})\s*(\d{2,4})\b/i);
  if (m) {
    out.plaka = (m[1] + ' ' + m[2]).toUpperCase();
    s = s.replace(m[0], ' ');
  }

  // 4) Extract driver: after removing kurul, date, plate, find sequence of words (letters only) of length >=2
  if (!out.driver) {
    // Remove common noisy suffixes that often land in the driver field
    s = s.replace(/\b(faturali|fatural[iı]|fatura|faturalar|fatural[ıi]|faturali|invoice)\b/ig, ' ');
    s = s.replace(/\b(üst\s*yaz[iı](?:\s*yaz[iı]l[ıi]?)?)\b/ig, ' ');
    s = s.replace(/\b(hemencecik|eklenmiştir|eklenmis)\b/ig, ' ');
    // split remaining text into tokens and find runs of alphabetic words
    const tokens = s.split(/[^A-Za-zÇŞĞÜİÖçşğıüö]+/).filter(Boolean);
    // find contiguous sequences of tokens with length >=2
    let bestSeq = [];
    let seq = [];
    for (const t of tokens) {
      // skip tokens that look like numbers or short abbreviations of length 1
      if (/^\d+$/.test(t) || t.length === 1) {
        if (seq.length >= 2 && seq.length > bestSeq.length) bestSeq = seq.slice();
        seq = [];
        continue;
      }
      seq.push(t);
    }
    if (seq.length >= 2 && seq.length > bestSeq.length) bestSeq = seq.slice();
    if (bestSeq.length >= 2) {
      // Title-case the driver name
      // filter out any remaining noise words and short tokens, then title-case
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
      durum: !!(f.durum ? f.durum.checked : false)
    };

    // Dosyaları yükle
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

// Wait for config to load before fetching data
configReady.then(() => {
  DB.all().then(rows => { records = rows; render(); }).catch(e => {
    console.error('Veri yüklenemedi:', e);
    toast('Veriler yüklenemedi: ' + String(e.message || e).slice(0, 150));
  });
});

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

/* ---------- Dosya Yükleme ---------- */
async function uploadFile(file) {
  const comp = await compressImage(file);
  const ext = (comp.name.split('.').pop() || 'jpg').toLowerCase();
  const fileName = Date.now() + '_' + Math.random().toString(36).substr(2, 5) + '.' + ext;
  
  const res = await fetch(`/api/upload?name=${encodeURIComponent(fileName)}`, {
    method: 'POST',
    headers: { 'Content-Type': comp.type || 'application/octet-stream' },
    body: comp
  });
  if (!res.ok) {
    throw new Error(`Upload error: ${res.status} ${await res.text()}`);
  }
  return (await res.json()).url;
}

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
