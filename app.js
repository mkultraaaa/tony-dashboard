// Tony Dashboard — Kanban (file-backed + local edits)
(() => {
  const PASS_HASH = '69a82982c9bf8c7670629ebfda7a14fb245b9c52306dc67e9969a27f627e50a5'; // sha256

  function sha256(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    return crypto.subtle.digest('SHA-256', data).then(hash => {
      return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    });
  }

  async function checkAuth() {
    const stored = sessionStorage.getItem('tony_auth');
    if (stored === PASS_HASH) {
      document.body.style.display = 'block';
      return true;
    }

    const pass = prompt('🔒 Пароль для доступа:');
    if (!pass) {
      document.body.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100vh;color:rgba(238,242,255,.65);font-family:Inter,sans-serif;">Доступ запрещён</div>';
      document.body.style.display = 'block';
      return false;
    }

    const hash = await sha256(pass);
    if (hash === PASS_HASH) {
      sessionStorage.setItem('tony_auth', hash);
      document.body.style.display = 'block';
      return true;
    }

    document.body.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100vh;color:#EF4444;font-family:Inter,sans-serif;">Неверный пароль</div>';
    document.body.style.display = 'block';
    return false;
  }

  const LS_KEY = 'tony_tasks_local_v1';

  const state = {
    fileMeta: null,
    tasks: [],
    filter: { q: '', owner: 'all', priority: 'all', tag: 'all' },
    dragId: null,
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function uid() {
    return 'tsk_' + Math.random().toString(16).slice(2, 10);
  }

  function normalizeTask(t) {
    return {
      id: t.id || uid(),
      title: String(t.title || '').trim(),
      desc: String(t.desc || '').trim(),
      status: t.status || 'backlog',
      owner: t.owner || 'Макс',
      priority: t.priority || 'B',
      tags: Array.isArray(t.tags) ? t.tags : (String(t.tags || '').split(',').map(s => s.trim()).filter(Boolean)),
      createdAt: t.createdAt || nowIso(),
      updatedAt: t.updatedAt || nowIso(),
      doneAt: t.doneAt,
    };
  }

  function loadLocalPatch() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.tasks)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function saveLocalPatch(tasks) {
    localStorage.setItem(LS_KEY, JSON.stringify({ updatedAt: nowIso(), tasks }));
  }

  function mergeFileAndLocal(fileTasks, localPatch) {
    if (!localPatch) return fileTasks;

    const byId = new Map(fileTasks.map(t => [t.id, t]));

    for (const t of localPatch.tasks) {
      byId.set(t.id, t);
    }

    return Array.from(byId.values());
  }

  function computeTags(tasks) {
    const set = new Set();
    for (const t of tasks) for (const tag of (t.tags || [])) set.add(tag);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'));
  }

  function el(id) {
    return document.getElementById(id);
  }

  function applyFilters(tasks) {
    const q = state.filter.q.trim().toLowerCase();
    return tasks.filter(t => {
      if (state.filter.owner !== 'all' && t.owner !== state.filter.owner) return false;
      if (state.filter.priority !== 'all' && t.priority !== state.filter.priority) return false;
      if (state.filter.tag !== 'all' && !(t.tags || []).includes(state.filter.tag)) return false;

      if (!q) return true;
      const hay = (t.title + '\n' + (t.desc || '') + '\n' + (t.tags || []).join(' ')).toLowerCase();
      return hay.includes(q);
    });
  }

  function sortTasks(tasks) {
    const pr = { A: 0, B: 1, C: 2 };
    const st = { in_progress: 0, blocked: 1, backlog: 2, done: 3 };

    return tasks.slice().sort((a, b) => {
      const pa = pr[a.priority] ?? 9;
      const pb = pr[b.priority] ?? 9;
      if (pa !== pb) return pa - pb;

      const sa = st[a.status] ?? 9;
      const sb = st[b.status] ?? 9;
      if (sa !== sb) return sa - sb;

      const ua = Date.parse(a.updatedAt || a.createdAt || 0);
      const ub = Date.parse(b.updatedAt || b.createdAt || 0);
      return ub - ua;
    });
  }

  function pill(text, cls) {
    const span = document.createElement('span');
    span.className = 'p ' + cls;
    span.textContent = text;
    return span;
  }

  function render() {
    const filtered = sortTasks(applyFilters(state.tasks));

    const buckets = {
      backlog: [],
      in_progress: [],
      blocked: [],
      done: [],
    };

    for (const t of filtered) {
      (buckets[t.status] || buckets.backlog).push(t);
    }

    // counts (for filtered view)
    el('count-backlog').textContent = buckets.backlog.length;
    el('count-in_progress').textContent = buckets.in_progress.length;
    el('count-blocked').textContent = buckets.blocked.length;
    el('count-done').textContent = buckets.done.length;

    for (const [status, list] of Object.entries(buckets)) {
      const col = el('col-' + status);
      col.innerHTML = '';

      if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'card';
        empty.style.opacity = '0.55';
        empty.style.cursor = 'default';
        empty.innerHTML = '<div class="card-title">Пусто</div><div class="card-desc">Перетащи сюда задачу или создай новую.</div>';
        col.appendChild(empty);
        continue;
      }

      for (const t of list) {
        const card = document.createElement('div');
        card.className = 'card';
        card.draggable = true;
        card.dataset.id = t.id;

        const top = document.createElement('div');
        top.className = 'card-top';

        const title = document.createElement('div');
        title.className = 'card-title';
        title.textContent = t.title || '(без названия)';

        const right = document.createElement('div');
        right.style.display = 'flex';
        right.style.gap = '6px';

        const pills = document.createElement('div');
        pills.className = 'pills';
        pills.appendChild(pill('Owner: ' + t.owner, 'owner'));
        pills.appendChild(pill('P' + t.priority, 'pri' + t.priority));
        for (const tag of (t.tags || []).slice(0, 4)) {
          pills.appendChild(pill('#' + tag, ''));
        }

        top.appendChild(title);
        top.appendChild(right);

        const desc = document.createElement('div');
        desc.className = 'card-desc';
        desc.textContent = t.desc || '';

        card.appendChild(top);
        if (t.desc) card.appendChild(desc);
        card.appendChild(pills);

        card.addEventListener('dragstart', (e) => {
          state.dragId = t.id;
          e.dataTransfer.setData('text/plain', t.id);
          e.dataTransfer.effectAllowed = 'move';
        });

        card.addEventListener('dblclick', () => {
          // quick toggle: backlog -> in_progress -> done
          const order = ['backlog', 'in_progress', 'done'];
          const idx = Math.max(0, order.indexOf(t.status));
          const next = order[Math.min(order.length - 1, idx + 1)];
          moveTask(t.id, next);
        });

        col.appendChild(card);
      }
    }

    // meta footer
    const total = state.tasks.length;
    const shown = filtered.length;
    const updatedAt = state.fileMeta?.updatedAt ? new Date(state.fileMeta.updatedAt) : null;
    el('meta').textContent = `${shown}/${total} задач • file updated: ${updatedAt ? updatedAt.toLocaleString('ru-RU') : '—'}`;

    // sync pill state
    const local = loadLocalPatch();
    const pillEl = el('sync-pill');
    const dot = pillEl.querySelector('.dot');
    const text = pillEl.querySelector('.pill-text');

    if (local) {
      dot.style.background = 'var(--warn)';
      text.textContent = 'Sync: local changes';
      pillEl.title = 'Есть локальные изменения. Нажми Export и закоммить JSON в репо, чтобы синхронизировать между устройствами.';
    } else {
      dot.style.background = 'var(--good)';
      text.textContent = 'Sync: file + local';
      pillEl.title = 'Данные берутся из data/tasks.json. Если ты перетаскиваешь/создаёшь задачи в браузере — они сохраняются локально.';
    }
  }

  function moveTask(id, newStatus) {
    const t = state.tasks.find(x => x.id === id);
    if (!t) return;
    t.status = newStatus;
    t.updatedAt = nowIso();
    if (newStatus === 'done' && !t.doneAt) t.doneAt = nowIso();

    // Persist local patch
    saveLocalPatch(state.tasks);
    render();
  }

  function wireDnD() {
    for (const status of ['backlog', 'in_progress', 'blocked', 'done']) {
      const col = el('col-' + status);

      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        col.classList.add('dropHint');
      });

      col.addEventListener('dragleave', () => {
        col.classList.remove('dropHint');
      });

      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.classList.remove('dropHint');
        const id = e.dataTransfer.getData('text/plain') || state.dragId;
        if (!id) return;
        moveTask(id, status);
      });
    }
  }

  function openModal() {
    const m = el('modal');
    m.setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    const m = el('modal');
    m.setAttribute('aria-hidden', 'true');
  }

  function clearModal() {
    el('f-title').value = '';
    el('f-desc').value = '';
    el('f-tags').value = '';
    el('f-owner').value = 'Макс';
    el('f-priority').value = 'B';
    el('f-status').value = 'backlog';
  }

  function saveFromModal() {
    const title = el('f-title').value.trim();
    if (!title) {
      alert('Title обязателен');
      return;
    }

    const task = normalizeTask({
      id: uid(),
      title,
      desc: el('f-desc').value.trim(),
      tags: el('f-tags').value,
      owner: el('f-owner').value,
      priority: el('f-priority').value,
      status: el('f-status').value,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });

    state.tasks.unshift(task);
    saveLocalPatch(state.tasks);

    closeModal();
    clearModal();
    refreshTagFilter();
    render();
  }

  function refreshTagFilter() {
    const tagSel = el('tag');
    const cur = tagSel.value;
    const tags = computeTags(state.tasks);

    tagSel.innerHTML = '<option value="all">Tag: все</option>' + tags.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');

    // restore
    if ([...tagSel.options].some(o => o.value === cur)) tagSel.value = cur;
  }

  function exportJson() {
    const payload = {
      meta: { updatedAt: nowIso(), version: 1 },
      tasks: state.tasks,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tasks.export.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  async function boot() {
    const ok = await checkAuth();
    if (!ok) return;

    // Load tasks file
    const res = await fetch('./data/tasks.json', { cache: 'no-store' });
    const json = await res.json();

    state.fileMeta = json.meta || null;
    const fileTasks = (json.tasks || []).map(normalizeTask);

    const localPatch = loadLocalPatch();
    const merged = mergeFileAndLocal(fileTasks, localPatch);

    state.tasks = merged.map(normalizeTask);

    // UI wiring
    el('q').addEventListener('input', (e) => {
      state.filter.q = e.target.value;
      render();
    });

    el('owner').addEventListener('change', (e) => {
      state.filter.owner = e.target.value;
      render();
    });

    el('priority').addEventListener('change', (e) => {
      state.filter.priority = e.target.value;
      render();
    });

    el('tag').addEventListener('change', (e) => {
      state.filter.tag = e.target.value;
      render();
    });

    el('btn-new').addEventListener('click', () => {
      openModal();
    });

    el('btn-save').addEventListener('click', () => saveFromModal());
    el('btn-export').addEventListener('click', () => exportJson());

    el('modal').addEventListener('click', (e) => {
      const close = e.target?.dataset?.close === 'true';
      if (close) closeModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        el('q').focus();
      }
    });

    refreshTagFilter();
    wireDnD();
    render();

    // Refresh page occasionally (data file can change)
    setInterval(() => location.reload(), 10 * 60 * 1000);
  }

  boot();
})();
