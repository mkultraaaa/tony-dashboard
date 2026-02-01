// Tony Dashboard — Second Brain (encrypted local vault)
// - Vault stored in localStorage (AES-GCM)
// - One password, user remembers
// - Tasks: seed from ./data/tasks.json on first run
// - Knowledge pages + Activity log + Goals

(() => {
  // ---------------------------
  // Helpers
  // ---------------------------
  const LS_VAULT = 'tony_vault_v1';
  const LS_VAULT_META = 'tony_vault_meta_v1';

  const TEXT = new TextEncoder();
  const TEXTD = new TextDecoder();

  const state = {
    unlocked: false,
    key: null,
    vault: null,
    filter: { q: '', owner: 'all', priority: 'all', tag: 'all' },
    dragId: null,
    selectedNoteId: null,
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function fmtTs(iso) {
    try {
      return new Date(iso).toLocaleString('ru-RU', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
      });
    } catch {
      return String(iso);
    }
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Math.random().toString(16).slice(2, 10);
  }

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  // ---------------------------
  // Crypto (PBKDF2 -> AES-GCM)
  // ---------------------------
  async function deriveKey(password, saltBytes) {
    const baseKey = await crypto.subtle.importKey(
      'raw',
      TEXT.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations: 210000,
        hash: 'SHA-256'
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  function b64(bytes) {
    let bin = '';
    bytes.forEach(b => bin += String.fromCharCode(b));
    return btoa(bin);
  }

  function unb64(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function encryptJson(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = TEXT.encode(JSON.stringify(obj));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
  }

  async function decryptJson(key, payload) {
    const iv = unb64(payload.iv);
    const ct = unb64(payload.ct);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return JSON.parse(TEXTD.decode(pt));
  }

  function readVaultMeta() {
    try {
      const raw = localStorage.getItem(LS_VAULT_META);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function writeVaultMeta(meta) {
    localStorage.setItem(LS_VAULT_META, JSON.stringify(meta));
  }

  function readVaultBlob() {
    try {
      const raw = localStorage.getItem(LS_VAULT);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function writeVaultBlob(blob) {
    localStorage.setItem(LS_VAULT, JSON.stringify(blob));
  }

  function setVaultUi(locked) {
    const dot = el('vault-dot');
    const text = el('vault-text');
    if (locked) {
      dot.style.background = 'var(--warn)';
      text.textContent = 'Vault: locked';
      document.body.style.display = 'block';
    } else {
      dot.style.background = 'var(--good)';
      text.textContent = 'Vault: unlocked';
      document.body.style.display = 'block';
    }
  }

  // ---------------------------
  // Vault schema
  // ---------------------------
  function emptyVault(seed) {
    return {
      meta: {
        version: 1,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
      tasks: seed?.tasks || [],
      notes: seed?.notes || [],
      activity: [],
      goals: seed?.goals || {
        primary: {
          title: '$1K/мес дополнительного дохода',
          deadline: 'май-июнь 2026',
          current: 0,
          target: 1000,
          notes: 'Фокус: монетизация Padel Americano/Mexicano'
        }
      }
    };
  }

  function normalizeTask(t) {
    return {
      id: t.id || uid('tsk'),
      title: String(t.title || '').trim(),
      desc: String(t.desc || '').trim(),
      status: t.status || 'backlog',
      owner: t.owner || 'Макс',
      priority: t.priority || 'B',
      tags: Array.isArray(t.tags)
        ? t.tags
        : (String(t.tags || '').split(',').map(s => s.trim()).filter(Boolean)),
      createdAt: t.createdAt || nowIso(),
      updatedAt: t.updatedAt || nowIso(),
      doneAt: t.doneAt,
    };
  }

  function normalizeNote(n) {
    return {
      id: n.id || uid('note'),
      title: String(n.title || '').trim() || 'Untitled',
      body: String(n.body || ''),
      tags: Array.isArray(n.tags) ? n.tags : [],
      updatedAt: n.updatedAt || nowIso(),
    };
  }

  function addActivity(text) {
    state.vault.activity.unshift({
      id: uid('act'),
      time: nowIso(),
      text,
    });

    // keep small-ish
    if (state.vault.activity.length > 500) state.vault.activity.length = 500;
  }

  async function persistVault() {
    state.vault.meta.updatedAt = nowIso();
    const blob = await encryptJson(state.key, state.vault);
    writeVaultBlob(blob);
  }

  // ---------------------------
  // Modal builder
  // ---------------------------
  function modalOpen({ title, sub, bodyHtml, footerHtml }) {
    el('modalTitle').textContent = title || '';
    el('modalSub').textContent = sub || '';
    el('modalBody').innerHTML = bodyHtml || '';
    el('modalFoot').innerHTML = footerHtml || '';
    el('modal').setAttribute('aria-hidden', 'false');
  }

  function modalClose() {
    el('modal').setAttribute('aria-hidden', 'true');
  }

  // ---------------------------
  // Rendering
  // ---------------------------
  function computeTags(tasks) {
    const set = new Set();
    for (const t of tasks) for (const tag of (t.tags || [])) set.add(tag);
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'));
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

  function renderTasks() {
    const tasks = state.vault.tasks.map(normalizeTask);
    state.vault.tasks = tasks;

    const filtered = sortTasks(applyFilters(tasks));
    const buckets = { backlog: [], in_progress: [], blocked: [], done: [] };
    for (const t of filtered) (buckets[t.status] || buckets.backlog).push(t);

    el('count-backlog').textContent = buckets.backlog.length;
    el('count-in_progress').textContent = buckets.in_progress.length;
    el('count-blocked').textContent = buckets.blocked.length;
    el('count-done').textContent = buckets.done.length;

    for (const status of Object.keys(buckets)) {
      const col = el('col-' + status);
      col.innerHTML = '';

      const list = buckets[status];
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

        top.appendChild(title);

        const desc = document.createElement('div');
        desc.className = 'card-desc';
        desc.textContent = t.desc || '';

        const pills = document.createElement('div');
        pills.className = 'pills';
        pills.appendChild(pill('Owner: ' + t.owner, 'owner'));
        pills.appendChild(pill('P' + t.priority, 'pri' + t.priority));
        for (const tag of (t.tags || []).slice(0, 6)) pills.appendChild(pill('#' + tag, ''));

        card.appendChild(top);
        if (t.desc) card.appendChild(desc);
        card.appendChild(pills);

        card.addEventListener('dragstart', (e) => {
          state.dragId = t.id;
          e.dataTransfer.setData('text/plain', t.id);
          e.dataTransfer.effectAllowed = 'move';
        });

        card.addEventListener('dblclick', () => {
          editTaskModal(t.id);
        });

        col.appendChild(card);
      }
    }

    // meta
    const total = tasks.length;
    const shown = filtered.length;
    el('meta').textContent = `${shown}/${total} задач • vault updated: ${fmtTs(state.vault.meta.updatedAt)}`;

    // tag filter options
    const tagSel = el('tag');
    const cur = tagSel.value;
    const tags = computeTags(tasks);
    tagSel.innerHTML = '<option value="all">Tag: все</option>' + tags.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    if ([...tagSel.options].some(o => o.value === cur)) tagSel.value = cur;
  }

  function renderKnowledge() {
    const notes = state.vault.notes.map(normalizeNote);
    state.vault.notes = notes;

    const list = el('k-list');
    list.innerHTML = '';

    const sorted = notes.slice().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    if (!state.selectedNoteId && sorted[0]) state.selectedNoteId = sorted[0].id;

    for (const n of sorted) {
      const item = document.createElement('div');
      item.className = 'k-item' + (n.id === state.selectedNoteId ? ' active' : '');
      item.dataset.id = n.id;
      item.innerHTML = `
        <div class="k-item-title">${escapeHtml(n.title)}</div>
        <div class="k-item-meta">${fmtTs(n.updatedAt)} • ${escapeHtml((n.tags||[]).slice(0,3).join(', '))}</div>
      `;
      item.addEventListener('click', () => {
        state.selectedNoteId = n.id;
        renderKnowledge();
      });
      list.appendChild(item);
    }

    const cur = notes.find(x => x.id === state.selectedNoteId) || sorted[0];
    if (!cur) {
      el('k-title').textContent = '—';
      el('k-meta').textContent = '—';
      el('k-content').innerHTML = '<div class="card" style="cursor:default;opacity:.7"><div class="card-title">Пока нет страниц</div><div class="card-desc">Создай первую заметку.</div></div>';
      return;
    }

    el('k-title').textContent = cur.title;
    el('k-meta').textContent = `${fmtTs(cur.updatedAt)} • ${cur.tags?.length ? ('#' + cur.tags.join(' #')) : 'без тегов'}`;

    // Minimal markdown (safe-ish): escape then basic transforms.
    // (No external libs by default; can be upgraded later.)
    el('k-content').innerHTML = renderMarkdown(cur.body);
  }

  function renderMarkdown(md) {
    const s = String(md || '');

    // basic escaping first
    let out = escapeHtml(s);

    // code blocks ```
    out = out.replace(/```([\s\S]*?)```/g, (m, g1) => {
      return `<pre><code>${g1}</code></pre>`;
    });

    // inline code
    out = out.replace(/`([^`]+)`/g, (m, g1) => `<code>${g1}</code>`);

    // headings
    out = out.replace(/^###\s(.+)$/gm, '<h3>$1</h3>');
    out = out.replace(/^##\s(.+)$/gm, '<h2>$1</h2>');
    out = out.replace(/^#\s(.+)$/gm, '<h1>$1</h1>');

    // lists
    out = out.replace(/^(?:-\s.+(?:\n|$))+?/gm, (block) => {
      const items = block.trim().split(/\n/).map(line => line.replace(/^-\s/, '').trim());
      return '<ul>' + items.map(i => `<li>${i}</li>`).join('') + '</ul>';
    });

    // paragraphs
    out = out
      .split(/\n\n+/)
      .map(p => {
        if (p.startsWith('<h') || p.startsWith('<ul>') || p.startsWith('<pre>')) return p;
        return `<p>${p.replace(/\n/g, '<br/>')}</p>`;
      })
      .join('');

    return out;
  }

  function renderActivity() {
    const a = el('activity');
    a.innerHTML = '';

    const list = state.vault.activity || [];
    if (list.length === 0) {
      a.innerHTML = '<div class="a-row" style="opacity:.7"><div class="a-time">—</div><div class="a-text">Пока пусто. Действия появятся автоматически.</div></div>';
      return;
    }

    for (const row of list.slice(0, 250)) {
      const div = document.createElement('div');
      div.className = 'a-row';
      div.innerHTML = `<div class="a-time">${fmtTs(row.time)}</div><div class="a-text">${escapeHtml(row.text)}</div>`;
      a.appendChild(div);
    }
  }

  function renderGoals() {
    const g = el('goals');
    g.innerHTML = '';

    const primary = state.vault.goals?.primary;
    if (!primary) {
      g.innerHTML = '<div class="goal"><div class="goal-title">Нет данных</div></div>';
      return;
    }

    const pct = primary.target ? clamp((primary.current / primary.target) * 100, 0, 100) : 0;

    const div = document.createElement('div');
    div.className = 'goal';
    div.innerHTML = `
      <div class="goal-title">${escapeHtml(primary.title)}</div>
      <div class="goal-meta">Дедлайн: ${escapeHtml(primary.deadline || '—')} • ${escapeHtml(primary.notes || '')}</div>
      <div class="bar"><div class="fill" style="width:${Math.max(2, pct)}%"></div></div>
      <div class="goal-meta" style="margin-top:8px">$${primary.current} / $${primary.target}</div>
    `;
    g.appendChild(div);
  }

  function renderAll() {
    renderTasks();
    renderKnowledge();
    renderActivity();
    renderGoals();
  }

  // ---------------------------
  // Interactions
  // ---------------------------
  function wireDnD() {
    for (const status of ['backlog', 'in_progress', 'blocked', 'done']) {
      const col = el('col-' + status);
      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        col.classList.add('dropHint');
      });
      col.addEventListener('dragleave', () => col.classList.remove('dropHint'));
      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('dropHint');
        const id = e.dataTransfer.getData('text/plain') || state.dragId;
        if (!id) return;
        await moveTask(id, status);
      });
    }
  }

  async function moveTask(id, newStatus) {
    const t = state.vault.tasks.find(x => x.id === id);
    if (!t) return;

    const prev = t.status;
    t.status = newStatus;
    t.updatedAt = nowIso();
    if (newStatus === 'done' && !t.doneAt) t.doneAt = nowIso();

    addActivity(`Task moved: "${t.title}" (${prev} → ${newStatus})`);
    await persistVault();
    renderAll();
  }

  function newTaskModal() {
    modalOpen({
      title: 'Новая задача',
      sub: 'Создаёт карточку в vault (шифруется).',
      bodyHtml: `
        <div class="grid">
          <label class="field">
            <span class="label">Title</span>
            <input class="input" id="f-title" placeholder="Например: Пэйволл v1" />
          </label>
          <label class="field">
            <span class="label">Owner</span>
            <select class="select" id="f-owner"><option>Макс</option><option>Тони</option></select>
          </label>
          <label class="field">
            <span class="label">Priority</span>
            <select class="select" id="f-priority"><option>A</option><option selected>B</option><option>C</option></select>
          </label>
          <label class="field">
            <span class="label">Status</span>
            <select class="select" id="f-status">
              <option value="backlog">Backlog</option>
              <option value="in_progress">In progress</option>
              <option value="blocked">Blocked</option>
              <option value="done">Done</option>
            </select>
          </label>
          <label class="field span2">
            <span class="label">Description</span>
            <textarea class="textarea" id="f-desc" placeholder="Критерий готовности / что на выходе"></textarea>
          </label>
          <label class="field span2">
            <span class="label">Tags (через запятую)</span>
            <input class="input" id="f-tags" placeholder="padel, money" />
          </label>
        </div>
      `,
      footerHtml: `
        <button class="btn ghost" data-close="true">Cancel</button>
        <button class="btn" id="btn-save">Save</button>
      `
    });

    el('btn-save').onclick = async () => {
      const title = el('f-title').value.trim();
      if (!title) return alert('Title обязателен');

      const task = normalizeTask({
        id: uid('tsk'),
        title,
        desc: el('f-desc').value.trim(),
        tags: el('f-tags').value,
        owner: el('f-owner').value,
        priority: el('f-priority').value,
        status: el('f-status').value,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });

      state.vault.tasks.unshift(task);
      addActivity(`Task created: "${task.title}" (owner: ${task.owner}, priority: ${task.priority})`);
      await persistVault();

      modalClose();
      renderAll();
    };
  }

  function editTaskModal(taskId) {
    const t = state.vault.tasks.find(x => x.id === taskId);
    if (!t) return;

    modalOpen({
      title: 'Редактировать задачу',
      sub: `ID: ${t.id}`,
      bodyHtml: `
        <div class="grid">
          <label class="field">
            <span class="label">Title</span>
            <input class="input" id="f-title" value="${escapeHtml(t.title)}" />
          </label>
          <label class="field">
            <span class="label">Owner</span>
            <select class="select" id="f-owner">
              <option ${t.owner === 'Макс' ? 'selected' : ''}>Макс</option>
              <option ${t.owner === 'Тони' ? 'selected' : ''}>Тони</option>
            </select>
          </label>
          <label class="field">
            <span class="label">Priority</span>
            <select class="select" id="f-priority">
              <option ${t.priority === 'A' ? 'selected' : ''}>A</option>
              <option ${t.priority === 'B' ? 'selected' : ''}>B</option>
              <option ${t.priority === 'C' ? 'selected' : ''}>C</option>
            </select>
          </label>
          <label class="field">
            <span class="label">Status</span>
            <select class="select" id="f-status">
              <option value="backlog" ${t.status === 'backlog' ? 'selected' : ''}>Backlog</option>
              <option value="in_progress" ${t.status === 'in_progress' ? 'selected' : ''}>In progress</option>
              <option value="blocked" ${t.status === 'blocked' ? 'selected' : ''}>Blocked</option>
              <option value="done" ${t.status === 'done' ? 'selected' : ''}>Done</option>
            </select>
          </label>
          <label class="field span2">
            <span class="label">Description</span>
            <textarea class="textarea" id="f-desc">${escapeHtml(t.desc || '')}</textarea>
          </label>
          <label class="field span2">
            <span class="label">Tags (через запятую)</span>
            <input class="input" id="f-tags" value="${escapeHtml((t.tags||[]).join(', '))}" />
          </label>
        </div>
      `,
      footerHtml: `
        <button class="btn ghost" data-close="true">Cancel</button>
        <button class="btn ghost" id="btn-del">Delete</button>
        <button class="btn" id="btn-save">Save</button>
      `
    });

    el('btn-save').onclick = async () => {
      const prevTitle = t.title;
      t.title = el('f-title').value.trim() || t.title;
      t.owner = el('f-owner').value;
      t.priority = el('f-priority').value;
      t.status = el('f-status').value;
      t.desc = el('f-desc').value.trim();
      t.tags = el('f-tags').value.split(',').map(s => s.trim()).filter(Boolean);
      t.updatedAt = nowIso();
      if (t.status === 'done' && !t.doneAt) t.doneAt = nowIso();

      addActivity(`Task edited: "${prevTitle}" → "${t.title}"`);
      await persistVault();
      modalClose();
      renderAll();
    };

    el('btn-del').onclick = async () => {
      if (!confirm('Удалить задачу?')) return;
      state.vault.tasks = state.vault.tasks.filter(x => x.id !== t.id);
      addActivity(`Task deleted: "${t.title}"`);
      await persistVault();
      modalClose();
      renderAll();
    };
  }

  function newNoteModal() {
    modalOpen({
      title: 'Новая страница (Knowledge)',
      sub: 'Markdown поддерживается (заголовки, списки, код).',
      bodyHtml: `
        <div class="grid">
          <label class="field span2">
            <span class="label">Title</span>
            <input class="input" id="n-title" placeholder="Например: Padel — монетизация" />
          </label>
          <label class="field span2">
            <span class="label">Tags (через запятую)</span>
            <input class="input" id="n-tags" placeholder="padel, money" />
          </label>
          <label class="field span2">
            <span class="label">Body (Markdown)</span>
            <textarea class="textarea" id="n-body" placeholder="# Заголовок\n\n- пункт\n- пункт"></textarea>
          </label>
        </div>
      `,
      footerHtml: `
        <button class="btn ghost" data-close="true">Cancel</button>
        <button class="btn" id="btn-save">Save</button>
      `
    });

    el('btn-save').onclick = async () => {
      const title = el('n-title').value.trim();
      if (!title) return alert('Title обязателен');
      const note = normalizeNote({
        id: uid('note'),
        title,
        tags: el('n-tags').value.split(',').map(s => s.trim()).filter(Boolean),
        body: el('n-body').value,
        updatedAt: nowIso(),
      });

      state.vault.notes.unshift(note);
      state.selectedNoteId = note.id;
      addActivity(`Knowledge created: "${note.title}"`);
      await persistVault();
      modalClose();
      renderAll();
      switchTab('knowledge');
    };
  }

  function editNoteModal(noteId) {
    const n = state.vault.notes.find(x => x.id === noteId);
    if (!n) return;

    modalOpen({
      title: 'Редактировать страницу',
      sub: `ID: ${n.id}`,
      bodyHtml: `
        <div class="grid">
          <label class="field span2">
            <span class="label">Title</span>
            <input class="input" id="n-title" value="${escapeHtml(n.title)}" />
          </label>
          <label class="field span2">
            <span class="label">Tags (через запятую)</span>
            <input class="input" id="n-tags" value="${escapeHtml((n.tags||[]).join(', '))}" />
          </label>
          <label class="field span2">
            <span class="label">Body (Markdown)</span>
            <textarea class="textarea" id="n-body">${escapeHtml(n.body || '')}</textarea>
          </label>
        </div>
      `,
      footerHtml: `
        <button class="btn ghost" data-close="true">Cancel</button>
        <button class="btn ghost" id="btn-del">Delete</button>
        <button class="btn" id="btn-save">Save</button>
      `
    });

    el('btn-save').onclick = async () => {
      const prev = n.title;
      n.title = el('n-title').value.trim() || n.title;
      n.tags = el('n-tags').value.split(',').map(s => s.trim()).filter(Boolean);
      n.body = el('n-body').value;
      n.updatedAt = nowIso();

      addActivity(`Knowledge edited: "${prev}" → "${n.title}"`);
      await persistVault();
      modalClose();
      renderAll();
    };

    el('btn-del').onclick = async () => {
      if (!confirm('Удалить страницу?')) return;
      state.vault.notes = state.vault.notes.filter(x => x.id !== n.id);
      addActivity(`Knowledge deleted: "${n.title}"`);
      await persistVault();
      modalClose();
      state.selectedNoteId = state.vault.notes[0]?.id || null;
      renderAll();
    };
  }

  function editGoalsModal() {
    const g = state.vault.goals?.primary || { title: '', deadline: '', current: 0, target: 0, notes: '' };

    modalOpen({
      title: 'Goals (MVP)',
      sub: 'Редактирование основной цели.',
      bodyHtml: `
        <div class="grid">
          <label class="field span2"><span class="label">Title</span><input class="input" id="g-title" value="${escapeHtml(g.title||'')}" /></label>
          <label class="field"><span class="label">Current</span><input class="input" id="g-current" type="number" value="${escapeHtml(String(g.current||0))}" /></label>
          <label class="field"><span class="label">Target</span><input class="input" id="g-target" type="number" value="${escapeHtml(String(g.target||1000))}" /></label>
          <label class="field span2"><span class="label">Deadline</span><input class="input" id="g-deadline" value="${escapeHtml(g.deadline||'')}" /></label>
          <label class="field span2"><span class="label">Notes</span><textarea class="textarea" id="g-notes">${escapeHtml(g.notes||'')}</textarea></label>
        </div>
      `,
      footerHtml: `
        <button class="btn ghost" data-close="true">Cancel</button>
        <button class="btn" id="btn-save">Save</button>
      `
    });

    el('btn-save').onclick = async () => {
      const current = Number(el('g-current').value || 0);
      const target = Number(el('g-target').value || 0);
      state.vault.goals = state.vault.goals || {};
      state.vault.goals.primary = {
        title: el('g-title').value.trim(),
        deadline: el('g-deadline').value.trim(),
        current: isFinite(current) ? current : 0,
        target: isFinite(target) ? target : 0,
        notes: el('g-notes').value,
      };
      addActivity('Goals updated');
      await persistVault();
      modalClose();
      renderAll();
    };
  }

  // ---------------------------
  // Tabs
  // ---------------------------
  function switchTab(name) {
    // views
    for (const v of document.querySelectorAll('.view')) {
      v.style.display = (v.dataset.view === name) ? 'block' : 'none';
    }

    // tabs
    for (const t of document.querySelectorAll('.tab')) {
      t.classList.toggle('active', t.dataset.tab === name);
    }

    // toolbar visibility
    el('toolbar').style.display = (name === 'tasks') ? 'flex' : 'none';

    // new button
    el('btn-new').style.display = (name === 'tasks') ? 'inline-block' : 'none';
  }

  // ---------------------------
  // Import / Export
  // ---------------------------
  async function exportAll() {
    const payload = {
      meta: { exportedAt: nowIso(), version: 1 },
      vault: state.vault,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tony.secondbrain.export.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    addActivity('Export created (JSON)');
    await persistVault();
    renderAll();
  }

  async function importAll(fileText) {
    let json;
    try {
      json = JSON.parse(fileText);
    } catch {
      alert('Не получилось прочитать JSON');
      return;
    }

    const vault = json.vault;
    if (!vault || typeof vault !== 'object') {
      alert('Файл не похож на экспорт Tony Second Brain');
      return;
    }

    if (!confirm('Импорт заменит текущие данные в vault. Продолжить?')) return;

    // normalize basic
    vault.meta = vault.meta || { version: 1, createdAt: nowIso(), updatedAt: nowIso() };
    vault.meta.updatedAt = nowIso();
    vault.tasks = (vault.tasks || []).map(normalizeTask);
    vault.notes = (vault.notes || []).map(normalizeNote);
    vault.activity = Array.isArray(vault.activity) ? vault.activity : [];
    vault.goals = vault.goals || {};

    state.vault = vault;
    addActivity('Import applied (JSON)');
    await persistVault();

    state.selectedNoteId = state.vault.notes[0]?.id || null;
    renderAll();
  }

  // ---------------------------
  // Vault onboarding
  // ---------------------------
  async function ensureVaultUnlocked() {
    const meta = readVaultMeta();
    const blob = readVaultBlob();

    if (!meta || !blob) {
      // First run → set password + create vault
      const p1 = prompt('🔐 Создай пароль для Second Brain (запомни его):');
      if (!p1) throw new Error('Password required');
      const p2 = prompt('🔐 Повтори пароль:');
      if (p1 !== p2) {
        alert('Пароли не совпали');
        throw new Error('Password mismatch');
      }

      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveKey(p1, salt);

      // seed from files
      const [seedTasks, seed] = await Promise.all([
        fetch('./data/tasks.json', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ tasks: [] })),
        fetch('./data/seed.json', { cache: 'no-store' }).then(r => r.json()).catch(() => ({ notes: [], goals: {} })),
      ]);

      const vault = emptyVault({
        tasks: (seedTasks.tasks || []).map(normalizeTask),
        notes: (seed.notes || []).map(normalizeNote),
        goals: seed.goals || undefined,
      });

      addActivity.call({ vault }, 'Vault created'); // no-op safe

      const enc = await encryptJson(key, vault);
      writeVaultMeta({ version: 1, salt: b64(salt) });
      writeVaultBlob(enc);

      state.key = key;
      state.vault = vault;
      state.unlocked = true;
      state.selectedNoteId = vault.notes[0]?.id || null;
      return;
    }

    // Existing vault → ask password
    const pass = prompt('🔐 Пароль для Second Brain:');
    if (!pass) throw new Error('Password required');

    try {
      const salt = unb64(meta.salt);
      const key = await deriveKey(pass, salt);
      const vault = await decryptJson(key, blob);

      // normalize
      vault.meta = vault.meta || { version: 1, createdAt: nowIso(), updatedAt: nowIso() };
      vault.tasks = (vault.tasks || []).map(normalizeTask);
      vault.notes = (vault.notes || []).map(normalizeNote);
      vault.activity = Array.isArray(vault.activity) ? vault.activity : [];
      vault.goals = vault.goals || {};

      state.key = key;
      state.vault = vault;
      state.unlocked = true;
      state.selectedNoteId = vault.notes[0]?.id || null;
    } catch {
      alert('Неверный пароль или повреждённое хранилище');
      throw new Error('Vault unlock failed');
    }
  }

  // ---------------------------
  // Boot
  // ---------------------------
  async function boot() {
    setVaultUi(true);

    await ensureVaultUnlocked();
    setVaultUi(false);

    // wire modal close
    el('modal').addEventListener('click', (e) => {
      const close = e.target?.dataset?.close === 'true';
      if (close) modalClose();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') modalClose();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const q = el('q');
        if (q) q.focus();
      }
    });

    // tabs
    for (const t of document.querySelectorAll('.tab')) {
      t.addEventListener('click', () => switchTab(t.dataset.tab));
    }

    // toolbar filters
    el('q').addEventListener('input', (e) => { state.filter.q = e.target.value; renderTasks(); });
    el('owner').addEventListener('change', (e) => { state.filter.owner = e.target.value; renderTasks(); });
    el('priority').addEventListener('change', (e) => { state.filter.priority = e.target.value; renderTasks(); });
    el('tag').addEventListener('change', (e) => { state.filter.tag = e.target.value; renderTasks(); });

    // actions
    el('btn-new').addEventListener('click', () => newTaskModal());
    el('btn-new-note').addEventListener('click', () => newNoteModal());

    el('btn-edit-note').addEventListener('click', () => {
      if (!state.selectedNoteId) return;
      editNoteModal(state.selectedNoteId);
    });

    el('btn-delete-note').addEventListener('click', async () => {
      const n = state.vault.notes.find(x => x.id === state.selectedNoteId);
      if (!n) return;
      if (!confirm('Удалить страницу?')) return;
      state.vault.notes = state.vault.notes.filter(x => x.id !== n.id);
      addActivity(`Knowledge deleted: "${n.title}"`);
      state.selectedNoteId = state.vault.notes[0]?.id || null;
      await persistVault();
      renderAll();
    });

    el('btn-clear-activity').addEventListener('click', async () => {
      if (!confirm('Очистить Activity?')) return;
      state.vault.activity = [];
      addActivity('Activity cleared');
      await persistVault();
      renderAll();
    });

    el('btn-edit-goals').addEventListener('click', () => editGoalsModal());

    el('btn-export').addEventListener('click', () => exportAll());

    el('btn-import').addEventListener('click', () => {
      el('file').value = '';
      el('file').click();
    });

    el('file').addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      const text = await f.text();
      await importAll(text);
    });

    // DnD
    wireDnD();

    // initial activity record
    addActivity('Dashboard opened');
    await persistVault();

    renderAll();
    switchTab('tasks');

    // refresh occasionally (just UI; vault stays local)
    setInterval(() => location.reload(), 15 * 60 * 1000);
  }

  boot().catch(err => {
    console.error(err);
    document.body.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100vh;color:rgba(238,242,255,.65);font-family:Inter,sans-serif;padding:24px;text-align:center;">Не удалось открыть Second Brain. Проверь пароль/хранилище и обнови страницу.</div>';
    document.body.style.display = 'block';
  });
})();
