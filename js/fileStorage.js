/* fileStorage.js — file & image sharing synced by IP
   - Uploads to Firebase Storage (files/{ip}/...), metadata in Realtime DB (files/{ip}/{id})
   - Fallback if Storage is blocked/unavailable: files up to ~700KB are stored inline in
     Realtime DB (filedata/{ip}/{id}); images are auto-compressed to fit
   - Live gallery with image previews, download, copy link, delete; 7-day expiry */
(function () {
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const INLINE_MAX = 700 * 1024;
  let ip = null, listening = false;
  const pending = new Map(); // id -> {name, pct}

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(2) + ' MB';
  // Only trust Firebase Storage download links (blocks javascript:/data: URLs planted in the database)
  function safeUrl(u) {
    try { const x = new URL(u); return x.protocol === 'https:' && x.hostname === 'firebasestorage.googleapis.com' ? x.href : undefined; } catch (_) { return undefined; }
  }
  const isImg = t => /^image\//.test(t || '');
  const grid = () => document.getElementById('filesGrid');
  const metaRef = () => window.db.ref('files/' + ip);

  function iconFor(m) {
    const n = (m.name || '').toLowerCase(), t = m.type || '';
    if (t.startsWith('video/')) return '🎬';
    if (t.startsWith('audio/')) return '🎵';
    if (n.endsWith('.pdf')) return '📄';
    if (/\.(zip|rar|7z|tar|gz)$/.test(n)) return '🗜️';
    if (/\.(docx?|txt|md|rtf)$/.test(n)) return '📝';
    if (/\.(xlsx?|csv)$/.test(n)) return '📊';
    return '📦';
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
      if (window.storage) {
        try {
          const ref = window.storage.ref(`files/${ip}/${id}_${safe}`);
          const task = ref.put(file, { contentType: file.type || 'application/octet-stream' });
          // If Storage never starts (locked plan / missing bucket), cancel and use the fallback
          let stall = setTimeout(() => task.cancel(), 12000);
          await new Promise((res, rej) => task.on('state_changed',
            s => { if (s.bytesTransferred > 0) { clearTimeout(stall); stall = null; } progress(s.bytesTransferred / s.totalBytes * 100); },
            e => { clearTimeout(stall); rej(e); }, () => { clearTimeout(stall); res(); }));
          meta.path = ref.fullPath;
          meta.url = await ref.getDownloadURL();
          stored = true;
        } catch (err) { storageErr = err; console.warn('Storage upload failed, trying inline fallback:', err); }
      }
      if (!stored) {
        let data;
        if (isImg(file.type) && file.type !== 'image/gif') { data = await compressImage(file); meta.type = 'image/jpeg'; }
        else if (file.size <= INLINE_MAX) data = await readDataURL(file);
        else throw new Error('Upload failed' + (storageErr ? ' (' + (storageErr.code || storageErr.message) + ')' : '') +
          ' — files over 700KB need Firebase Storage rules/plan set up');
        meta.inline = true; meta.size = Math.round(data.length * 0.75);
        await window.db.ref(`filedata/${ip}/${id}`).set(data);
      }
      await metaRef().child(id).set(meta);
      return Object.assign({ id }, meta);
    } finally { pending.delete(id); render(); }
  }

  async function remove(id, m) {
    try { if (m.path && window.storage) await window.storage.ref(m.path).delete(); } catch (_) {}
    try { if (m.inline) await window.db.ref(`filedata/${ip}/${id}`).remove(); } catch (_) {}
    await metaRef().child(id).remove();
  }

  async function dataFor(id) { return (await window.db.ref(`filedata/${ip}/${id}`).once('value')).val(); }

  let items = [];
  function render() {
    const g = grid(); if (!g) return;
    g.innerHTML = '';
    pending.forEach(p => {
      const c = document.createElement('div'); c.className = 'file-card uploading';
      c.innerHTML = `<div class="file-icon">⏳</div><div class="file-name">${esc(p.name)}</div>
        <div class="file-progress"><span style="width:${p.pct.toFixed(0)}%"></span></div>
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
          <button class="btn" data-a="dl">⬇ Save</button>
          ${m.url ? '<button class="btn" data-a="cp">🔗</button>' : ''}
          <button class="btn" data-a="rm">🗑️</button>
        </div>`;
      const thumb = c.querySelector('.file-thumb');
      if (isImg(m.type)) {
        const img = document.createElement('img'); img.alt = m.name; img.loading = 'lazy'; thumb.appendChild(img);
        if (m.url) img.src = m.url; else dataFor(m.id).then(d => { if (d && /^data:image\/(png|jpe?g|gif|webp);base64,/.test(d)) img.src = d; });
      }
      c.querySelector('[data-a="dl"]').onclick = async () => {
        if (m.url) { window.open(m.url, '_blank', 'noopener'); return; }
        const d = await dataFor(m.id); if (!d || !/^data:[\w.+\/-]*;base64,/.test(d)) return;
        const a = document.createElement('a'); a.href = d; a.download = m.name; a.click();
      };
      const cp = c.querySelector('[data-a="cp"]');
      if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(m.url); window.showToast && showToast('✓ Link copied'); } catch (_) {} };
      c.querySelector('[data-a="rm"]').onclick = async () => { if (confirm('Delete "' + m.name + '"?')) { try { await remove(m.id, m); } catch (e) { window.showToast && showToast('❌ Delete failed'); } } };
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
        const m = Object.assign({ id: ch.key }, ch.val()); m.url = safeUrl(m.url);
        if (now - (m.created || 0) > WEEK) remove(m.id, m); else list.push(m);
      });
      items = list.sort((a, b) => b.created - a.created);
      render();
    }, err => { console.error('files listener', err); if (grid()) grid().innerHTML = '<div class="files-empty">Could not load files (check Realtime Database rules for files/)</div>'; });
  }

  window.fileStorage = { init, uploadFile, renderFilesGrid: render, cleanupExpired: async () => {} };
})();
