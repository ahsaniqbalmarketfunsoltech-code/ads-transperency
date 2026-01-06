# Google Ads Transparency Extractor Pro

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Chrome](https://img.shields.io/badge/Chrome-Extension-green)
![License](https://img.shields.io/badge/license-MIT-purple)

A powerful Chrome extension that extracts app data from Google Ads Transparency Center with one click.

## ✨ Features

- **One-Click Extraction** - Extract app name, store link, and package ID instantly
- **All Variations** - Extract data from all ad variations on a page
- **Video ID Detection** - Automatically detect YouTube video IDs from video ads
- **Copy to Clipboard** - Quick copy buttons for each field
- **Export to CSV** - Download your extraction history as a CSV file
- **Extraction History** - Keep track of your last 50 extractions
- **Floating Button** - Quick access button on every Google Ads Transparency page
- **Beautiful Dark UI** - Premium glassmorphism design

## 🚀 Installation

### From Chrome Web Store (Coming Soon)
1. Visit the Chrome Web Store
2. Search for "Google Ads Extractor Pro"
3. Click "Add to Chrome"

### Manual Installation (Developer Mode)
1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top-right corner)
4. Click "Load unpacked"
5. Select the `google-ads-extractor-extension` folder
6. The extension is now installed!

## 📖 How to Use

1. Visit [Google Ads Transparency Center](https://adstransparency.google.com/)
2. Search for an advertiser and open an ad
3. Click the extension icon (or the floating button on the page)
4. Click "Extract Current Ad" to get the data
5. Copy individual fields or export all data to CSV

## 📊 What Data is Extracted?

| Field | Description |
|-------|-------------|
| **App Name** | The name of the promoted app |
| **Store Link** | Direct link to Play Store or App Store |
| **Package ID** | Android package name (e.g., com.example.app) |
| **Ad Format** | Video Ad or Text/Image Ad |
| **Video ID** | YouTube video ID (for video ads) |

## 💰 Monetization Ideas

1. **Freemium Model** - Free with limited extractions, paid for unlimited
2. **Chrome Web Store** - Publish and sell licenses
3. **API Service** - Create a paid API for bulk extraction
4. **Subscription** - Monthly/yearly plans for power users
5. **Whitelabel** - License to marketing agencies

## 🛠️ Development

### Project Structure
```
google-ads-extractor-extension/
├── manifest.json      # Extension configuration
├── popup.html         # Main popup UI
├── popup.css          # Popup styles
├── popup.js           # Popup logic
├── background.js      # Background service worker
├── content.js         # Content script (runs on page)
├── content.css        # Content script styles
└── icons/             # Extension icons
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Customization
- Edit `popup.css` to change the theme colors
- Modify extraction logic in `popup.js` (extractAdData function)
- Add new features in `content.js` for on-page functionality

## ⚠️ Disclaimer

This extension is for educational and research purposes only. Use responsibly and in accordance with Google's Terms of Service.

## 📄 License

MIT License - Feel free to modify and distribute.

## 🤝 Support

If you find this useful, consider:
- ⭐ Starring the repository
- 🐛 Reporting bugs
- 💡 Suggesting features
- ☕ Buying me a coffee!

---

Made with ❤️ for digital marketers and app developers
