const STORAGE_KEYS = {
  settings: 'elmsSettings',
  seenItems: 'elmsSeenItems',
  latestUpdates: 'elmsLatestUpdates',
  status: 'elmsStatus'
};

const DEFAULT_SETTINGS = {
  baseUrl: '',
  studentEmail: '',
  checkIntervalMinutes: 15,
  notificationsEnabled: true,
  themeMode: 'system'
};

const ALARM_NAME = 'elms-periodic-check';
const MAX_LATEST_UPDATES = 20;
const MAX_TITLE_LENGTH = 140;

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  await rescheduleAlarm();
  await updateStatus({
    lastChecked: null,
    lastError: '',
    lastMessage: 'Extension installed and ready.'
  });
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureDefaults();
  await rescheduleAlarm();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await runCheck('automatic');
  }
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') {
    return;
  }

  if (changes.elmsSettings) {
    await rescheduleAlarm();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'ELMS_CHECK_NOW') {
    runCheck('manual')
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'ELMS_REFRESH_SETTINGS') {
    rescheduleAlarm()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'ELMS_GET_STATE') {
    getDashboardState()
      .then((state) => sendResponse(state))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function ensureDefaults() {
  const current = await chrome.storage.local.get([STORAGE_KEYS.settings, STORAGE_KEYS.seenItems, STORAGE_KEYS.latestUpdates, STORAGE_KEYS.status]);

  if (!current[STORAGE_KEYS.settings]) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.settings]: DEFAULT_SETTINGS
    });
  }

  if (!current[STORAGE_KEYS.seenItems]) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.seenItems]: {}
    });
  }

  if (!current[STORAGE_KEYS.latestUpdates]) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.latestUpdates]: []
    });
  }

  if (!current[STORAGE_KEYS.status]) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.status]: {
        active: false,
        lastChecked: null,
        lastError: '',
        lastMessage: 'Waiting for settings.'
      }
    });
  }
}

async function getSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(stored[STORAGE_KEYS.settings] || {})
  };

  if (typeof settings.darkMode === 'boolean' && !stored[STORAGE_KEYS.settings]?.themeMode) {
    settings.themeMode = settings.darkMode ? 'dark' : 'light';
    delete settings.darkMode;
  }

  return settings;
}

async function rescheduleAlarm() {
  const settings = await getSettings();
  const permissionGranted = await hasElmsPermission(settings.baseUrl);
  await chrome.alarms.clear(ALARM_NAME);

  if (settings.baseUrl && settings.checkIntervalMinutes > 0 && permissionGranted) {
    chrome.alarms.create(ALARM_NAME, {
      periodInMinutes: settings.checkIntervalMinutes
    });
  }

  await updateStatus({
    active: Boolean(settings.baseUrl && permissionGranted),
    lastMessage: settings.baseUrl
      ? (permissionGranted ? 'Ready to check ELMS.' : 'Grant ELMS permission in Options to start checking.')
      : 'Please set your ELMS base URL in Options.',
    lastError: ''
  });
}

async function runCheck(triggerSource) {
  const settings = await getSettings();

  if (!settings.baseUrl) {
    const message = 'Please set your ELMS base URL in Options first.';
    await updateStatus({
      active: false,
      lastError: message,
      lastMessage: message,
      lastChecked: new Date().toISOString()
    });
    return { ok: false, error: message };
  }

  const permissionGranted = await hasElmsPermission(settings.baseUrl);

  if (!permissionGranted) {
    const message = 'Grant ELMS permission in Options first.';
    await updateStatus({
      active: false,
      lastError: message,
      lastMessage: message,
      lastChecked: new Date().toISOString()
    });
    return { ok: false, error: message };
  }

  let tabs = [];

  try {
    tabs = await chrome.tabs.query({ url: buildTabMatchPattern(settings.baseUrl) });
  } catch (error) {
    const message = 'Could not query ELMS tabs. Check your base URL in Options.';
    await updateStatus({
      active: true,
      lastError: message,
      lastMessage: message,
      lastChecked: new Date().toISOString()
    });
    return { ok: false, error: error.message || message };
  }

  if (!tabs.length) {
    const message = 'Open ELMS first so the extension can read the page.';
    await updateStatus({
      active: true,
      lastError: message,
      lastMessage: message,
      lastChecked: new Date().toISOString()
    });
    return { ok: false, error: message };
  }

  const seenItems = await getSeenItems();
  const latestUpdates = await getLatestUpdates();
  const newItems = [];

  for (const tab of tabs) {
    if (typeof tab.id !== 'number') {
      continue;
    }

    const result = await inspectTab(tab.id);

    if (!result.ok) {
      await updateStatus({
        active: true,
        lastError: result.error,
        lastMessage: result.error,
        lastChecked: new Date().toISOString()
      });

      if (result.loggedOut) {
        return { ok: false, error: 'Please login to ELMS first.' };
      }

      continue;
    }

    if (result.structureChanged) {
      const message = result.error || 'ELMS page structure changed. Update the selectors in content.js.';
      await updateStatus({
        active: true,
        lastError: message,
        lastMessage: message,
        lastChecked: new Date().toISOString()
      });
      continue;
    }

    for (const item of result.items) {
      const itemKey = buildItemKey(item);

      if (!seenItems[itemKey]) {
        newItems.push(item);
      }

      seenItems[itemKey] = {
        title: item.title,
        courseName: item.courseName,
        kind: item.kind,
        url: item.url,
        seenAt: new Date().toISOString()
      };
    }
  }

  const combinedLatest = mergeLatestUpdates(latestUpdates, newItems);

  await chrome.storage.local.set({
    [STORAGE_KEYS.seenItems]: seenItems,
    [STORAGE_KEYS.latestUpdates]: combinedLatest
  });

  if (newItems.length && settings.notificationsEnabled) {
    for (const item of newItems) {
      await showNotification(item);
    }
  }

  const message = newItems.length
    ? `Found ${newItems.length} new ELMS update${newItems.length === 1 ? '' : 's'}.`
    : 'No new ELMS updates found.';

  await updateStatus({
    active: true,
    lastError: '',
    lastMessage: message,
    lastChecked: new Date().toISOString(),
    lastTrigger: triggerSource
  });

  return {
    ok: true,
    newItems,
    message
  };
}

async function inspectTab(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'ELMS_GET_ITEMS'
    });

    return normalizeInspectionResponse(response);
  } catch (error) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });

      const retryResponse = await chrome.tabs.sendMessage(tabId, {
        type: 'ELMS_GET_ITEMS'
      });

      return normalizeInspectionResponse(retryResponse);
    } catch (retryError) {
      return {
        ok: false,
        error: 'Could not read the ELMS page. Make sure you are logged in and the page matches the selectors in content.js.',
        loggedOut: false
      };
    }
  }
}

function normalizeInspectionResponse(response) {
  if (!response) {
    return {
      ok: false,
      error: 'No response from ELMS page.',
      loggedOut: false
    };
  }

  if (response.loggedOut) {
    return {
      ok: false,
      error: 'Please login to ELMS first.',
      loggedOut: true
    };
  }

  if (response.structureChanged) {
    return {
      ok: false,
      error: response.error || 'ELMS page structure changed.',
      structureChanged: true,
      loggedOut: false
    };
  }

  if (!Array.isArray(response.items)) {
    return {
      ok: false,
      error: 'Unexpected ELMS page response.',
      loggedOut: false
    };
  }

  return {
    ok: true,
    items: response.items.map(normalizeItem)
  };
}

function normalizeItem(item) {
  return {
    id: item.id || buildItemKey(item),
    title: item.title || 'Untitled update',
    courseName: item.courseName || 'Unknown course',
    kind: item.kind || 'update',
    url: item.url || '',
    timestamp: item.timestamp || new Date().toISOString()
  };
}

function buildItemKey(item) {
  return [item.kind || 'update', item.courseName || '', item.title || '', item.url || '', item.id || '']
    .map((value) => String(value).trim().toLowerCase())
    .join('|');
}

function mergeLatestUpdates(existingUpdates, newItems) {
  const merged = [...newItems, ...existingUpdates].filter(isValidUpdateItem);
  const deduped = [];
  const seen = new Set();

  for (const item of merged) {
    const key = buildItemKey(item);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push({
      id: item.id || key,
      title: item.title,
      courseName: item.courseName,
      kind: item.kind,
      url: item.url,
      timestamp: item.timestamp || new Date().toISOString()
    });
  }

  return deduped.slice(0, MAX_LATEST_UPDATES);
}

async function getSeenItems() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.seenItems);
  return stored[STORAGE_KEYS.seenItems] || {};
}

async function getLatestUpdates() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.latestUpdates);
  const latestUpdates = Array.isArray(stored[STORAGE_KEYS.latestUpdates]) ? stored[STORAGE_KEYS.latestUpdates] : [];
  const sanitized = latestUpdates.filter(isValidUpdateItem).slice(0, MAX_LATEST_UPDATES);

  if (sanitized.length !== latestUpdates.length || sanitized.some((item, index) => buildItemKey(item) !== buildItemKey(latestUpdates[index] || {}))) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.latestUpdates]: sanitized
    });
  }

  return sanitized;
}

function isValidUpdateItem(item) {
  const title = String(item?.title || '').trim();
  const courseName = String(item?.courseName || '').trim();
  const kind = String(item?.kind || '').trim();

  if (!title || !courseName || !kind) {
    return false;
  }

  if (title.length > MAX_TITLE_LENGTH) {
    return false;
  }

  if (title.includes('\n') || title.includes('require(') || title.includes('function ')) {
    return false;
  }

  return true;
}

async function updateStatus(patch) {
  const current = await chrome.storage.local.get(STORAGE_KEYS.status);
  const nextStatus = {
    active: true,
    lastChecked: null,
    lastError: '',
    lastMessage: '',
    lastTrigger: '',
    ...(current[STORAGE_KEYS.status] || {}),
    ...patch
  };

  await chrome.storage.local.set({
    [STORAGE_KEYS.status]: nextStatus
  });
}

async function getDashboardState() {
  const [settings, latestUpdates, status] = await Promise.all([
    getSettings(),
    getLatestUpdates(),
    chrome.storage.local.get(STORAGE_KEYS.status)
  ]);

  return {
    ok: true,
    settings,
    latestUpdates,
    status: status[STORAGE_KEYS.status] || {}
  };
}

async function showNotification(item) {
  const notificationId = `elms-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  await chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: createNotificationIcon(),
    title: 'ELMS Notification Helper',
    message: `New ELMS update: ${item.courseName} - ${item.title}`
  });
}

function createNotificationIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
      <rect width="128" height="128" rx="28" fill="#0f766e" />
      <path d="M34 40h60v10H34zm0 20h42v10H34zm0 20h30v10H34z" fill="#ffffff" opacity="0.96" />
      <circle cx="94" cy="86" r="14" fill="#f59e0b" />
      <path d="M90 86l3 3 7-8" stroke="#ffffff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none" />
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function buildTabMatchPattern(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    return `${parsed.origin}/*`;
  } catch {
    return baseUrl;
  }
}

async function hasElmsPermission(baseUrl) {
  const origin = getOriginPattern(baseUrl);

  if (!origin) {
    return false;
  }

  return chrome.permissions.contains({
    origins: [origin]
  });
}

function getOriginPattern(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    return `${parsed.origin}/*`;
  } catch {
    return '';
  }
}