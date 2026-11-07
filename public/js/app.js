(() => {
  const tg = window.Telegram?.WebApp;
  let currentUrl = location.href;
  const analyticsSessionId = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((value) => value.toString(16).padStart(2, '0')).join('');
  let analyticsQueue = Promise.resolve();
  let analyticsPath = null;
  let analyticsSegmentStartedAt = null;
  let analyticsOpened = false;

  function sendAnalyticsEvent(type, path, durationSeconds = 0) {
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
    const pathname = new URL(path, location.origin).pathname;
    analyticsQueue = analyticsQueue.then(() => fetch('/api/analytics/event', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ sessionId: analyticsSessionId, type, path: pathname, durationSeconds })
    })).then((response) => {
      if (!response.ok) console.error(`Analytics event failed (${response.status}).`);
    }).catch((error) => console.error('Unable to record analytics event:', error));
  }

  function flushAnalyticsPage(endPage = false) {
    if (analyticsPath && analyticsSegmentStartedAt !== null) {
      const durationSeconds = Math.floor((Date.now() - analyticsSegmentStartedAt) / 1000);
      if (durationSeconds > 0) sendAnalyticsEvent('page_time', analyticsPath, Math.min(3600, durationSeconds));
    }
    analyticsSegmentStartedAt = null;
    if (endPage) analyticsPath = null;
    else if (analyticsPath && document.visibilityState === 'visible') analyticsSegmentStartedAt = Date.now();
  }

  function startAnalyticsPage(path) {
    if (!document.querySelector('[data-user-balance]')) return;
    const normalizedPath = new URL(path, location.origin).pathname;
    if (analyticsPath !== normalizedPath) {
      flushAnalyticsPage(true);
      analyticsPath = normalizedPath;
      sendAnalyticsEvent('page_view', analyticsPath);
    }
    if (!analyticsOpened) {
      analyticsOpened = true;
      sendAnalyticsEvent('app_open', analyticsPath);
    }
    if (document.visibilityState === 'visible') analyticsSegmentStartedAt = Date.now();
    if (!window.__linkHubAnalyticsTimer) {
      window.__linkHubAnalyticsTimer = setInterval(() => flushAnalyticsPage(), 30000);
    }
  }

  function initializePage() {
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
  window.__linkHubContentObserver?.disconnect();
  clearInterval(window.__linkHubRewardTimer);
  clearInterval(window.__linkHubPresenceTimer);
  clearInterval(window.__linkHubUnlockCountdown);
  clearTimeout(window.__linkHubUnlockTimer);
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
  if (!window.__linkHubThemeBound) {
    window.__linkHubThemeBound = true;
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
    tg?.onEvent?.('themeChanged', applyTheme);
    tg?.BackButton?.onClick(() => history.back());
  }
  if (tg) {
    tg.ready();
    tg.expand();
    tg.enableClosingConfirmation?.();
    if (document.body.dataset.page?.startsWith('/content/')) {
      tg.BackButton?.show();
    } else {
      tg.BackButton?.hide();
    }
  }

  startAnalyticsPage(document.body.dataset.page || location.pathname);
  window.__linkHubPresenceHeartbeat = async () => {
    if (!document.querySelector('[data-user-balance]') || document.visibilityState === 'hidden') return;
    try {
      const response = await fetch('/api/user/presence', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': csrfToken }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Presence update failed (${response.status}).`);
    } catch (error) {
      console.error(error.message);
    }
  };
  if (!window.__linkHubPresenceVisibilityBound) {
    window.__linkHubPresenceVisibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        window.__linkHubPresenceHeartbeat?.();
        if (analyticsPath) analyticsSegmentStartedAt = Date.now();
      } else {
        flushAnalyticsPage();
      }
    });
    window.addEventListener('pagehide', () => flushAnalyticsPage(true));
  }
  if (document.querySelector('[data-user-balance]')) {
    window.__linkHubPresenceHeartbeat();
    window.__linkHubPresenceTimer = setInterval(() => window.__linkHubPresenceHeartbeat(), 60000);
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
      await window.linkHubNavigate(result.redirect || '/', { replace: true });
    } catch (error) {
      if (status) status.textContent = `Telegram sign-in failed: ${error.message}`;
      notify(error.message, 'error');
    }
  }
  if (document.querySelector('[data-auth-status]')) authenticate();

  let contentPage = 1;
  let contentHasMore = false;
  let contentLoading = false;
  async function loadContents(page = 1, append = false) {
    const list = document.getElementById('content-list');
    if (!list || contentLoading || append && !contentHasMore) return;
    const search = document.getElementById('search-input')?.value || '';
    const sort = document.querySelector('.filter-chip.selected')?.dataset.sort || 'latest';
    contentLoading = true;
    try {
      const params = new URLSearchParams({ q: search, sort, page: String(page) });
      const result = await api(`/api/contents?${params}`);
      if (!append) list.replaceChildren();
      const fragment = document.createDocumentFragment();
      result.contents.forEach((content) => {
        const card = document.createElement('article');
        card.className = `content-card${unlocked ? ' is-unlocked' : ''}`;
        const image = content.imageUrl
          ? `<img src="${escapeHtml(content.imageUrl)}" alt="" loading="lazy">`
          : '<span class="image-placeholder"><i class="fa-solid fa-video" aria-hidden="true"></i></span>';
        const date = new Date(content.date).toLocaleDateString();
        const unlocked = Boolean(content.isUnlocked);
        const completed = Number(content.taskProgress?.completed || 0);
        const total = Number(content.taskProgress?.total ?? 5);
        const unlockExpiresAt = unlocked && content.taskProgress?.unlockExpiresAt
          ? new Date(content.taskProgress.unlockExpiresAt).getTime() : 0;
        if (unlockExpiresAt) card.dataset.unlockExpiresAt = String(unlockExpiresAt);
        card.dataset.navigationHref = `/content/${encodeURIComponent(content._id)}`;
        card.setAttribute('role', 'link');
        card.tabIndex = 0;
        card.innerHTML = `<a class="content-image" href="/content/${encodeURIComponent(content._id)}">${image}<span class="lock-badge${unlocked ? ' unlocked' : ''}"><i class="fa-solid ${unlocked ? 'fa-lock-open' : 'fa-lock'}" aria-hidden="true"></i> ${unlocked ? 'Unlocked' : 'Locked'}</span></a>
            <div class="content-card-body"><div class="content-meta"><span><i class="fa-regular fa-calendar" aria-hidden="true"></i> ${escapeHtml(date)}</span><span><i class="fa-solid fa-eye" aria-hidden="true"></i> ${Number(content.totalViews || 0).toLocaleString()}</span></div>
            <h3><a href="/content/${encodeURIComponent(content._id)}">${escapeHtml(content.title)}</a></h3><div class="content-card-footer"><span class="task-count"><i class="fa-solid fa-layer-group" aria-hidden="true"></i> Tasks (${completed}/${total})</span><div class="card-actions"><button class="icon-button" data-share="${escapeHtml(content.title)}" data-url="${escapeHtml(location.origin + '/content/' + content._id)}" aria-label="Share ${escapeHtml(content.title)}"><i class="fa-solid fa-share-nodes" aria-hidden="true"></i></button></div></div></div>`;
        fragment.append(card);
      });
      if (!append && result.contents.length === 0) {
        list.innerHTML = '<div class="empty-state"><i class="fa-solid fa-video" aria-hidden="true"></i><h3>No matching links</h3><p>Try a different search or filter.</p></div>';
      } else list.append(fragment);
      contentPage = result.page;
      contentHasMore = result.hasMore;
      list.dataset.page = String(contentPage);
      list.dataset.hasMore = String(contentHasMore);
      scheduleHomeUnlockExpiry();
      const sentinel = document.getElementById('content-scroll-sentinel');
      if (sentinel) sentinel.textContent = contentHasMore ? 'Loading more links as you scroll…' : 'You have reached the end.';
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      contentLoading = false;
    }
  }

  const contentList = document.getElementById('content-list');
  if (contentList) {
    contentPage = Number(contentList.dataset.page || 1);
    contentHasMore = contentList.dataset.hasMore === 'true';
    const sentinel = document.getElementById('content-scroll-sentinel');
    if (sentinel && 'IntersectionObserver' in window) {
      window.__linkHubContentObserver?.disconnect();
      window.__linkHubContentObserver = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting) && contentHasMore && !contentLoading) {
          loadContents(contentPage + 1, true);
        }
      }, { rootMargin: '400px' });
      window.__linkHubContentObserver.observe(sentinel);
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
  document.getElementById('load-more')?.addEventListener('click', () => loadContents(contentPage + 1, true));

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
      } else if (tg?.openLink) {
        tg.openLink(result.taskLink);
      } else {
        window.open(result.taskLink, '_blank', 'noopener,noreferrer');
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

  function attachContentTaskCards() {
    document.querySelectorAll('.content-task-card:not([data-bound])').forEach((card) => {
      card.dataset.bound = 'true';
      const button = card.querySelector('[data-content-task-action]');
      if (!button) return;
      button.addEventListener('click', async () => {
        button.disabled = true;
        let taskWindow;
        try {
          if (card.dataset.started !== 'true') {
            taskWindow = window.open('about:blank', '_blank');
            if (taskWindow) taskWindow.opener = null;
            const result = await api(`/api/contents/${card.dataset.contentId}/tasks/${card.dataset.taskSlot}/start`, { method: 'POST' });
            card.dataset.started = 'true';
            button.classList.remove('button-primary');
            button.classList.add('button-success');
            button.innerHTML = '<i class="fa-solid fa-circle-check" aria-hidden="true"></i> Claim Task';
            card.querySelector('.task-copy small').textContent = 'Return here and claim this task.';
            const taskLink = result.taskLink || card.dataset.taskLink;
            if (!taskLink) throw new Error('This task does not have a destination link.');
            if (taskWindow) taskWindow.location = taskLink;
            else if (tg?.openLink) tg.openLink(taskLink);
            else window.open(taskLink, '_blank', 'noopener,noreferrer');
            notify('Task started. Return here and claim it when you are done.');
          } else {
            const result = await api(`/api/contents/${card.dataset.contentId}/tasks/${card.dataset.taskSlot}/claim`, { method: 'POST' });
            card.dataset.started = 'false';
            card.querySelector('.task-action').innerHTML = '<span class="status-pill success"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Completed</span>';
            card.querySelector('.task-logo i')?.classList.replace('fa-bullseye', 'fa-circle-check');
            card.querySelector('.task-copy small').textContent = 'Task completed.';
            const progress = document.querySelector('[data-content-progress]');
            if (progress) {
              progress.innerHTML = `<i class="fa-solid ${result.completed === result.total ? 'fa-lock-open' : 'fa-lock'}" aria-hidden="true"></i> ${result.completed}/${result.total} completed`;
              progress.classList.toggle('success', result.completed === result.total);
            }
            if (result.completed === result.total) {
              const unlocked = document.querySelector('[data-unlocked-content]');
              const videoLink = unlocked?.querySelector('[data-watch-video]');
              if (videoLink && result.videoUrl) {
                videoLink.href = result.videoUrl;
                videoLink.hidden = false;
                unlocked.hidden = false;
                const detail = document.querySelector('.content-detail');
                if (detail && result.unlockExpiresAt) {
                  detail.dataset.unlockExpiresAt = String(new Date(result.unlockExpiresAt).getTime());
                  detail.dataset.serverNow = String(result.serverNow);
                  scheduleContentUnlockExpiry(detail);
                }
              }
              const balance = document.querySelector('[data-user-balance]');
              if (balance && result.balance !== undefined) balance.textContent = `৳${Number(result.balance).toFixed(2)}`;
              notify(`Content unlocked! ৳${Number(result.unlockReward || 50).toFixed(2)} added to your balance.`);
            } else notify('Task completed.');
          }
        } catch (error) {
          taskWindow?.close();
          notify(error.message, 'error');
        } finally {
          if (button.isConnected) button.disabled = false;
        }
      });
    });
  }

  function scheduleContentUnlockExpiry(detail) {
    const expiresAt = Number(detail.dataset.unlockExpiresAt || 0);
    const serverNow = Number(detail.dataset.serverNow || Date.now());
    const remaining = Math.max(0, expiresAt - serverNow);
    const startedAt = performance.now();
    const countdown = detail.querySelector('[data-unlock-countdown]');
    if (countdown && remaining > 0) {
      const updateCountdown = () => {
        const seconds = Math.max(0, Math.ceil((remaining - (performance.now() - startedAt)) / 1000));
        const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
        const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
        const remainder = String(seconds % 60).padStart(2, '0');
        countdown.textContent = `${hours}:${minutes}:${remainder}`;
        if (seconds === 0) clearInterval(window.__linkHubUnlockCountdown);
      };
      updateCountdown();
      window.__linkHubUnlockCountdown = setInterval(updateCountdown, 1000);
    }
    if (remaining > 0) {
      window.__linkHubUnlockTimer = setTimeout(() => {
        window.linkHubNavigate(location.href, { replace: true });
      }, remaining);
    }
  }

  function scheduleHomeUnlockExpiry() {
    clearTimeout(window.__linkHubUnlockTimer);
    const expirations = [...document.querySelectorAll('.content-card[data-unlock-expires-at]')]
      .map((card) => Number(card.dataset.unlockExpiresAt))
      .filter((timestamp) => timestamp > Date.now());
    if (expirations.length) {
      window.__linkHubUnlockTimer = setTimeout(() => {
        window.linkHubNavigate(location.href, { replace: true });
      }, Math.min(...expirations) - Date.now());
    }
  }

  const contentDetail = document.querySelector('.content-detail[data-unlock-expires-at]');
  if (contentDetail) scheduleContentUnlockExpiry(contentDetail);
  else if (document.getElementById('content-list')) scheduleHomeUnlockExpiry();

  function setRewardCountdown(button, remainingSeconds) {
    clearInterval(window.__linkHubRewardTimer);
    let remaining = Math.max(0, Number(remainingSeconds) || 0);
    const update = () => {
      button.disabled = remaining > 0;
      button.textContent = remaining > 0
        ? `Claim in 00:${String(remaining).padStart(2, '0')}`
        : 'Claim ৳20';
    };
    update();
    if (remaining > 0) {
      window.__linkHubRewardTimer = setInterval(() => {
        remaining -= 1;
        update();
        if (remaining <= 0) clearInterval(window.__linkHubRewardTimer);
      }, 1000);
    }
  }

  async function loadVideoReward() {
    const button = document.querySelector('[data-video-task]');
    if (!button) return;
    button.disabled = true;
    try {
      const state = await api('/api/video-reward/status');
      button.dataset.started = String(state.active);
      if (state.active) setRewardCountdown(button, state.remainingSeconds);
      else {
        button.textContent = 'Start Watching';
        button.disabled = false;
      }
      if (!button.dataset.bound) {
        button.dataset.bound = 'true';
        button.addEventListener('click', async () => {
          button.disabled = true;
          let taskWindow;
          try {
            if (button.dataset.started === 'true') {
              const result = await api('/api/video-reward/claim', { method: 'POST' });
              button.dataset.started = 'false';
              button.textContent = 'Start Watching';
              button.disabled = false;
              const balance = document.querySelector('[data-user-balance]');
              if (balance && result.balance !== undefined) balance.textContent = `৳${Number(result.balance).toFixed(2)}`;
              notify(`৳${Number(result.reward).toFixed(2)} added to your balance.`);
            } else {
              taskWindow = window.open('about:blank', '_blank');
              if (taskWindow) taskWindow.opener = null;
              const result = await api('/api/video-reward/start', { method: 'POST' });
              button.dataset.started = 'true';
              setRewardCountdown(button, result.remainingSeconds);
              if (taskWindow) taskWindow.location = result.taskLink;
              else if (tg?.openLink) tg.openLink(result.taskLink);
              else window.open(result.taskLink, '_blank', 'noopener,noreferrer');
              notify('Video started. Return after one minute to claim ৳20.');
            }
          } catch (error) {
            taskWindow?.close();
            notify(error.message, 'error');
            if (button.dataset.started === 'true') {
              button.disabled = false;
              button.textContent = 'Claim ৳20';
            } else button.disabled = false;
          }
        });
      }
    } catch (error) {
      notify(error.message, 'error');
      button.disabled = false;
    }
  }

  async function loadTasks() {
    const list = document.getElementById('task-list');
    if (!list) return;
    try {
      const result = await api('/api/tasks');
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
        const action = status === 'completed' ? '<span class="status-pill success"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Completed</span>' : status === 'pending' ? '<span class="status-pill">Pending review</span>' : '<button class="button button-small button-primary" data-task-action><i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> Start Task</button>';
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
  loadVideoReward();
  document.querySelectorAll('.task-card[data-task-action]').forEach(attachTaskCard);

  if (!window.__linkHubShareBound) {
    window.__linkHubShareBound = true;
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
  }

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
      await window.linkHubNavigate(location.href, { replace: true });
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
      setTimeout(() => window.linkHubNavigate(location.href, { replace: true }), 1000);
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
  attachContentTaskCards();
  }

  window.initializeLinkHubPage = initializePage;
  initializePage();

  async function navigate(url, { replace = false, popstate = false } = {}) {
    let target = new URL(url, location.href);
    if (target.origin !== location.origin || target.pathname.startsWith('/admin')) {
      location.assign(target.href);
      return;
    }
    try {
      const response = await fetch(target.href, {
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'LinkHub-SPA' }
      });
      if (!response.ok) throw new Error(`Page request failed (${response.status}).`);
      if (response.redirected) target = new URL(response.url);
      const markup = await response.text();
      const page = new DOMParser().parseFromString(markup, 'text/html');
      const nextShell = page.querySelector('.app-shell');
      const currentShell = document.querySelector('.app-shell');
      if (!nextShell || !currentShell) {
        throw new Error('This page is not available in the LinkHub app.');
      }
      flushAnalyticsPage(true);
      currentShell.innerHTML = nextShell.innerHTML;
      document.title = page.title;
      document.body.dataset.page = page.body.dataset.page || target.pathname;
      const nextCsrf = page.querySelector('meta[name="csrf-token"]')?.content;
      const currentCsrf = document.querySelector('meta[name="csrf-token"]');
      if (nextCsrf && currentCsrf) currentCsrf.content = nextCsrf;
      if (!popstate) {
        if (replace) history.replaceState({ linkHub: true }, '', target.href);
        else history.pushState({ linkHub: true }, '', target.href);
      }
      currentUrl = target.href;
      window.initializeLinkHubPage();
      window.scrollTo(0, 0);
    } catch (error) {
      window.appNotify?.(error.message, 'error');
      if (popstate) history.pushState({ linkHub: true }, '', currentUrl);
    }
  }

  window.linkHubNavigate = navigate;
  history.replaceState({ linkHub: true }, '', location.href);
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.target.closest('a[href]');
    const card = event.target.closest('[data-navigation-href]');
    if (!anchor && card && event.target.closest('button, input, select, textarea')) return;
    const rawHref = anchor?.href || card?.dataset.navigationHref;
    if (!rawHref || anchor?.target && anchor.target !== '_self' || anchor?.hasAttribute('download')) return;
    const target = new URL(rawHref, location.href);
    if (target.origin !== location.origin || target.pathname.startsWith('/admin')) return;
    event.preventDefault();
    navigate(target.href);
  });
  document.addEventListener('keydown', (event) => {
    const card = event.target.closest('[data-navigation-href]');
    if (!card || event.target !== card || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    navigate(card.dataset.navigationHref);
  });
  window.addEventListener('popstate', () => navigate(location.href, { popstate: true }));
})();
