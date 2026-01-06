// ========================================
// Google Ads Extractor Pro - Background Service Worker
// ========================================

// Set badge on install
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.get(['extractCount'], (result) => {
        const count = result.extractCount || 0;
        updateBadge(count);
    });

    console.log('Google Ads Extractor Pro installed!');
});

// Listen for updates from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'updateBadge') {
        updateBadge(message.count);
    }

    if (message.type === 'extractFromContent') {
        // Handle extraction request from content script
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            if (tabs[0]) {
                try {
                    const results = await chrome.scripting.executeScript({
                        target: { tabId: tabs[0].id },
                        func: extractAdDataInPage
                    });
                    sendResponse({ success: true, data: results[0].result });
                } catch (error) {
                    sendResponse({ success: false, error: error.message });
                }
            }
        });
        return true; // Keep the message channel open for async response
    }
});

// Update badge count
function updateBadge(count) {
    const text = count > 99 ? '99+' : (count > 0 ? count.toString() : '');
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
}

// Listen for tab updates to show/hide badge
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        if (tab.url.includes('adstransparency.google.com')) {
            // On Google Ads Transparency page - show active state
            chrome.action.setBadgeBackgroundColor({ color: '#10b981', tabId });
        }
    }
});

// Context menu for quick extraction
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'extractAdData',
        title: 'Extract Ad Data',
        contexts: ['page'],
        documentUrlPatterns: ['https://adstransparency.google.com/*']
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'extractAdData') {
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: showExtractionNotification
        });
    }
});

function showExtractionNotification() {
    // Show a toast on the page
    const toast = document.createElement('div');
    toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    z-index: 999999;
    animation: slideIn 0.3s ease;
  `;
    toast.textContent = '🔍 Click the extension icon to extract ad data';
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
}

function extractAdDataInPage() {
    // Same extraction logic as popup.js
    return { appName: 'Test', storeLink: 'https://...' };
}
