/*
  Placeholder fileStorage.js
  - Lightweight IndexedDB metadata store
  - Firebase Storage upload glue (uses global `storage` if present)
  - 7-day expiry cleanup
*/
(function () {
  const DB_NAME = 'quickshare-files';
  const STORE = 'files';

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveMeta(meta) {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(meta);
    return tx.complete || Promise.resolve();
  }

  async function listMeta() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const all = store.getAll();
      all.onsuccess = () => resolve(all.result || []);
      all.onerror = () => reject(all.error);
    });
  }

  async function removeMeta(id) {
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    return tx.complete || Promise.resolve();
  }

  // Upload to Firebase Storage when available, otherwise store metadata only.
  async function uploadFile(file, onProgress) {
    const id = Date.now() + '_' + file.name;
    const meta = { id, name: file.name, size: file.size, created: Date.now() };

    if (window.storage && typeof window.storage.ref === 'function') {
      const path = `files/${(window.userIP||'guest')}/${id}`;
      const ref = window.storage.ref(path);
      const task = ref.put(file);
      task.on('state_changed', snap => {
        const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
        onProgress && onProgress(pct);
      });
      try {
        await task;
        meta.remotePath = path;
      } catch (err) {
        console.error('Upload failed', err);
        throw err;
      }
    }

    await saveMeta(meta);
    return meta;
  }

  // Remove entries older than 7 days
  async function cleanupExpired() {
    const items = await listMeta();
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const it of items) {
      if ((it.created || 0) < cutoff) {
        if (it.remotePath && window.storage && typeof window.storage.ref === 'function') {
          try { await window.storage.ref(it.remotePath).delete(); } catch(_){}
        }
        await removeMeta(it.id);
      }
    }
  }

  // UI helper: populate #filesGrid similar to existing addFileCard
  async function renderFilesGrid() {
    const grid = document.getElementById('filesGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const items = await listMeta();
    items.forEach(it => {
      const card = document.createElement('div');
      card.className = 'file-card';
      const icon = it.name.endsWith('.pdf') ? '📄' : it.name.endsWith('.mp4') ? '🎬' : '📦';
      card.innerHTML = `
        <div class="file-icon">${icon}</div>
        <div class="file-name">${it.name}</div>
        <div class="file-size">${(it.size/1024/1024).toFixed(2)}MB</div>
        <div class="file-actions">
          <button class="btn" data-id="${it.id}">🗑️ Delete</button>
        </div>`;
      card.querySelector('button').addEventListener('click', async (e) => {
        await removeMeta(it.id);
        card.remove();
      });
      grid.appendChild(card);
    });
  }

  // Expose API
  window.fileStorage = {
    uploadFile,
    listMeta,
    cleanupExpired,
    renderFilesGrid
  };

  // Run periodic cleanup on load
  window.addEventListener('load', () => {
    setTimeout(() => cleanupExpired().then(() => renderFilesGrid()), 300);
  });
})();
