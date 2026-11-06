(() => {
  const tg = window.Telegram?.WebApp;
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
  let toastTimer;

  function isDarkColor(color) {
    const value = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color || '')?.[1];
    if (!value) return false;
    const hex = value.length === 3 ? [...value].map((part) => part + part).join('') : value;
    const channels = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
    const luminance = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * luminance[0] + 0.7152 * luminance[1] + 0.0722 * luminance[2] < 0.45;
  }

  function applyTheme() {
    const scheme = tg?.colorScheme;
    const backgroundColor = tg?.themeParams?.bg_color;
    const theme = scheme === 'dark' ? 'dark'
      : scheme === 'light' ? 'light'
        : backgroundColor ? isDarkColor(backgroundColor) ? 'dark' : 'light'
          : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = theme === 'dark' ? '#101522' : '#f3f4f8';
  }

  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
  tg?.onEvent?.('themeChanged', applyTheme);
  if (tg) {
    tg.ready();
    tg.expand();
    tg.enableClosingConfirmation?.();
    if (document.body.dataset.page?.startsWith('/content/')) {
      tg.BackButton?.show();
      tg.BackButton?.onClick(() => history.back());
    } else {
      tg.BackButton?.hide();
    }
  }

  function notify(message, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle('error', type === 'error');
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  async function api(url, options = {}) {
    const headers = { 'X-CSRF-Token': csrfToken, ...(options.headers || {}) };
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed. Please try again.');
    return data;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  async function authenticate() {
    const status = document.querySelector('[data-auth-status]');
    if (!tg?.initData) {
      if (status) status.textContent = 'Open this app inside Telegram to continue.';
      return;
    }
    try {
      const result = await api('/api/telegram/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: tg.initData })
      });
      location.assign(result.redirect || '/');
    } catch (error) {
      if (status) status.textContent = `Telegram sign-in failed: ${error.message}`;
      notify(error.message, 'error');
    }
  }
  if (document.querySelector('[data-auth-status]')) authenticate();

  async function loadContents(page = 1, append = false) {
    const list = document.getElementById('content-list');
    if (!list) return;
    const search = document.getElementById('search-input')?.value || '';
    const sort = document.querySelector('.filter-chip.selected')?.dataset.sort || 'latest';
    try {
      const params = new URLSearchParams({ q: search, sort, page: String(page) });
      const result = await api(`/api/contents?${params}`);
      if (!append) list.replaceChildren();
      const fragment = document.createDocumentFragment();
      result.contents.forEach((content) => {
        const card = document.createElement('article');
        card.className = 'content-card';
        const image = content.imageUrl
          ? `<img src="${escapeHtml(content.imageUrl)}" alt="" loading="lazy">`
          : '<span class="image-placeholder"><i class="fa-solid fa-video" aria-hidden="true"></i></span>';
        const date = new Date(content.date).toLocaleDateString();
        const unlocked = Boolean(content.isUnlocked);
        const completed = Number(content.taskProgress?.completed || 0);
        const total = Number(content.taskProgress?.total ?? content.requiredTaskCount ?? 0);
        card.innerHTML = `<a class="content-image" href="/content/${encodeURIComponent(content._id)}">${image}<span class="lock-badge"><i class="fa-solid ${unlocked ? 'fa-lock-open' : 'fa-lock'}" aria-hidden="true"></i> ${unlocked ? 'Unlocked' : 'Locked'}</span></a>
          <div class="content-card-body"><div class="content-meta"><span><i class="fa-regular fa-calendar" aria-hidden="true"></i> ${escapeHtml(date)}</span><span><i class="fa-solid fa-eye" aria-hidden="true"></i> ${Number(content.totalViews || 0).toLocaleString()}</span></div>
          <h3><a href="/content/${encodeURIComponent(content._id)}">${escapeHtml(content.title)}</a></h3><div class="content-card-footer"><span class="task-count"><i class="fa-solid fa-layer-group" aria-hidden="true"></i> Tasks (${completed}/${total})</span><div class="card-actions"><button class="icon-button" data-share="${escapeHtml(content.title)}" data-url="${escapeHtml(location.origin + '/content/' + content._id)}" aria-label="Share ${escapeHtml(content.title)}"><i class="fa-solid fa-share-nodes" aria-hidden="true"></i></button><a class="button button-small button-dark" href="/content/${encodeURIComponent(content._id)}">Details</a></div></div></div>`;
        fragment.append(card);
      });
      if (!append && result.contents.length === 0) {
        list.innerHTML = '<div class="empty-state"><i class="fa-solid fa-video" aria-hidden="true"></i><h3>No matching links</h3><p>Try a different search or filter.</p></div>';
      } else list.append(fragment);
      const loadMore = document.getElementById('load-more');
      if (loadMore) {
        loadMore.hidden = !result.hasMore;
        loadMore.dataset.page = String(page);
      }
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  document.getElementById('content-search')?.addEventListener('submit', (event) => {
    event.preventDefault();
    loadContents(1);
  });
  document.querySelectorAll('.filter-chip').forEach((button) => button.addEventListener('click', () => {
    document.querySelectorAll('.filter-chip').forEach((chip) => chip.classList.toggle('selected', chip === button));
    loadContents(1);
  }));
  document.getElementById('load-more')?.addEventListener('click', (event) => loadContents(Number(event.currentTarget.dataset.page || 1) + 1, true));

  async function startTask(taskId, contentId, card, taskType) {
    const result = await api(`/api/tasks/${taskId}/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contentId ? { contentId } : {})
    });
    card.dataset.started = 'true';
    card.dataset.taskType = taskType;
    const button = card.querySelector('[data-task-action]');
    if (button) button.textContent = 'Submit for review';
    if (result.taskLink) {
      const target = window.open('about:blank', '_blank');
      if (target) {
        target.opener = null;
        target.location = result.taskLink;
      } else {
        window.location.assign(result.taskLink);
      }
    }
    notify('Task started. Return here when you are done.');
  }

  async function submitTask(card) {
    const taskId = card.dataset.taskId;
    const contentId = card.dataset.contentId;
    const code = card.querySelector('[data-code]')?.value || '';
    const result = await api(`/api/tasks/${taskId}/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, ...(contentId ? { contentId } : {}) })
    });
    notify(result.message || 'Submitted for review.');
    const button = card.querySelector('[data-task-action]');
    if (button) {
      button.disabled = true;
      button.textContent = 'Pending review';
    }
  }

  function attachTaskCard(card) {
    const button = card.querySelector('[data-task-action]');
    if (!button) return;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        if (card.dataset.started === 'true') await submitTask(card);
        else await startTask(card.dataset.taskId, card.dataset.contentId, card, card.dataset.taskType);
      } catch (error) {
        notify(error.message, 'error');
      } finally {
        button.disabled = false;
      }
    });
  }

  async function loadTasks() {
    const list = document.getElementById('task-list');
    if (!list) return;
    try {
      const result = await api('/api/tasks');
      const todayCount = result.dailyCount || 0;
      const dailyCount = document.getElementById('daily-count');
      if (dailyCount) dailyCount.textContent = `${todayCount}/${result.dailyLimit}`;
      const dailyButton = document.querySelector('[data-video-task]');
      const dailyTask = result.tasks.find((task) => task.type === 'daily-video');
      const rewardLabel = document.getElementById('daily-reward');
      if (dailyTask && rewardLabel) rewardLabel.textContent = `Get ৳${Number(dailyTask.reward).toFixed(2)} per full completion`;
      if (dailyButton) {
        if (!dailyTask) dailyButton.disabled = true;
        else {
          const status = dailyTask.completion?.status;
          if (status === 'completed' || status === 'pending') {
            dailyButton.disabled = true;
            dailyButton.textContent = status === 'completed' ? 'Completed today' : 'Pending review';
          } else {
            dailyButton.dataset.started = String(status === 'started');
            dailyButton.addEventListener('click', async () => {
              dailyButton.disabled = true;
              try {
                if (dailyButton.dataset.started === 'true') {
                  const data = await api(`/api/tasks/${dailyTask._id}/verify`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
                  });
                  notify(data.message);
                  dailyButton.textContent = 'Pending review';
                } else {
                  await startTask(dailyTask._id, null, dailyButton.parentElement, dailyTask.type);
                  dailyButton.dataset.started = 'true';
                  dailyButton.textContent = 'Submit for review';
                }
              } catch (error) {
                notify(error.message, 'error');
              } finally {
                if (dailyButton.textContent !== 'Pending review') dailyButton.disabled = false;
              }
            });
            if (status === 'started') dailyButton.textContent = 'Submit for review';
          }
        }
      }
      const available = result.tasks.filter((task) => task.type !== 'daily-video');
      if (!available.length) {
        list.innerHTML = '<div class="empty-state card"><i class="fa-solid fa-layer-group" aria-hidden="true"></i><h3>No partner tasks yet</h3><p>New earning opportunities will appear here.</p></div>';
        return;
      }
      list.replaceChildren();
      available.forEach((task) => {
        const card = document.createElement('article');
        card.className = 'task-card';
        card.dataset.taskId = task._id;
        card.dataset.taskType = task.type;
        const logo = task.imageUrl ? `<img src="${escapeHtml(task.imageUrl)}" alt="">` : `<i class="fa-solid ${task.type === 'verification' ? 'fa-shield-halved' : 'fa-bullseye'}" aria-hidden="true"></i>`;
        const code = task.type === 'verification' ? '<label class="inline-code">Verification code<input data-code type="text" maxlength="100" placeholder="Enter code"></label>' : '';
        const status = task.completion?.status;
        const action = status === 'completed' ? '<span class="status-pill success">Completed</span>' : status === 'pending' ? '<span class="status-pill">Pending review</span>' : '<button class="button button-small button-primary" data-task-action>Start Task</button>';
        card.innerHTML = `<span class="task-logo">${logo}</span><div class="task-copy"><strong>${escapeHtml(task.title)}</strong><small class="text-success">Reward ৳${Number(task.reward).toFixed(2)}</small>${code}</div><div class="task-action">${action}</div>`;
        if (status === 'started') card.dataset.started = 'true';
        attachTaskCard(card);
        list.append(card);
      });
    } catch (error) {
      list.innerHTML = `<div class="empty-state card"><p>${escapeHtml(error.message)}</p></div>`;
    }
  }
  loadTasks();
  document.querySelectorAll('.task-card[data-task-action]').forEach(attachTaskCard);

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-share]');
    if (!button) return;
    const shareData = { title: button.dataset.share, url: button.dataset.url };
    try {
      if (navigator.share) await navigator.share(shareData);
      else {
        await navigator.clipboard.writeText(shareData.url);
        notify('Link copied to clipboard.');
      }
    } catch (error) {
      if (error.name !== 'AbortError') notify('Unable to share this link.', 'error');
    }
  });

  document.querySelectorAll('[data-copy]').forEach((button) => button.addEventListener('click', async () => {
    const input = document.querySelector(button.dataset.copy);
    if (!input) return;
    try { await navigator.clipboard.writeText(input.value); notify('Referral link copied.'); }
    catch { input.select(); document.execCommand('copy'); notify('Referral link copied.'); }
  }));

  document.querySelectorAll('[data-claim]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const result = await api(`/api/referral/claim/${button.dataset.claim}`, { method: 'POST' });
      notify(`৳${Number(result.reward).toFixed(2)} added to your balance.`);
      location.reload();
    } catch (error) { notify(error.message, 'error'); button.disabled = false; }
  }));

  document.getElementById('withdraw-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const message = form.querySelector('.form-message');
    button.disabled = true;
    message.textContent = '';
    try {
      const formData = new FormData(form);
      const result = await api('/api/withdrawals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(formData.entries()))
      });

      document.getElementById('withdrawal-load-more')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        const historyList = document.getElementById('withdrawal-history');
        const page = Number(historyList.dataset.page || 1) + 1;
        button.disabled = true;
        try {
          const result = await api(`/api/withdrawals?page=${page}`);
          result.withdrawals.forEach((item) => {
            const row = document.createElement('div');
            row.className = 'history-row';
            const note = item.adminNote ? `<small>Note: ${escapeHtml(item.adminNote)}</small>` : '';
            const statusClass = item.status === 'approved' ? 'success' : item.status === 'rejected' ? 'danger' : '';
            row.innerHTML = `<div><strong>৳${Number(item.amount).toFixed(2)}</strong><small>${escapeHtml(item.paymentMethod)} · ${escapeHtml(item.walletNumber)}</small>${note}</div><span class="status-pill ${statusClass}">${escapeHtml(item.status)}</span>`;
            historyList.append(row);
          });
          historyList.dataset.page = String(page);
          if (!result.hasMore) button.remove();
          else button.disabled = false;
        } catch (error) {
          notify(error.message, 'error');
          button.disabled = false;
        }
      });
      message.textContent = result.message;
      message.classList.add('text-success');
      form.reset();
      setTimeout(() => location.reload(), 1000);
    } catch (error) {
      message.textContent = error.message;
      message.classList.remove('text-success');
    } finally { button.disabled = false; }
  });

  const modal = document.getElementById('confirm-modal');
  document.querySelectorAll('.confirm-action').forEach((button) => button.addEventListener('click', (event) => {
    if (!modal || !button.dataset.confirm || !modal.showModal) return;
    event.preventDefault();
    document.getElementById('modal-message').textContent = button.dataset.confirm;
    modal.showModal();
    document.getElementById('modal-confirm').onclick = () => {
      modal.close();
      button.closest('form')?.requestSubmit(button);
    };
  }));

  window.appNotify = notify;
})();
