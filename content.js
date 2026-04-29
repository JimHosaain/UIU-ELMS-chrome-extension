const SELECTORS = {
  assignments: '[class*="assignment"], [class*="task"], [class*="work"], tbody tr',
  notices: '[class*="announcement"], [class*="discussion"], [class*="forum"], [class*="notice"], td[onclick], tr[onclick]',
  resources: '[class*="resource"], [class*="material"], [class*="content"], [class*="file"]',
  quizzes: '[class*="quiz"], [class*="exam"], [class*="test"], [class*="assessment"]',
  calendarEvents: '[class*="event"], [class*="calendar"], [class*="schedule"], [data-event-id]',
  courseTitle: '[class*="course"], .title, h2, h3, h4'
};

const STORAGE_KEYS = {
  settings: 'elmsSettings'
};

// Replace the placeholder selectors above after inspecting the real ELMS HTML.
// The goal is to keep the content script readable for beginners, so each selector
// maps to one kind of ELMS update item.

// Initialize dark mode on page load
applyStoredTheme();

// Listen for storage changes to sync theme updates
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') {
    return;
  }

  if (changes.elmsSettings) {
    applyStoredTheme();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'ELMS_GET_ITEMS') {
    return false;
  }

  try {
    sendResponse(collectElmsItems());
  } catch (error) {
    sendResponse({
      ok: false,
      error: error.message || 'Failed to read ELMS content.'
    });
  }

  return false;
});

function collectElmsItems() {
  if (looksLikeLoginPage()) {
    return {
      ok: false,
      loggedOut: true,
      error: 'Please login to ELMS first.'
    };
  }

  const items = [];

  items.push(...collectItems(SELECTORS.assignments, 'assignment'));
  items.push(...collectItems(SELECTORS.notices, 'notice'));
  items.push(...collectItems(SELECTORS.resources, 'resource'));
  items.push(...collectItems(SELECTORS.quizzes, 'quiz'));
  items.push(...collectItems(SELECTORS.calendarEvents, 'event'));
  items.push(...collectCalendarItemsFromBody());

  const cleanedItems = items.filter((item) => Boolean(item.title || item.courseName));

  if (!cleanedItems.length) {
    return {
      ok: false,
      structureChanged: true,
      error: 'No ELMS items matched the placeholder selectors. Inspect the page and update content.js selectors.'
    };
  }

  cleanedItems.sort((left, right) => {
    return new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime();
  });

  return {
    ok: true,
    items: cleanedItems
  };
}

function looksLikeLoginPage() {
  const passwordField = document.querySelector('input[type="password"]');
  const loginText = document.body?.innerText?.toLowerCase().includes('please login');
  const signInButton = Array.from(document.querySelectorAll('button, a')).some((element) => {
    const text = (element.textContent || '').trim().toLowerCase();
    return text === 'login' || text === 'sign in' || text === 'sign-in';
  });

  return Boolean(passwordField || (loginText && signInButton));
}

function collectItems(selector, kind) {
  const elements = document.querySelectorAll(selector);
  const results = [];

  for (const element of elements) {
    const item = buildItemFromElement(element, kind);

    if (item) {
      results.push(item);
    }
  }

  return results;
}

function buildItemFromElement(element, kind) {
  const title = readText(element, [
    '.item-title',
    '.title',
    'h1',
    'h2',
    'h3',
    'h4',
    'a'
  ]);

  const courseName = readCourseName(element);
  const url = readUrl(element);
  const id =
    element.getAttribute('data-id') ||
    element.getAttribute('data-update-id') ||
    element.id ||
    url ||
    `${kind}:${courseName}:${title}`;

  const timestamp = readTimestamp(element);

  return {
    id: id.trim(),
    title: title.trim(),
    courseName: courseName.trim(),
    kind,
    url,
    timestamp
  };
}

function readText(root, selectorList) {
  for (const selector of selectorList) {
    const node = root.querySelector(selector);

    if (node && node.textContent) {
      const value = node.textContent.trim();

      if (value) {
        return value;
      }
    }
  }

  const fallback = (root.textContent || '').trim();
  return fallback.split('\n')[0].trim();
}

function readCourseName(element) {
  const nearbyCourseTitle = element.closest('article, section, li, .course-card, .course-item, .course-panel, .card')?.querySelector(SELECTORS.courseTitle);

  if (nearbyCourseTitle?.textContent) {
    return nearbyCourseTitle.textContent.trim();
  }

  const directCourseTitle = element.querySelector(SELECTORS.courseTitle);

  if (directCourseTitle?.textContent) {
    return directCourseTitle.textContent.trim();
  }

  return document.querySelector(SELECTORS.courseTitle)?.textContent?.trim() || 'Unknown course';
}

function readUrl(element) {
  const anchor = element.querySelector('a[href]') || element.closest('a[href]');

  if (anchor instanceof HTMLAnchorElement) {
    return anchor.href;
  }

  const dataUrl = element.getAttribute('data-url') || element.getAttribute('data-href');
  return dataUrl || '';
}

function readTimestamp(element) {
  const dateAttribute = element.getAttribute('data-time') || element.getAttribute('data-timestamp') || element.getAttribute('datetime');

  if (dateAttribute) {
    const parsedDate = new Date(dateAttribute);

    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate.toISOString();
    }
  }

  const timeElement = element.querySelector('time[datetime]');

  if (timeElement?.getAttribute('datetime')) {
    const parsedDate = new Date(timeElement.getAttribute('datetime'));

    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate.toISOString();
    }
  }

  return new Date().toISOString();
}

async function applyStoredTheme() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const settings = stored[STORAGE_KEYS.settings] || {};
  const themeMode = settings.themeMode || 'system';

  let isDarkMode = false;

  if (themeMode === 'dark') {
    isDarkMode = true;
  } else if (themeMode === 'system') {
    isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  if (isDarkMode) {
    injectDarkModeCSS();
  } else {
    removeDarkModeCSS();
  }
}

function injectDarkModeCSS() {
  let styleElement = document.getElementById('elms-dark-mode-style');

  if (!styleElement) {
    styleElement = document.createElement('style');
    styleElement.id = 'elms-dark-mode-style';
    styleElement.textContent = getDarkModeCSS();
    document.head.appendChild(styleElement);
  }
}

function removeDarkModeCSS() {
  const styleElement = document.getElementById('elms-dark-mode-style');
  if (styleElement) {
    styleElement.remove();
  }
}

function getDarkModeCSS() {
  return `
    /* ELMS Dark Mode - automatically applied by extension */
    * {
      background-color: #1a1a1a !important;
      color: #e0e0e0 !important;
      border-color: #444 !important;
    }

    html, body {
      background-color: #0f0f0f !important;
      color: #e0e0e0 !important;
    }

    a, a * {
      color: #64d5ff !important;
    }

    a:visited, a:visited * {
      color: #b19cd9 !important;
    }

    input, textarea, select {
      background-color: #2a2a2a !important;
      color: #e0e0e0 !important;
      border-color: #555 !important;
    }

    input::placeholder {
      color: #888 !important;
    }

    button {
      background-color: #444 !important;
      color: #e0e0e0 !important;
      border-color: #666 !important;
    }

    button:hover {
      background-color: #555 !important;
    }

    .card, .panel, [class*="card"], [class*="panel"] {
      background-color: #1a1a1a !important;
      border-color: #444 !important;
    }

    .header, .navbar, [class*="header"], [class*="navbar"] {
      background-color: #0a0a0a !important;
      border-color: #333 !important;
    }

    .modal, .dialog, [class*="modal"], [class*="dialog"] {
      background-color: #2a2a2a !important;
      color: #e0e0e0 !important;
    }

    .btn-primary {
      background-color: #0066cc !important;
      border-color: #0055aa !important;
      color: #fff !important;
    }

    .btn-secondary {
      background-color: #666 !important;
      border-color: #555 !important;
      color: #e0e0e0 !important;
    }

    table {
      background-color: #1a1a1a !important;
      border-color: #444 !important;
    }

    tr, td, th {
      background-color: #1a1a1a !important;
      border-color: #444 !important;
      color: #e0e0e0 !important;
    }

    tr:hover {
      background-color: #2a2a2a !important;
    }

    /* Preserve text selection contrast */
    ::selection {
      background-color: #0066cc !important;
      color: #fff !important;
    }

    img {
      opacity: 0.8;
    }

    img:hover {
      opacity: 1;
    }
  `;
}

function collectCalendarItemsFromBody() {
  const items = [];

  // Look for common calendar event patterns in the page
  // Check for calendar containers with events
  const calendarContainers = document.querySelectorAll('[class*="calendar"], [id*="calendar"], .fc, [data-calendar]');

  for (const container of calendarContainers) {
    // FullCalendar (.fc-event)
    const fcEvents = container.querySelectorAll('.fc-event, .fc-event-main');
    for (const event of fcEvents) {
      const item = buildCalendarEventItem(event, 'event');
      if (item) {
        items.push(item);
      }
    }

    // Generic event elements
    const eventElements = container.querySelectorAll('[class*="event"]:not(.event-hidden):not(.hidden)');
    for (const event of eventElements) {
      const item = buildCalendarEventItem(event, 'event');
      if (item && !items.some((i) => i.id === item.id)) {
        items.push(item);
      }
    }
  }

  // Also check for events with data attributes
  const dataEventElements = document.querySelectorAll('[data-event-id], [data-event], [data-calendar-event]');
  for (const event of dataEventElements) {
    const item = buildCalendarEventItem(event, 'event');
    if (item && !items.some((i) => i.id === item.id)) {
      items.push(item);
    }
  }

  return items;
}

function buildCalendarEventItem(element, kind) {
  // Try to extract event title/name
  const title = readText(element, [
    '.fc-event-title',
    '.event-title',
    '[data-event-title]',
    '.title',
    'h3',
    'h4',
    'span'
  ]);

  if (!title || title.length < 2) {
    return null;
  }

  // Extract course name
  const courseName = readCourseName(element);

  // Extract event date/time from various sources
  let timestamp = new Date().toISOString();
  const timeAttr = element.getAttribute('data-start') ||
    element.getAttribute('data-date') ||
    element.getAttribute('datetime');

  if (timeAttr) {
    const parsedDate = new Date(timeAttr);
    if (!Number.isNaN(parsedDate.getTime())) {
      timestamp = parsedDate.toISOString();
    }
  } else {
    // Try to find time info in the element text
    const timeMatch = element.innerText?.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      const now = new Date();
      const eventDate = new Date(now);
      eventDate.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0);
      timestamp = eventDate.toISOString();
    }
  }

  const url = element.querySelector('a[href]')?.href || element.getAttribute('data-url') || '';
  const id = element.getAttribute('data-event-id') ||
    element.id ||
    `event:${courseName}:${title}:${timestamp}`;

  return {
    id: id.trim(),
    title: title.trim(),
    courseName: courseName.trim(),
    kind,
    url,
    timestamp
  };
}