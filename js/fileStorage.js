/* fileStorage.js — file & image sharing synced by IP
   - Uploads to Firebase Storage (files/{ip}/...), metadata in Realtime DB (files/{ip}/{id})
   - Fallback if Storage is blocked/unavailable: files up to ~700KB are stored inline in
     Realtime DB (filedata/{ip}/{id}); images are auto-compressed to fit
   - Live gallery with image previews, download, copy link, delete; 7-day expiry */
(function () {
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const INLINE_MAX = 700 * 1024;          // target size when an image has to be compressed
  const COMPRESS_OVER = 2 * 1024 * 1024;   // images bigger than this are shrunk before fallback storage
  const CHUNK = 250000;                    // characters per database chunk
  const FALLBACK_MAX = 15 * 1024 * 1024;   // largest file stored in the database (no Firebase Storage)
  let storageDown = false;                 // set when Storage stalls/fails, so later uploads skip the wait
  let ip = null, listening = false;
  const pending = new Map(); // id -> {name, pct}

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(2) + ' MB';
  // Only trust Firebase Storage download links (blocks javascript:/data: URLs planted in the database)
  function safeUrl(u) {
    try { const x = new URL(u); const sb = window.SUPABASE && window.SUPABASE.url ? new URL(window.SUPABASE.url).hostname : null;
      return x.protocol === 'https:' && (x.hostname === 'firebasestorage.googleapis.com' || (sb && x.hostname === sb)) ? x.href : undefined; } catch (_) { return undefined; }
  }
  const SB = () => (window.SUPABASE && window.SUPABASE.url && window.SUPABASE.anonKey) ? window.SUPABASE : null;
  let sbDown = false;
  function sbUpload(file, path, onPct) {
    const c = SB();
    return new Promise((res, rej) => {
      const x = new XMLHttpRequest();
      x.open('POST', `${c.url}/storage/v1/object/${c.bucket}/${path}`);
      x.setRequestHeader('apikey', c.anonKey); x.setRequestHeader('Authorization', 'Bearer ' + c.anonKey);
      x.setRequestHeader('Content-Type', file.type || 'application/octet-stream'); x.setRequestHeader('x-upsert', 'false');
      x.upload.onprogress = e => e.lengthComputable && onPct(e.loaded / e.total * 100);
      x.onload = () => x.status < 300 ? res(`${c.url}/storage/v1/object/public/${c.bucket}/${path}`) : rej(new Error('Supabase ' + x.status));
      x.onerror = () => rej(new Error('Supabase network error'));
      x.send(file);
    });
  }
  const isImg = t => /^image\//.test(t || '');
  const grid = () => document.getElementById('filesGrid');
  const metaRef = () => window.db.ref('files/' + ip);

  function iconFor(m) {
    const n = (m.name || '').toLowerCase(), t = m.type || '';
    let k = 'file';
    if (t.startsWith('video/')) k = 'film'; else if (t.startsWith('audio/')) k = 'music';
    else if (n.endsWith('.pdf')) k = 'file-text'; else if (/\.(zip|rar|7z|tar|gz)$/.test(n)) k = 'archive';
    else if (/\.(docx?|txt|md|rtf)$/.test(n)) k = 'file-text'; else if (/\.(xlsx?|csv)$/.test(n)) k = 'sheet';
    return window.icon(k);
  }

  function kindFor(m) {
    const n = (m.name || '').toLowerCase(), t = m.type || '';
    if (t.startsWith('image/')) return 'image'; if (t.startsWith('video/')) return 'video'; if (t.startsWith('audio/')) return 'audio';
    if (n.endsWith('.pdf')) return 'pdf'; if (/\.(zip|rar|7z|tar|gz)$/.test(n)) return 'zip';
    if (/\.(xlsx?|csv)$/.test(n)) return 'sheet'; if (/\.(docx?|txt|md|rtf)$/.test(n)) return 'doc'; return 'file';
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let scale = Math.min(1, 1600 / Math.max(img.width, img.height)), q = 0.85, out;
        const c = document.createElement('canvas'), ctx = c.getContext('2d');
        for (let i = 0; i < 8; i++) {
          c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
          out = c.toDataURL('image/jpeg', q);
          if (out.length * 0.75 <= INLINE_MAX) return resolve(out);
          q -= 0.1; scale *= 0.8;
        }
        reject(new Error('Image too large to store without Firebase Storage'));
      };
      img.onerror = () => reject(new Error('Could not read image'));
      img.src = url;
    });
  }
  const readDataURL = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });

  async function uploadFile(file, onProgress) {
    if (!ip) ip = window.userIP || 'guest';
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const safe = file.name.replace(/[^\w.\-]+/g, '_');
    const meta = { name: file.name, size: file.size, type: file.type || '', created: Date.now() };
    pending.set(id, { name: file.name, pct: 0 }); render();
    const progress = p => { pending.get(id).pct = p; onProgress && onProgress(p); render(); };

    try {
      let stored = false, storageErr = null;
      if (SB() && !sbDown) {
        try {
          const tok = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
          const path = `${tok}/${id}_${safe}`;
          meta.url = await sbUpload(file, path, progress); meta.path = path; stored = true;
        } catch (err) { sbDown = true; console.warn('Supabase upload failed, trying Firebase Storage:', err); }
      }
      if (!stored && window.storage && !storageDown) {
        try {
          const ref = window.storage.ref(`files/${ip}/${id}_${safe}`);
          const task = ref.put(file, { contentType: file.type || 'application/octet-stream' });
          // If Storage never starts (locked plan / missing bucket), cancel and use the fallback
          let stall = setTimeout(() => task.cancel(), 10000);
          await new Promise((res, rej) => task.on('state_changed',
            s => { if (s.bytesTransferred > 0) { clearTimeout(stall); stall = null; } progress(s.bytesTransferred / s.totalBytes * 100); },
            e => { clearTimeout(stall); rej(e); }, () => { clearTimeout(stall); res(); }));
          meta.path = ref.fullPath;
          meta.url = await ref.getDownloadURL();
          stored = true;
        } catch (err) { storageErr = err; storageDown = true; console.warn('Firebase Storage unavailable, saving in the database instead:', err); }
      }
      if (!stored) {
        if (file.size > FALLBACK_MAX) throw new Error('This file is over 15MB. Larger files need Firebase Storage' + (storageErr ? ' (' + (storageErr.code || storageErr.message) + ')' : '') + '.');
        let data;
        if (isImg(file.type) && file.type !== 'image/gif' && file.size > COMPRESS_OVER) { data = await compressImage(file); meta.type = 'image/jpeg'; }
        else data = await readDataURL(file);
        const n = Math.ceil(data.length / CHUNK);
        for (let i = 0; i < n; i++) {
          await window.db.ref(`filedata/${ip}/${id}/${i}`).set(data.slice(i * CHUNK, (i + 1) * CHUNK));
          progress((i + 1) / n * 100);
        }
        meta.inline = true; meta.chunks = n; meta.size = Math.round(data.length * 0.75);
      }
      await metaRef().child(id).set(meta);
      return Object.assign({ id }, meta);
    } finally { pending.delete(id); render(); }
  }

  async function remove(id, m) {
    try {
      if (SB() && m.url && m.url.startsWith(SB().url + '/storage/')) { const c = SB(); await fetch(`${c.url}/storage/v1/object/${c.bucket}/${m.path}`, { method: 'DELETE', headers: { apikey: c.anonKey, Authorization: 'Bearer ' + c.anonKey } }); }
      else if (m.path && window.storage) await window.storage.ref(m.path).delete();
    } catch (_) {}
    try { if (m.inline) await window.db.ref(`filedata/${ip}/${id}`).remove(); } catch (_) {}
    await metaRef().child(id).remove();
  }

  // Reads a file stored in the database (a single string, or numbered chunks) and joins it
  async function dataFor(id) {
    const v = (await window.db.ref(`filedata/${ip}/${id}`).once('value')).val();
    if (!v) return null;
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.join('');
    return Object.keys(v).sort((x, y) => x - y).map(k => v[k]).join('');
  }
  function dataUrlToBlob(d) {
    const i = d.indexOf(','), mime = (d.slice(5, i).split(';')[0]) || 'application/octet-stream';
    const bin = atob(d.slice(i + 1)), len = bin.length, arr = new Uint8Array(len);
    for (let k = 0; k < len; k++) arr[k] = bin.charCodeAt(k);
    return new Blob([arr], { type: mime });
  }

  let items = [];
  function render() {
    const g = grid(); if (!g) return;
    g.innerHTML = '';
    pending.forEach(p => {
      const c = document.createElement('div'); c.className = 'file-card uploading';
      c.innerHTML = `<div class="file-icon">${window.icon('loader')}</div><div class="file-name">${esc(p.name)}</div>
        <div class="file-progress" role="progressbar" aria-label="Uploading ${esc(p.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.pct.toFixed(0)}"><span style="width:${p.pct.toFixed(0)}%"></span></div>
        <div class="file-size">${p.pct.toFixed(0)}%</div>`;
      g.appendChild(c);
    });
    if (!items.length && !pending.size) { g.innerHTML = '<div class="files-empty">No files yet — uploads appear here and sync to every device on your network.</div>'; return; }
    items.forEach(m => {
      const c = document.createElement('div'); c.className = 'file-card'; c.dataset.kind = kindFor(m);
      const left = Math.max(0, Math.ceil((m.created + WEEK - Date.now()) / 86400000));
      c.innerHTML = `<div class="file-thumb">${isImg(m.type) ? '' : `<div class="file-icon">${iconFor(m)}</div>`}</div>
        <div class="file-name" title="${esc(m.name)}">${esc(m.name)}</div>
        <div class="file-size">${fmt(m.size || 0)} · ${left}d left</div>
        <div class="file-actions">
          <button class="btn" data-a="dl" aria-label="Save ${esc(m.name)}">${window.icon('download')}Save</button>
          ${m.url ? `<button class="btn" data-a="cp" aria-label="Copy link to ${esc(m.name)}">${window.icon('link')}</button>` : ''}
          <button class="btn" data-a="rm" aria-label="Delete ${esc(m.name)}">${window.icon('trash-2')}</button>
        </div>`;
      const thumb = c.querySelector('.file-thumb');
      if (isImg(m.type)) {
        const img = document.createElement('img'); img.alt = m.name; img.loading = 'lazy'; thumb.appendChild(img);
        if (m.url) img.src = m.url;
        else if ((m.size || 0) <= COMPRESS_OVER) dataFor(m.id).then(d => { if (d && /^data:image\/(png|jpe?g|gif|webp);base64,/.test(d)) img.src = d; });
        else { img.remove(); thumb.innerHTML = `<div class="file-icon">${window.icon('image')}</div>`; }
      }
      c.querySelector('[data-a="dl"]').onclick = async () => {
        if (m.url) { window.open(m.url, '_blank', 'noopener'); return; }
        const d = await dataFor(m.id); if (!d || !/^data:[\w.+\/-]*;base64,/.test(d)) return;
        const url = URL.createObjectURL(dataUrlToBlob(d));
        const a = document.createElement('a'); a.href = url; a.download = m.name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      };
      const cp = c.querySelector('[data-a="cp"]');
      if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(m.url); window.showToast && showToast('Link copied'); } catch (_) {} };
      c.querySelector('[data-a="rm"]').onclick = async () => { if (confirm('Delete "' + m.name + '"?')) { try { await remove(m.id, m); } catch (e) { window.showToast && showToast('Delete failed'); } } };
      g.appendChild(c);
    });
  }

  function init(userIp) {
    ip = userIp || window.userIP || 'guest';
    if (listening || !window.db) return;
    listening = true;
    metaRef().on('value', snap => {
      const now = Date.now(), list = [];
      snap.forEach(ch => {
        if (String(ch.key).startsWith('_diag')) return;
        const m = Object.assign({ id: ch.key }, ch.val()); m.url = safeUrl(m.url);
        if (now - (m.created || 0) > WEEK) remove(m.id, m); else list.push(m);
      });
      items = list.sort((a, b) => b.created - a.created);
      render();
    }, err => { console.error('files listener', err); if (grid()) grid().innerHTML = '<div class="files-empty">Could not load files (check Realtime Database rules for files/)</div>'; });
  }

  window.fileStorage = { init, uploadFile, renderFilesGrid: render, cleanupExpired: async () => {} };
})();
