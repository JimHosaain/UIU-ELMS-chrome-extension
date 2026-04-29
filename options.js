const DEFAULT_SETTINGS = {
  baseUrl: '',
  checkIntervalMinutes: 15,
  notificationsEnabled: true,
  themeMode: 'system'
};

const STORAGE_KEYS = {
  settings: 'elmsSettings'
};

const elements = {
  baseUrlInput: document.getElementById('baseUrlInput'),
  intervalSelect: document.getElementById('intervalSelect'),
  notificationsToggle: document.getElementById('notificationsToggle'),
  themeSelect: document.getElementById('themeSelect'),
  saveButton: document.getElementById('saveButton'),
  testButton: document.getElementById('testButton'),
  statusText: document.getElementById('statusText'),
  errorText: document.getElementById('errorText')
};
const systemThemeMatcher = window.matchMedia('(prefers-color-scheme: dark)');
initializeOptions();

elements.saveButton.addEventListener('click', handleSave);
elements.testButton.addEventListener('click', handleTest);
elements.themeSelect.addEventListener('change', async () => {
  applyTheme(elements.themeSelect.value);
  await handleSave();
});

async function initializeOptions() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(stored[STORAGE_KEYS.settings] || {})
  };

  elements.baseUrlInput.value = settings.baseUrl;
  elements.intervalSelect.value = String(settings.checkIntervalMinutes);
  elements.notificationsToggle.checked = Boolean(settings.notificationsEnabled);
  elements.themeSelect.value = normalizeThemeMode(settings);
  applyTheme(elements.themeSelect.value);
  setStatus('Settings loaded.');
}

async function handleSave() {
  setError('');

  const baseUrl = elements.baseUrlInput.value.trim();

  if (baseUrl) {
    try {
      new URL(baseUrl);
    } catch {
      setError('Please enter a valid ELMS base URL starting with http:// or https://.');
      return;
    }
  }

  const nextSettings = {
    baseUrl,
    checkIntervalMinutes: Number(elements.intervalSelect.value),
    notificationsEnabled: elements.notificationsToggle.checked,
    themeMode: elements.themeSelect.value
  };

  await chrome.storage.local.set({
    [STORAGE_KEYS.settings]: nextSettings
  });

  applyTheme(nextSettings.themeMode);

  const permissionGranted = await requestElmsPermission(baseUrl);

  if (!permissionGranted && baseUrl) {
    setError('Settings saved, but ELMS permission was not granted. Use Test Now or save again to try again.');
    setStatus('Saved locally, waiting for permission.');
    await refreshBackground();
    return;
  }

  await refreshBackground();

  setStatus('Settings saved locally.');
}

async function handleTest() {
  setError('');

  const baseUrl = elements.baseUrlInput.value.trim();
  const permissionGranted = await requestElmsPermission(baseUrl);

  if (!permissionGranted && baseUrl) {
    setError('ELMS permission is required to test the page.');
    setStatus('Check failed.');
    return;
  }

  await refreshBackground();
  setStatus('Checking ELMS now...');

  try {
    const response = await chrome.runtime.sendMessage({ type: 'ELMS_CHECK_NOW' });

    if (!response?.ok) {
      setError(response?.error || 'Check failed.');
      setStatus('Check failed.');
      return;
    }

    setStatus(response.message || 'Check complete.');
  } catch (error) {
    setError(error.message || 'Could not contact the background service worker.');
    setStatus('Check failed.');
  }
}

function setStatus(message) {
  elements.statusText.textContent = message;
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

systemThemeMatcher.addEventListener('change', () => {
  applyTheme(elements.themeSelect.value);
});

async function requestElmsPermission(baseUrl) {
  if (!baseUrl) {
    return false;
  }

  try {
    const originPattern = new URL(baseUrl).origin + '/*';
    return chrome.permissions.request({
      origins: [originPattern]
    });
  } catch {
    setError('Please enter a valid ELMS base URL before requesting permission.');
    return false;
  }
}

async function refreshBackground() {
  try {
    await chrome.runtime.sendMessage({ type: 'ELMS_REFRESH_SETTINGS' });
  } catch {
    // The background service worker may be sleeping; the next alarm or action will wake it.
  }
}