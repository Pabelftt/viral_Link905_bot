(() => {
  const notify = window.appNotify || (() => {});
  const analyticsContainer = document.querySelector('[data-analytics-live-container]');
  const analyticsLiveStatus = document.querySelector('[data-analytics-live-status]');
  if (analyticsContainer && analyticsLiveStatus && window.EventSource) {
    const days = new URLSearchParams(location.search).get('days') || '30';
    const stream = new EventSource(`/admin/analytics/stream?days=${encodeURIComponent(days)}`);
    stream.addEventListener('analytics', (event) => {
      try {
        const update = JSON.parse(event.data);
        analyticsContainer.innerHTML = update.html;
        const updated = new Date(update.updatedAt);
        analyticsLiveStatus.textContent = `Live · updated ${updated.toLocaleTimeString()}`;
        analyticsLiveStatus.classList.remove('error');
      } catch (error) {
        console.error('Unable to apply live analytics update:', error);
        analyticsLiveStatus.textContent = 'Unable to display live analytics update.';
        analyticsLiveStatus.classList.add('error');
      }
    });
    stream.addEventListener('analytics-error', () => {
      analyticsLiveStatus.textContent = 'Live update failed; retrying…';
      analyticsLiveStatus.classList.add('error');
    });
    stream.addEventListener('error', () => {
      if (stream.readyState === EventSource.CONNECTING) {
        analyticsLiveStatus.textContent = 'Reconnecting to live analytics…';
        analyticsLiveStatus.classList.remove('error');
      } else {
        analyticsLiveStatus.textContent = 'Live analytics connection unavailable.';
        analyticsLiveStatus.classList.add('error');
      }
    });
  }
  const presencePanel = document.querySelector('[data-presence-panel]');
  if (presencePanel) {
    const activeCount = document.querySelector('[data-active-user-count]');
    const presenceList = presencePanel.querySelector('[data-presence-list]');
    const presenceStatus = presencePanel.querySelector('[data-presence-status]');
    const renderPresence = ({ activeUsers, users, serverNow }) => {
      activeCount.textContent = Number(activeUsers).toLocaleString();
      presenceList.replaceChildren();
      if (!users.length) {
        const empty = document.createElement('p');
        empty.className = 'muted';
        empty.textContent = 'No user activity in the last 24 hours.';
        presenceList.append(empty);
      } else {
        users.forEach((user) => {
          const row = document.createElement('div');
          row.className = 'admin-list-row';
          const dot = document.createElement('span');
          dot.className = `activity-dot${user.isOnline ? ' online' : ''}`;
          const copy = document.createElement('div');
          const name = document.createElement('strong');
          name.textContent = [user.firstName, user.lastName].filter(Boolean).join(' ');
          const lastActive = document.createElement('small');
          const minutesAgo = Math.max(0, Math.floor((new Date(serverNow) - new Date(user.lastActiveAt)) / 60000));
          lastActive.textContent = `${user.username ? `@${user.username} · ` : ''}${user.isOnline ? 'Active · ' : ''}${minutesAgo ? `${minutesAgo} min ago` : 'Just now'}`;
          copy.append(name, lastActive);
          row.append(dot, copy);
          presenceList.append(row);
        });
      }
      presenceStatus.textContent = 'Updated just now · Active means within 5 minutes';
    };
    const refreshPresence = async () => {
      try {
        const response = await fetch('/admin/api/presence', { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) throw new Error(`Presence refresh failed (${response.status}).`);
        renderPresence(await response.json());
      } catch {
        presenceStatus.textContent = 'Unable to refresh user activity.';
      }
    };
    window.setInterval(refreshPresence, 60000);
  }
  document.querySelectorAll('[data-select-all]').forEach((master) => master.addEventListener('change', () => {
    const table = master.closest('table');
    table?.querySelectorAll('tbody .row-select').forEach((checkbox) => { checkbox.checked = master.checked; });
  }));

  document.querySelectorAll('[data-bulk-action]').forEach((button) => button.addEventListener('click', (event) => {
    const form = button.form || button.closest('form');
    const selected = document.querySelectorAll('[form="bulk-contents-form"].row-select:checked');
    if (!selected.length) {
      event.preventDefault();
      notify('Select at least one item first.', 'error');
      return;
    }
    form?.querySelector('input[name="action"]')?.setAttribute('value', button.dataset.bulkAction);
    const action = document.querySelector('input[name="action"][form="bulk-contents-form"]');
    if (action) action.value = button.dataset.bulkAction;
    if (button.dataset.bulkAction === 'delete' && !window.confirm('Delete the selected content? This cannot be undone.')) event.preventDefault();
  }));

  const catalogPicker = document.querySelector('[data-catalog-picker]');
  const createContentForm = document.getElementById('create-content-form');
  if (catalogPicker && createContentForm) {
    const searchInput = catalogPicker.querySelector('[data-catalog-search]');
    const resultsBox = catalogPicker.querySelector('[data-catalog-results]');
    const status = catalogPicker.querySelector('[data-catalog-status]');
    const spinner = catalogPicker.querySelector('[data-catalog-spinner]');
    const preview = catalogPicker.querySelector('[data-catalog-preview]');
    const previewImage = catalogPicker.querySelector('[data-catalog-image]');
    const previewVideo = catalogPicker.querySelector('[data-catalog-video]');
    const previewTitle = catalogPicker.querySelector('[data-catalog-title]');
    const previewMeta = catalogPicker.querySelector('[data-catalog-meta]');
    const previewSource = catalogPicker.querySelector('[data-catalog-source]');
    const catalogCache = new Map();
    const CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;
    const CLIENT_CACHE_MAX_ENTRIES = 40;
    const RESULT_LIMIT = 40;
    let currentItems = [];
    let activeIndex = -1;
    let searchSequence = 0;
    let debounceTimer = 0;

    const setStatus = (message, isError = false) => {
      status.textContent = message;
      status.classList.toggle('error', isError);
    };

    const relativeTime = (value) => {
      const time = new Date(value).getTime();
      if (!Number.isFinite(time)) return '';
      const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
      if (minutes < 1) return 'updated just now';
      if (minutes < 60) return `updated ${minutes} min ago`;
      const hours = Math.round(minutes / 60);
      return `updated ${hours} hr${hours === 1 ? '' : 's'} ago`;
    };

    const itemMeta = (item) => [
      item.duration ? `Duration ${item.duration}` : '',
      `${Number(item.totalViews || 0).toLocaleString()} views`,
      Array.isArray(item.categories) && item.categories.length ? item.categories.slice(0, 3).join(', ') : ''
    ].filter(Boolean).join(' · ');

    const closeResults = () => {
      resultsBox.hidden = true;
      searchInput.setAttribute('aria-expanded', 'false');
      searchInput.removeAttribute('aria-activedescendant');
      activeIndex = -1;
    };

    const markFilled = (field) => {
      if (!field) return;
      field.classList.remove('is-autofilled');
      void field.offsetWidth;
      field.classList.add('is-autofilled');
      window.setTimeout(() => field.classList.remove('is-autofilled'), 1500);
    };

    const toDateInput = (value) => {
      const date = value ? new Date(value) : new Date();
      return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
    };

    const selectItem = (item) => {
      if (!item) return;
      const fields = createContentForm.elements;
      if (fields.title) fields.title.value = item.title || '';
      if (fields.imageUrl) fields.imageUrl.value = item.imageUrl || '';
      if (fields.videoUrl) fields.videoUrl.value = item.videoUrl || '';
      if (fields.date) fields.date.value = toDateInput(item.date);
      if (fields.totalViews) fields.totalViews.value = String(item.totalViews || 0);
      [fields.title, fields.imageUrl, fields.videoUrl, fields.date, fields.totalViews].forEach(markFilled);

      preview.hidden = false;
      previewTitle.textContent = item.title || '';
      previewMeta.textContent = itemMeta(item);
      const source = [
        item.duration ? `Duration ${item.duration}` : '',
        item.date ? new Date(item.date).toLocaleDateString() : '',
        item.routeName ? `p9x9/${item.routeName}` : ''
      ].filter(Boolean).join(' · ');
      previewSource.textContent = source;

      previewVideo.pause();
      if (item.imageUrl) {
        previewImage.src = item.imageUrl;
        previewImage.hidden = false;
      } else {
        previewImage.removeAttribute('src');
        previewImage.hidden = true;
      }
      if (item.videoUrl) {
        previewVideo.src = item.videoUrl;
        previewVideo.hidden = false;
        previewVideo.load();
      } else {
        previewVideo.removeAttribute('src');
        previewVideo.hidden = true;
        previewVideo.load();
      }

      closeResults();
      setStatus(`Loaded “${item.title}” into the form. Review it, then create the content.`);
      window.appNotify?.('Content details filled from p9x9.');
    };

    const renderResults = (data, query) => {
      currentItems = Array.isArray(data.items) ? data.items : [];
      activeIndex = -1;
      resultsBox.replaceChildren();

      if (!currentItems.length) {
        closeResults();
        setStatus(query ? `No p9x9 content matched “${query}”.` : 'No p9x9 content is available right now.');
        return;
      }

      const fragment = document.createDocumentFragment();
      currentItems.forEach((item, index) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'catalog-result';
        option.id = `p9x9-option-${index}`;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        option.title = item.title || '';

        const image = document.createElement('img');
        image.loading = 'lazy';
        image.alt = '';
        if (item.imageUrl) image.src = item.imageUrl;
        else image.hidden = true;

        const copy = document.createElement('span');
        copy.className = 'catalog-result-copy';
        const title = document.createElement('strong');
        title.textContent = item.title || '';
        const meta = document.createElement('small');
        meta.textContent = itemMeta(item);
        copy.append(title, meta);
        option.append(image, copy);
        option.addEventListener('click', () => selectItem(item));
        fragment.append(option);
      });
      resultsBox.append(fragment);
      resultsBox.hidden = false;
      searchInput.setAttribute('aria-expanded', 'true');

      const total = Number(data.total ?? currentItems.length);
      const sourceTotal = Number(data.sourceTotal ?? total);
      let summary;
      if (query) {
        summary = `${total.toLocaleString()} match${total === 1 ? '' : 'es'}`;
        if (currentItems.length < total) summary += ` · showing first ${currentItems.length}`;
      } else {
        summary = `Showing latest ${currentItems.length} of ${sourceTotal.toLocaleString()} videos`;
      }
      if (data.stale) summary += ' · cached data';
      else if (data.fetchedAt) summary += ` · ${relativeTime(data.fetchedAt)}`;
      setStatus(summary);
    };

    const loadCatalog = (query) => {
      const key = query.toLocaleLowerCase();
      const now = Date.now();
      const cached = catalogCache.get(key);
      if (cached && cached.expiresAt > now) return cached.promise;

      const entry = { expiresAt: Number.POSITIVE_INFINITY, promise: null };
      entry.promise = fetch(`/admin/api/p9x9/contents?q=${encodeURIComponent(query)}&limit=${RESULT_LIMIT}`, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' }
      }).then(async (response) => {
        const contentType = response.headers.get('content-type') || '';
        const data = contentType.includes('application/json') ? await response.json().catch(() => ({})) : {};
        if (!response.ok || !contentType.includes('application/json')) {
          throw new Error(response.redirected
            ? 'Admin session expired. Reload the page and sign in again.'
            : data.error || `Search failed (${response.status}).`);
        }
        entry.expiresAt = Date.now() + CLIENT_CACHE_TTL_MS;
        return data;
      }).catch((error) => {
        if (catalogCache.get(key) === entry) catalogCache.delete(key);
        throw error;
      });
      catalogCache.set(key, entry);
      while (catalogCache.size > CLIENT_CACHE_MAX_ENTRIES) {
        catalogCache.delete(catalogCache.keys().next().value);
      }
      return entry.promise;
    };

    const runSearch = async (query) => {
      const sequence = ++searchSequence;
      spinner.hidden = false;
      setStatus(query ? `Searching for “${query}”…` : 'Loading latest p9x9 content…');
      try {
        const data = await loadCatalog(query);
        if (sequence !== searchSequence) return;
        renderResults(data, query);
      } catch (error) {
        if (sequence !== searchSequence) return;
        currentItems = [];
        closeResults();
        setStatus(error.message || 'Unable to load p9x9 content.', true);
      } finally {
        if (sequence === searchSequence) spinner.hidden = true;
      }
    };

    searchInput.addEventListener('input', () => {
      window.clearTimeout(debounceTimer);
      const query = searchInput.value.trim();
      debounceTimer = window.setTimeout(() => runSearch(query), 250);
    });

    searchInput.addEventListener('focus', () => {
      if (resultsBox.hidden) runSearch(searchInput.value.trim());
    });

    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const options = [...resultsBox.querySelectorAll('.catalog-result')];
        if (!options.length) {
          runSearch(searchInput.value.trim());
          return;
        }
        if (resultsBox.hidden) {
          resultsBox.hidden = false;
          searchInput.setAttribute('aria-expanded', 'true');
        }
        activeIndex = event.key === 'ArrowDown'
          ? Math.min(activeIndex + 1, options.length - 1)
          : Math.max(activeIndex - 1, 0);
        options.forEach((option, index) => {
          const active = index === activeIndex;
          option.classList.toggle('is-active', active);
          option.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        searchInput.setAttribute('aria-activedescendant', options[activeIndex].id);
        options[activeIndex].scrollIntoView({ block: 'nearest' });
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (!resultsBox.hidden && activeIndex >= 0) selectItem(currentItems[activeIndex]);
        else if (!resultsBox.hidden && currentItems.length === 1) selectItem(currentItems[0]);
        else runSearch(searchInput.value.trim());
        return;
      }
      if (event.key === 'Escape') closeResults();
    });

    document.addEventListener('click', (event) => {
      if (!catalogPicker.contains(event.target)) closeResults();
    });

    window.setTimeout(() => runSearch(''), 150);
  }

  const taskForm = document.getElementById('task-form');
  if (taskForm) {
    const picker = taskForm.querySelector('.content-picker');
    const modes = taskForm.querySelectorAll('input[name="applyMode"]');
    const options = [...taskForm.querySelectorAll('.content-picker-option')];
    const count = taskForm.querySelector('[data-selection-count]');
    const updatePicker = () => {
      const selectedMode = taskForm.querySelector('input[name="applyMode"]:checked')?.value;
      picker.hidden = selectedMode !== 'selected';
      count.textContent = `${options.filter((item) => item.querySelector('input').checked).length} selected`;
    };
    modes.forEach((radio) => radio.addEventListener('change', updatePicker));
    options.forEach((option) => option.querySelector('input').addEventListener('change', updatePicker));
    taskForm.querySelector('[data-content-search]')?.addEventListener('input', (event) => {
      const query = event.target.value.toLowerCase();
      options.forEach((option) => { option.hidden = !option.textContent.toLowerCase().includes(query); });
    });
    taskForm.querySelector('[data-content-select-all]')?.addEventListener('click', () => {
      const visible = options.filter((option) => !option.hidden);
      const shouldCheck = visible.some((option) => !option.querySelector('input').checked);
      visible.forEach((option) => { option.querySelector('input').checked = shouldCheck; });
      updatePicker();
    });
    taskForm.addEventListener('submit', (event) => {
      if (taskForm.querySelector('input[name="applyMode"]:checked')?.value === 'selected'
        && !options.some((item) => item.querySelector('input').checked)) {
        event.preventDefault();
        notify('Select at least one content or choose All contents.', 'error');
      }
    });
    updatePicker();
  }

  const templates = {
    welcome: ['Welcome to LinkHub!', 'Explore viral content, complete tasks and earn rewards. Tap below to get started.', 'Open Mini App', '/'],
    viral: ['New viral link is here!', 'A new trending link just arrived. Open the Mini App to check it out.', 'View viral links', '/'],
    task: ['New earning task', 'A new task is available. Complete it to earn a reward.', 'Explore tasks', '/earn'],
    withdrawal: ['Withdrawal update', 'There is an update about your withdrawal request. Open your profile for details.', 'View profile', '/profile'],
    referral: ['Referral bonus unlocked!', 'Your referral activity earned a new bonus. Open the app to claim it.', 'View referrals', '/refer'],
    offer: ['A special offer for you', 'Check out this limited-time offer in LinkHub.', 'Open Mini App', '/'],
    maintenance: ['Scheduled maintenance', 'Some features may be unavailable briefly while we make improvements.', '', '']
  };
  const templateSelect = document.querySelector('[data-broadcast-template]');
  templateSelect?.addEventListener('change', () => {
    const preset = templates[templateSelect.value];
    if (!preset) return;
    const form = templateSelect.closest('form');
    form.elements.title.value = preset[0];
    form.elements.body.value = preset[1];
    form.elements.buttonText.value = preset[2];
    form.elements.buttonUrl.value = preset[3] ? `${location.origin}${preset[3]}` : '';
  });
  const broadcastForm = document.getElementById('broadcast-form');
  if (broadcastForm) {
    const updatePreview = () => {
      broadcastForm.querySelector('[data-preview-title]').textContent = broadcastForm.elements.title.value || 'Broadcast title';
      broadcastForm.querySelector('[data-preview-body]').textContent = broadcastForm.elements.body.value || 'Your message will be shown here.';
      const previewButton = broadcastForm.querySelector('[data-preview-button]');
      previewButton.textContent = broadcastForm.elements.buttonText.value || '';
      previewButton.hidden = !broadcastForm.elements.buttonText.value;
    };
    broadcastForm.addEventListener('input', updatePreview);
    templateSelect?.addEventListener('change', updatePreview);
    const relatedContent = broadcastForm.querySelector('[data-related-content]');
    const relatedTask = broadcastForm.querySelector('[data-related-task]');
    relatedContent?.addEventListener('change', () => {
      if (!relatedContent.value) return updatePreview();
      relatedTask.value = '';
      const option = relatedContent.selectedOptions[0];
      broadcastForm.elements.title.value = `New viral link: ${option.textContent.trim()}`;
      broadcastForm.elements.body.value = `A new viral link is available. Open it now to complete its tasks.`;
      broadcastForm.elements.buttonText.value = 'View viral link';
      broadcastForm.elements.buttonUrl.value = `${location.origin}/content/${relatedContent.value}`;
      if (option.dataset.image) broadcastForm.elements.imageUrl.value = option.dataset.image;
      updatePreview();
    });
    relatedTask?.addEventListener('change', () => {
      if (!relatedTask.value) return updatePreview();
      relatedContent.value = '';
      const option = relatedTask.selectedOptions[0];
      broadcastForm.elements.title.value = `New task: ${option.textContent.trim()}`;
      broadcastForm.elements.body.value = 'A new task is available. Open the earning page to view the details.';
      broadcastForm.elements.buttonText.value = 'Explore tasks';
      broadcastForm.elements.buttonUrl.value = `${location.origin}/earn`;
      if (option.dataset.image) broadcastForm.elements.imageUrl.value = option.dataset.image;
      updatePreview();
    });
    updatePreview();
  }

  const recipientList = document.querySelector('.recipient-list');
  if (recipientList) {
    const rows = [...recipientList.querySelectorAll('[data-recipient]')];
    const search = document.querySelector('[data-user-search]');
    const filter = document.querySelector('[data-user-filter]');
    const count = document.querySelector('[data-recipient-count]');
    const form = document.getElementById('broadcast-form');
    const mode = form.querySelector('[data-recipient-mode]');
    const excludedList = form.querySelector('[data-excluded-list]');
    const selectButton = document.querySelector('[data-recipient-select]');
    const excludedIds = () => [...excludedList.querySelectorAll('input[name="excludedRecipientIds"]')].map((input) => input.value);
    const addExcluded = (id) => {
      if (excludedIds().includes(id)) return;
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'excludedRecipientIds';
      input.value = id;
      excludedList.append(input);
    };
    const removeExcluded = (id) => excludedList.querySelectorAll('input[name="excludedRecipientIds"]').forEach((input) => {
      if (input.value === id) input.remove();
    });
    const refresh = () => {
      const query = (search.value || '').toLowerCase();
      rows.forEach((row) => {
        const searchMatches = row.dataset.name.includes(query);
        const value = filter.value;
        const filterMatches = !value
          || value === 'balance' && row.dataset.balance === 'true'
          || value === 'active' && row.dataset.active === 'true'
          || value === 'pending' && row.dataset.pending === 'true'
          || value === 'referrals' && row.dataset.referrals === 'true'
          || value === 'non-suspended' && row.dataset.suspended === 'false';
        row.hidden = !(searchMatches && filterMatches);
      });
      count.textContent = mode.value === 'filter'
        ? `All matching users${excludedIds().length ? ` · ${excludedIds().length} excluded` : ''}`
        : `${recipientList.querySelectorAll('input:checked').length} selected`;
    };
    search.addEventListener('input', refresh);
    filter.addEventListener('change', refresh);
    rows.forEach((row) => row.querySelector('input').addEventListener('change', (event) => {
      const id = event.currentTarget.value;
      if (mode.value === 'filter') {
        if (event.currentTarget.checked) removeExcluded(id);
        else addExcluded(id);
      } else {
        mode.value = 'manual';
      }
      refresh();
    }));
    selectButton?.addEventListener('click', () => {
      if (mode.value === 'filter') {
        mode.value = 'manual';
        rows.forEach((row) => { if (!row.hidden) row.querySelector('input').checked = false; });
        excludedList.replaceChildren();
        selectButton.textContent = 'Select all matching filter';
        refresh();
        return;
      }
      const visible = rows.filter((row) => !row.hidden);
      mode.value = 'filter';
      visible.forEach((row) => { if (!row.querySelector('input').disabled) row.querySelector('input').checked = true; });
      excludedList.replaceChildren();
      selectButton.textContent = 'Clear filter selection';
      refresh();
    });
    form?.addEventListener('submit', (event) => {
      const selected = recipientList.querySelectorAll('input:checked').length;
      if (!selected && mode.value !== 'filter') {
        event.preventDefault();
        notify('Select at least one recipient.', 'error');
        return;
      }
      const title = event.currentTarget.elements.title.value;
      const audience = mode.value === 'filter' ? `all eligible users matching “${filter.options[filter.selectedIndex].text}” and the current search` : `${selected} selected user${selected === 1 ? '' : 's'}`;
      if (!window.confirm(`Send “${title}” to ${audience}?`)) event.preventDefault();
    });
    refresh();
  }
})();
