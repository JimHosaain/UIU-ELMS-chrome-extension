const DEFAULT_SETTINGS = {
  baseUrl: '',
  checkIntervalMinutes: 15,
  notificationsEnabled: true,
  themeMode: 'system'
};

const STORAGE_KEYS = {
  settings: 'elmsSettings',
  latestUpdates: 'elmsLatestUpdates',
  status: 'elmsStatus'
};

const elements = {
  statusBadge: document.getElementById('statusBadge'),
  statusText: document.getElementById('statusText'),
  lastCheckedText: document.getElementById('lastCheckedText'),
  updatesList: document.getElementById('updatesList'),
  intervalSelect: document.getElementById('intervalSelect'),
  notificationsToggle: document.getElementById('notificationsToggle'),
  themeSelect: document.getElementById('themeSelect'),
  checkNowButton: document.getElementById('checkNowButton'),
  grantPermissionButton: document.getElementById('grantPermissionButton'),
  saveQuickSettingsButton: document.getElementById('saveQuickSettingsButton'),
  emailUpdatesButton: document.getElementById('emailUpdatesButton'),
  errorText: document.getElementById('errorText')
};

const systemThemeMatcher = window.matchMedia('(prefers-color-scheme: dark)');

initializePopup();

elements.checkNowButton.addEventListener('click', handleCheckNow);
elements.grantPermissionButton.addEventListener('click', handleGrantPermission);
elements.saveQuickSettingsButton.addEventListener('click', handleSaveQuickSettings);

if (elements.emailUpdatesButton) {
  elements.emailUpdatesButton.addEventListener('click', handleEmailUpdates);
}

elements.themeSelect.addEventListener('change', async () => {
  applyTheme(elements.themeSelect.value);
  await handleSaveQuickSettings();
});

systemThemeMatcher.addEventListener('change', () => {
  applyTheme(elements.themeSelect.value);
});

async function initializePopup() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.settings, STORAGE_KEYS.latestUpdates, STORAGE_KEYS.status]);
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(data[STORAGE_KEYS.settings] || {})
  };

  elements.intervalSelect.value = String(settings.checkIntervalMinutes);
  elements.notificationsToggle.checked = Boolean(settings.notificationsEnabled);
  elements.themeSelect.value = normalizeThemeMode(settings);
  applyTheme(elements.themeSelect.value);

  await refreshPopupState();
}

async function handleCheckNow() {
  setError('');
  elements.checkNowButton.disabled = true;
  elements.checkNowButton.textContent = 'Checking...';

  try {
    const permissionGranted = await requestElmsPermissionFromPopup();

    if (!permissionGranted) {
      setError('ELMS permission is required before checking.');
      return;
    }

    await refreshBackground();

    const response = await chrome.runtime.sendMessage({ type: 'ELMS_CHECK_NOW' });

    if (!response?.ok) {
      setError(response?.error || 'Unable to check ELMS right now.');
    }

    await refreshPopupState();
  } catch (error) {
    setError(error.message || 'Unable to contact the background service worker.');
  } finally {
    elements.checkNowButton.disabled = false;
    elements.checkNowButton.textContent = 'Check Now';
  }
}

async function handleGrantPermission() {
  setError('');

  const granted = await requestElmsPermissionFromPopup();

  if (!granted) {
    setError('ELMS permission was not granted.');
    return;
  }

  await refreshBackground();
  await refreshPopupState();
  setError('');
}

async function handleSaveQuickSettings() {
  setError('');

  const currentSettings = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const nextSettings = {
    ...DEFAULT_SETTINGS,
    ...(currentSettings[STORAGE_KEYS.settings] || {}),
    checkIntervalMinutes: Number(elements.intervalSelect.value),
    notificationsEnabled: elements.notificationsToggle.checked,
    themeMode: elements.themeSelect.value
  };

  await chrome.storage.local.set({
    [STORAGE_KEYS.settings]: nextSettings
  });

  applyTheme(nextSettings.themeMode);
  await refreshBackground();
  await refreshPopupState();
}

async function handleEmailUpdates() {
  const data = await chrome.storage.local.get([STORAGE_KEYS.latestUpdates, STORAGE_KEYS.settings]);
  const latestUpdates = data[STORAGE_KEYS.latestUpdates] || [];
  const studentEmail = (data[STORAGE_KEYS.settings] || {}).studentEmail || '';

  if (!latestUpdates.length) {
    setError('No updates to email yet.');
    return;
  }

  if (!studentEmail) {
    setError('Add a student email in Options first.');
    return;
  }

  const emailBody = formatEmailBody(latestUpdates);
  const subject = encodeURIComponent('ELMS Updates');
  const body = encodeURIComponent(emailBody);

  window.location.href = `mailto:${encodeURIComponent(studentEmail)}?subject=${subject}&body=${body}`;
}

async function refreshPopupState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'ELMS_GET_STATE' });

    if (response?.ok) {
      renderState(response.status || {}, response.latestUpdates || []);
      return;
    }
  } catch {
    // Fall back to storage if the service worker is asleep.
  }

  const data = await chrome.storage.local.get([STORAGE_KEYS.settings, STORAGE_KEYS.latestUpdates, STORAGE_KEYS.status]);
  renderState(data[STORAGE_KEYS.status] || {}, data[STORAGE_KEYS.latestUpdates] || []);
}

function renderState(status, latestUpdates) {
  const active = Boolean(status.active);

  elements.statusBadge.textContent = active ? 'Active' : 'Inactive';
  elements.statusBadge.className = active ? 'status-badge status-active' : 'status-badge status-inactive';
  elements.statusText.textContent = status.lastMessage || 'Waiting for settings.';
  elements.lastCheckedText.textContent = status.lastChecked
    ? `Last checked: ${new Date(status.lastChecked).toLocaleString()}`
    : 'Last checked: never';

  renderLatestUpdates(latestUpdates);

  if (status.lastError) {
    setError(status.lastError);
  }
}

function renderLatestUpdates(latestUpdates) {
  elements.updatesList.innerHTML = '';

  if (!latestUpdates.length) {
    const emptyItem = document.createElement('li');
    emptyItem.className = 'updates-empty';
    emptyItem.textContent = 'No detected updates yet.';
    elements.updatesList.appendChild(emptyItem);
    return;
  }

  for (const item of latestUpdates.slice(0, 5)) {
    const listItem = document.createElement('li');
    listItem.className = 'update-item';

    const title = document.createElement('strong');
    title.textContent = `${item.courseName || 'Unknown course'} - ${item.title || 'Untitled update'}`;

    const meta = document.createElement('p');
    meta.className = 'update-meta';
    meta.textContent = `${capitalize(item.kind)}${item.timestamp ? ` • ${new Date(item.timestamp).toLocaleString()}` : ''}`;

    listItem.appendChild(title);
    listItem.appendChild(meta);
    elements.updatesList.appendChild(listItem);
  }
}

function setError(message) {
  if (!message) {
    elements.errorText.hidden = true;
    elements.errorText.textContent = '';
    return;
  }

  elements.errorText.hidden = false;
  elements.errorText.textContent = message;
}

async function requestElmsPermissionFromPopup() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const baseUrl = (data[STORAGE_KEYS.settings] || {}).baseUrl || '';

  if (!baseUrl) {
    setError('Set the ELMS base URL in Options first.');
    return false;
  }

  try {
    const originPattern = new URL(baseUrl).origin + '/*';
    return await chrome.permissions.request({
      origins: [originPattern]
    });
  } catch {
    setError('The saved ELMS base URL is invalid. Update it in Options.');
    return false;
  }
}

async function refreshBackground() {
  try {
    await chrome.runtime.sendMessage({ type: 'ELMS_REFRESH_SETTINGS' });
  } catch {
    // The background service worker may be asleep.
  }
}

function formatEmailBody(updates) {
  const latest = updates[0] || {};
  const courseName = latest.courseName || 'Unknown course';
  const title = latest.title || 'Untitled update';
  const type = capitalize(latest.kind);
  const time = latest.timestamp ? new Date(latest.timestamp).toLocaleString() : '';

  return [
    'Hey buddy,',
    '',
    `You got an update from ${courseName}.`,
    `Your teacher submitted: ${title}`,
    type ? `Update type: ${type}` : '',
    time ? `Time: ${time}` : '',
    '',
    'Detected and saved locally by ELMS Notification Helper extension.'
  ].filter(Boolean).join('\n');
}

function capitalize(value) {
  if (!value) {
    return 'Update';
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function applyTheme(themeMode) {
  const resolvedTheme = themeMode === 'system'
    ? (systemThemeMatcher.matches ? 'dark' : 'light')
    : themeMode;

  document.body.dataset.theme = resolvedTheme === 'dark' ? 'dark' : 'light';
}

function normalizeThemeMode(settings) {
  if (settings.themeMode === 'light' || settings.themeMode === 'dark' || settings.themeMode === 'system') {
    return settings.themeMode;
  }

  if (typeof settings.darkMode === 'boolean') {
    return settings.darkMode ? 'dark' : 'light';
  }

  return 'system';
}