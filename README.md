# UIU ELMS Notification Helper

A Chrome extension that detects new updates from ELMS (E-Learning Management System) and sends browser notifications. Never miss important assignments, notices, resources, quizzes, or calendar events again.

## Features

✨ **Key Capabilities:**

- 🔔 **Browser Notifications** - Get instant alerts for new ELMS updates
- 📅 **Comprehensive Detection** - Tracks assignments, notices, resources, quizzes, and calendar events
- 🌙 **Dark Mode** - Available for both the extension UI and ELMS website content
- ⏱️ **Customizable Intervals** - Check ELMS every 5, 15, 30, or 60 minutes (default: 15)
- 🔐 **Privacy-First** - All data stored locally; no external servers, no password storage
- 🎯 **Runtime Permissions** - Works with any ELMS domain without editing the extension
- 📧 **Email Updates** - Easily share detected updates with others
- ⚡ **Lightweight** - Minimal resource usage with efficient periodic checking

## How to Install

### Option 1: Load from Source (Development Mode)

1. **Clone or download this repository**
   ```bash
   git clone https://github.com/JimHosaain/UIU-ELMS-chrome-extension.git
   ```

2. **Open Chrome Extensions page**
   - Go to `chrome://extensions/`
   - Enable **Developer mode** (toggle in top-right corner)

3. **Load the extension**
   - Click **"Load unpacked"**
   - Navigate to and select the extension folder
   - The extension will appear in your Chrome toolbar

### Option 2: Install from Chrome Web Store
*(Coming soon)*

## How to Use

### Initial Setup

1. **Open the extension popup**
   - Click the extension icon in your Chrome toolbar
   - You'll see the "Notification Helper" popup

2. **Configure ELMS URL**
   - Click **"Open Options"** or go to the settings page
   - Enter your ELMS base URL (e.g., `https://your-university-elms.edu`)
   - Click **"Save Settings"**

3. **Grant Permission**
   - Click **"Grant ELMS Permission"** button in the popup
   - This allows the extension to monitor your ELMS site
   - Confirm the permission in the browser dialog

### Daily Usage

**In the Popup Window:**

| Feature | Description |
|---------|-------------|
| **Check Now** | Manually trigger an immediate ELMS check |
| **Grant ELMS Permission** | Request access to monitor your ELMS domain |
| **Latest updates** | Shows 5 most recent detected items |
| **Email Updates** | Opens your email client with all updates pre-filled |

**Quick Settings (in popup):**
- **Check interval** - How often to scan ELMS (5-60 minutes)
- **Enable notifications** - Toggle browser alerts on/off
- **Theme** - Choose Light, Dark, or System theme

**Full Settings (click "Open Options"):**
- Update ELMS base URL
- Adjust all quick settings
- Test connection to ELMS

### Dark Mode

**Enable dark mode:**
1. Open popup or Options
2. Set **Theme** to "Dark" (or "Follow system theme")
3. Dark mode applies instantly to:
   - Extension UI (popup & settings)
   - ELMS website content (automatically injected)

## How It Works

### Architecture

```
Background Service → Periodic Alarm (every 15 min)
       ↓
Sends "Check ELMS" message to content script
       ↓
Content Script → Reads ELMS page structure
       ↓
Extracts: assignments, notices, resources, quizzes, events
       ↓
Compares with stored items → Detects NEW items
       ↓
Browser Notification + Local Storage Update
```

### Data Storage

All data is stored **locally** using Chrome's `chrome.storage.local`:

- `elmsSettings` - Your configuration (URL, interval, theme, notifications)
- `elmsSeenItems` - Items already detected (prevents duplicates)
- `elmsLatestUpdates` - Currently displayed items (max 5)
- `elmsStatus` - Last check time and status message

**No external servers. No data sent anywhere.**

## Permissions Explained

The extension requests these Chrome permissions:

| Permission | Why? |
|-----------|------|
| `storage` | Store settings and detected items locally |
| `scripting` | Inject content detection code into ELMS pages |
| `tabs` | Monitor which tabs have ELMS open |
| `alarms` | Schedule periodic checks |
| `notifications` | Display browser notifications |
| `optional_host_permissions` | Access your ELMS domain (you control this) |

**No data is sent to external servers. Everything stays on your computer.**

## Troubleshooting

### Extension won't detect updates

1. **Check ELMS URL is correct**
   - Settings → Verify the base URL matches your ELMS address
   - Test the connection with the "Test" button

2. **Grant permission if prompted**
   - Click "Grant ELMS Permission" button in popup
   - Confirm in the browser permission dialog

3. **Check if logged into ELMS**
   - Navigate to your ELMS site and log in
   - Extension works with your existing browser session

4. **Customize selectors for your ELMS**
   - Different ELMS installations use different HTML classes
   - Open DevTools on your ELMS page (F12)
   - Inspect assignment/notice/event elements
   - Update selectors in `content.js` if needed

### Theme not applying to ELMS website

- Make sure **Theme** is set to "Dark" (not "Light")
- Refresh your ELMS page after enabling dark mode
- Check browser console for any CSS injection errors

### Notifications not showing

1. Check **Enable notifications** is toggled ON in Quick Settings
2. Verify Chrome notifications aren't muted system-wide
3. Check notification settings: Windows → Settings → System → Notifications

## File Structure

```
├── manifest.json          # Chrome MV3 configuration
├── background.js          # Background service worker (periodic checking)
├── content.js            # Content script (ELMS page inspection & dark mode)
├── popup.html / popup.js # Extension popup UI
├── options.html / options.js # Settings page
├── styles.css            # Theme styling (light/dark)
└── README.md             # This file
```

## Development

### Modifying Selectors

If your ELMS uses different HTML structures, update the `SELECTORS` object in `content.js`:

```javascript
const SELECTORS = {
  assignments: '.your-assignment-class',
  notices: '.your-notice-class',
  resources: '.your-resource-class',
  quizzes: '.your-quiz-class',
  calendarEvents: '.your-event-class',
  courseTitle: '.your-course-title-class'
};
```

Inspect elements with DevTools (F12) to find the correct class names for your ELMS.

### Testing Locally

1. Make code changes
2. Go to `chrome://extensions/`
3. Click the ↻ refresh icon on the extension card
4. Test the changes

## Privacy & Security

✅ **What this extension does NOT do:**
- Does not store passwords
- Does not send data to external servers
- Does not track user behavior
- Does not require login to function

✅ **Uses existing browser session:**
- Works with your current ELMS login
- No separate authentication needed
- Can be disabled anytime

## Keyboard Shortcuts

Add custom keyboard shortcuts to launch features:

1. Go to `chrome://extensions/shortcuts`
2. Find "UIU ELMS Notification Helper"
3. Add shortcuts for quick access

## Support & Feedback

Found a bug? Have a feature request?

- **GitHub Issues**: [UIU-ELMS-chrome-extension/issues](https://github.com/JimHosaain/UIU-ELMS-chrome-extension/issues)
- **Report bugs** with details about your ELMS version and browser
- **Share feature ideas** to improve the extension

## License

This project is open source and available under the [MIT License](LICENSE).

## Credits

**Developer:** Jim Hosaain  
**University:** Islamic University of Technology (IUT)  
**Purpose:** Simplify ELMS notifications for UIU students

---

**Made with ❤️ for UIU students**

*Last Updated: April 2026*