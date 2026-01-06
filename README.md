# Google Ads Transparency Scraper - Complete Project Documentation

> **Last Updated:** January 5, 2026  
> **Author:** Ahsan Iqbal  
> **Purpose:** Extract app data, video IDs, and store links from Google Ads Transparency Center

---

## 📁 Project Structure

```
google-ads-transperancy-scrape/
│
├── 🤖 NODE.JS SCRAPING AGENTS
│   ├── agent.js              # Video ID extractor (original)
│   ├── new_agent.js          # App data extractor (with safety features)
│   └── app_data_agent.js     # ⭐ MAIN App data agent (FIXED - Jan 5, 2026)
│
├── 🔧 CONFIGURATION
│   ├── credentials.json      # Google Sheets API credentials
│   ├── package.json          # Node.js dependencies
│   └── .env                  # Environment variables (PROXIES, GH_TOKEN, etc.)
│
├── 🧩 CHROME EXTENSION
│   └── google-ads-extractor-extension/
│       ├── manifest.json     # Extension config (Manifest V3)
│       ├── popup.html        # Main popup UI
│       ├── popup.css         # Premium dark theme styles
│       ├── popup.js          # Core extraction + history + export
│       ├── background.js     # Badge + context menu
│       ├── content.js        # Floating button on pages
│       ├── content.css       # Floating button styles
│       ├── icons/            # Extension icons (16, 48, 128px)
│       └── README.md         # Extension documentation
│
└── 📄 DOCUMENTATION
    └── README.md             # This file
```

---

## 🔧 Node.js Agents

### 1. `app_data_agent.js` - Main App Data Extractor ⭐

**What it does:**
- Reads URLs from Google Sheet ("App data" sheet, Column A)
- Visits each URL on Google Ads Transparency Center
- Extracts: **App Name**, **Store Link**, **Ad Format** (Video/Text)
- Writes results to Columns B, C, D

**Configuration:**
```javascript
const SPREADSHEET_ID = '1beJ263B3m4L8pgD9RWsls-orKLUvLMfT2kExaiyNl7g';
const SHEET_NAME = 'App data';
const CONCURRENT_PAGES = 3;  // Parallel requests per batch
```

**Environment Variables:**
```bash
PROXIES="http://user:pass@host:port;http://..."  # Optional proxy rotation
CONCURRENT_PAGES=3                                # Override default concurrency
GH_TOKEN="your_github_token"                      # For self-restart
GITHUB_REPOSITORY="owner/repo"                    # For self-restart
```

**Run Command:**
```bash
node app_data_agent.js
```

---

### 🐛 BUG FIX LOG (January 5, 2026)

#### Problem: Wrong App Links Extracted
When an advertiser had multiple app ads (e.g., "1 of 4 variations"), the script was extracting data from a HIDDEN ad variation instead of the visible one, resulting in wrong app names and store links.

#### Root Cause:
Google Ads Transparency loads ALL ad variations in separate iframes simultaneously, but only ONE is visible. The old code looped through all iframes and picked the first one with data - which was often hidden.

#### Solution Applied:
1. **Visibility Detection:** Added body dimension check (`width > 50 && height > 50`) to identify visible frames
2. **Skip Hidden Frames:** Frames with `isHidden: true` are skipped
3. **Priority Logic:** Only break loop when BOTH app name AND store link are found (high confidence)
4. **Strict Store Link Validation:** Only accepts links containing:
   - `play.google.com/store/apps` AND `id=` parameter
   - `apps.apple.com` or `itunes.apple.com` AND `/app/` path

#### Key Code Change (Lines 284-530):
```javascript
// Check if frame is visible before extracting
const bodyRect = document.body.getBoundingClientRect();
if (bodyRect.width < 50 || bodyRect.height < 50) {
    return { ...data, isHidden: true };
}

// Skip hidden frames
if (frameData.isHidden) continue;

// Only use result if BOTH name AND link found (high confidence)
if (frameData.appName && frameData.storeLink && result.appName === 'NOT_FOUND') {
    result.appName = cleanName(frameData.appName);
    result.storeLink = frameData.storeLink;
    break; // Stop searching
}
```

---

### 2. `agent.js` - Video ID Extractor

**What it does:**
- Extracts YouTube Video IDs from video ads
- Clicks play button to trigger video load
- Captures video ID from network requests

**Run Command:**
```bash
node agent.js
```

---

### 3. `new_agent.js` - Safety-First App Extractor

Similar to `app_data_agent.js` but with additional anti-detection features like random delays and user-agent rotation.

---

## 🧩 Chrome Extension

### Installation (Developer Mode)
1. Open Chrome → `chrome://extensions/`
2. Enable **"Developer mode"** (top-right toggle)
3. Click **"Load unpacked"**
4. Select folder: `google-ads-extractor-extension`

### Features
- ✅ One-click extraction of App Name, Store Link, Package ID
- ✅ Extract ALL ad variations from a single page
- ✅ Copy to clipboard for each field
- ✅ Export extraction history to CSV
- ✅ Floating action button on Google Ads pages
- ✅ Beautiful dark theme with glassmorphism

### Key Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension permissions & config |
| `popup.js` | Main logic - `extractAdData()` and `extractAllVariations()` functions |
| `content.js` | Floating button + quick extract feature |

### Extraction Logic (in popup.js)
```javascript
// Same visibility-aware logic as Node.js agent
const iframes = document.querySelectorAll('iframe');
for (const iframe of iframes) {
    const rect = iframe.getBoundingClientRect();
    if (rect.width < 50 || rect.height < 50) continue;  // Skip hidden
    
    // Extract from visible frame...
}
```

---

## 💰 Monetization Ideas

| Method | Price Range | Platform |
|--------|-------------|----------|
| Chrome Web Store (Freemium) | Free + $9/mo Premium | Chrome Web Store |
| One-time License | $19-49 | Gumroad, Paddle |
| Monthly Subscription | $5-15/mo | Stripe, Paddle |
| API Service | $0.01/extraction | Your own backend |
| Whitelabel to Agencies | $99-499 | Direct sales |
| Lifetime Deal | $79-149 | AppSumo |

### Premium Features to Add:
- Bulk extraction (process multiple advertisers)
- Scheduled extraction (auto-run daily)
- Google Sheets integration (direct export)
- Advanced filters (by country, date, format)
- API access for developers

---

## 📊 Google Sheets Structure

### "App data" Sheet
| Column A | Column B | Column C | Column D |
|----------|----------|----------|----------|
| URL | Store Link | App Name | Ad Format |
| https://adstransparency.google.com/... | https://play.google.com/... | QR Scanner | Video Ad |

---

## 🔐 Anti-Detection Features

The Node.js agents include multiple anti-detection measures:

1. **Stealth Plugin:** `puppeteer-extra-plugin-stealth`
2. **Random User Agents:** 6 different browser fingerprints
3. **Random Viewports:** 5 different screen sizes
4. **Webdriver Masking:** `navigator.webdriver = undefined`
5. **Human-like Behavior:**
   - Random delays (1-5 seconds)
   - Mouse movements
   - Scrolling simulation
6. **Proxy Rotation:** Optional via PROXIES env var
7. **Block Detection:** Checks for captcha/429 errors
8. **Self-Restart:** Triggers GitHub Actions on block

---

## 🚀 Quick Start Commands

```bash
# Install dependencies
npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth googleapis

# Run App Data Agent
node app_data_agent.js

# Run Video ID Agent
node agent.js

# Test Extension
# 1. Load extension in chrome://extensions/
# 2. Visit https://adstransparency.google.com/
# 3. Open any ad and click extension icon
```

---

## 🐞 Troubleshooting

### "BLOCKED" or Captcha Errors
- Add proxy rotation via PROXIES env var
- Reduce CONCURRENT_PAGES to 1-2
- Increase delays between batches

### Wrong App Links Extracted
- This was fixed on Jan 5, 2026 (see bug fix log above)
- Make sure you're using the updated `app_data_agent.js`

### Extension Not Working
- Check if you're on `adstransparency.google.com`
- Reload the extension after code changes
- Check Chrome DevTools console for errors

### Google Sheets API Errors
- Verify `credentials.json` is valid
- Check spreadsheet permissions (service account needs edit access)

---

## 📝 TODO / Future Improvements

- [ ] Add iOS App Store link support
- [ ] Extract ad images/thumbnails
- [ ] Add advertiser name extraction
- [ ] Create API backend for extension
- [ ] Add payment integration (Stripe)
- [ ] Publish to Chrome Web Store
- [ ] Add Firefox extension version
- [ ] Create landing page for sales

---

## 📞 Support

For issues or questions, refer to this documentation or review the code comments.

---

**Created with ❤️ for digital marketers and competitive analysts**
