(() => {
  const notify = window.appNotify || (() => {});
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
