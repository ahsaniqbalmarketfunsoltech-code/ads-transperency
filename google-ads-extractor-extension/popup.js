// ========================================
// Google Ads Extractor Pro - Popup Script
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    const extractBtn = document.getElementById('extractBtn');
    const extractAllBtn = document.getElementById('extractAllBtn');
    const copyAllBtn = document.getElementById('copyAllBtn');
    const exportCsvBtn = document.getElementById('exportCsvBtn');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    const statusBanner = document.getElementById('statusBanner');
    const resultsSection = document.getElementById('resultsSection');
    const exportSection = document.getElementById('exportSection');
    const extractCount = document.getElementById('extractCount');

    let currentData = null;

    // Load history and count on popup open
    loadHistory();
    updateCount();

    // Check if we're on the right page
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab.url.includes('adstransparency.google.com')) {
            setStatus('error', 'Open a Google Ads Transparency page first');
            extractBtn.disabled = true;
            extractAllBtn.disabled = true;
        }
    });

    // Extract current ad
    extractBtn.addEventListener('click', async () => {
        setStatus('extracting', 'Extracting ad data...');
        extractBtn.disabled = true;
        extractAllBtn.disabled = true;

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: extractAdData,
                world: 'MAIN'
            });

            if (results && results[0] && results[0].result) {
                currentData = results[0].result;
                displayResults(currentData);
                saveToHistory(currentData);
                setStatus('success', 'Extraction complete!');
            } else {
                setStatus('error', 'No ad data found on this page');
            }
        } catch (error) {
            console.error('Extraction error:', error);
            setStatus('error', 'Failed to extract: ' + error.message);
        }

        extractBtn.disabled = false;
        extractAllBtn.disabled = false;
    });

    // Extract all variations
    extractAllBtn.addEventListener('click', async () => {
        setStatus('extracting', 'Extracting all variations...');
        extractBtn.disabled = true;
        extractAllBtn.disabled = true;

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: extractAllVariations,
                world: 'MAIN'
            });

            if (results && results[0] && results[0].result && results[0].result.length > 0) {
                const allData = results[0].result;
                currentData = allData[0]; // Show first one
                displayResults(currentData);

                // Save all to history
                allData.forEach(data => saveToHistory(data));
                setStatus('success', `Extracted ${allData.length} variation(s)`);
            } else {
                setStatus('error', 'No variations found');
            }
        } catch (error) {
            console.error('Extraction error:', error);
            setStatus('error', 'Failed to extract: ' + error.message);
        }

        extractBtn.disabled = false;
        extractAllBtn.disabled = false;
    });

    // Copy all data
    copyAllBtn.addEventListener('click', () => {
        if (!currentData) return;

        const text = `App Name: ${currentData.appName}
Store Link: ${currentData.storeLink}
Package ID: ${currentData.packageId || 'N/A'}
Ad Format: ${currentData.isVideo ? 'Video Ad' : 'Text/Image Ad'}
${currentData.videoId ? 'Video ID: ' + currentData.videoId : ''}`.trim();

        navigator.clipboard.writeText(text).then(() => {
            showToast('Copied to clipboard!');
        });
    });

    // Export CSV
    exportCsvBtn.addEventListener('click', () => {
        chrome.storage.local.get(['extractionHistory'], (result) => {
            const history = result.extractionHistory || [];
            if (history.length === 0) {
                showToast('No data to export');
                return;
            }

            // Create CSV
            const headers = ['App Name', 'Store Link', 'Package ID', 'Ad Format', 'Video ID', 'Extracted At'];
            const rows = history.map(item => [
                item.appName || '',
                item.storeLink || '',
                item.packageId || '',
                item.isVideo ? 'Video' : 'Image/Text',
                item.videoId || '',
                new Date(item.timestamp).toLocaleString()
            ]);

            const csvContent = [headers, ...rows]
                .map(row => row.map(cell => `"${(cell + '').replace(/"/g, '""')}"`).join(','))
                .join('\n');

            // Download
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `google-ads-export-${Date.now()}.csv`;
            a.click();
            URL.revokeObjectURL(url);

            showToast(`Exported ${history.length} records`);
        });
    });

    // Clear history
    clearHistoryBtn.addEventListener('click', () => {
        chrome.storage.local.set({ extractionHistory: [], extractCount: 0 }, () => {
            loadHistory();
            updateCount();
            showToast('History cleared');
        });
    });

    // Copy individual fields
    document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const value = document.getElementById(targetId).textContent;

            if (value && value !== '-') {
                navigator.clipboard.writeText(value).then(() => {
                    btn.classList.add('copied');
                    setTimeout(() => btn.classList.remove('copied'), 1500);
                });
            }
        });
    });

    // Click on store link to open
    document.getElementById('storeLink').addEventListener('click', () => {
        const link = document.getElementById('storeLink').textContent;
        if (link && link !== '-' && link.startsWith('http')) {
            chrome.tabs.create({ url: link });
        }
    });

    // ========================================
    // Helper Functions
    // ========================================

    function setStatus(type, message) {
        statusBanner.className = 'status-banner ' + type;
        statusBanner.querySelector('.status-text').textContent = message;
    }

    function displayResults(data) {
        document.getElementById('appName').textContent = data.appName || 'NOT_FOUND';
        document.getElementById('storeLink').textContent = data.storeLink || 'NOT_FOUND';
        document.getElementById('packageId').textContent = data.packageId || 'N/A';
        document.getElementById('adFormat').textContent = data.isVideo ? '🎬 Video Ad' : '📝 Text/Image Ad';

        if (data.videoId) {
            document.getElementById('videoId').textContent = data.videoId;
            document.getElementById('videoIdCard').style.display = 'block';
        } else {
            document.getElementById('videoIdCard').style.display = 'none';
        }

        resultsSection.style.display = 'block';
        resultsSection.classList.add('fade-in');
        exportSection.style.display = 'flex';
    }

    function saveToHistory(data) {
        chrome.storage.local.get(['extractionHistory', 'extractCount'], (result) => {
            const history = result.extractionHistory || [];
            const count = (result.extractCount || 0) + 1;

            // Add timestamp
            data.timestamp = Date.now();

            // Add to beginning, limit to 50 items
            history.unshift(data);
            if (history.length > 50) history.pop();

            chrome.storage.local.set({ extractionHistory: history, extractCount: count }, () => {
                loadHistory();
                updateCount();
            });
        });
    }

    function loadHistory() {
        chrome.storage.local.get(['extractionHistory'], (result) => {
            const history = result.extractionHistory || [];
            const historyList = document.getElementById('historyList');

            if (history.length === 0) {
                historyList.innerHTML = '<div class="empty-state">No extractions yet</div>';
                return;
            }

            historyList.innerHTML = history.slice(0, 5).map(item => `
        <div class="history-item" data-link="${item.storeLink || ''}">
          <div class="icon">${item.isVideo ? '🎬' : '📝'}</div>
          <div class="info">
            <div class="name">${item.appName || 'Unknown'}</div>
            <div class="time">${formatTime(item.timestamp)}</div>
          </div>
        </div>
      `).join('');

            // Click to copy
            historyList.querySelectorAll('.history-item').forEach(item => {
                item.addEventListener('click', () => {
                    const link = item.dataset.link;
                    if (link && link !== 'NOT_FOUND') {
                        navigator.clipboard.writeText(link);
                        showToast('Link copied!');
                    }
                });
            });
        });
    }

    function updateCount() {
        chrome.storage.local.get(['extractCount'], (result) => {
            extractCount.textContent = result.extractCount || 0;
        });
    }

    function formatTime(timestamp) {
        const diff = Date.now() - timestamp;
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        return new Date(timestamp).toLocaleDateString();
    }

    function showToast(message) {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => toast.remove(), 2000);
    }
});

// ========================================
// Content Script Functions (executed in page context)
// ========================================

function extractAdData() {
    const result = {
        appName: 'NOT_FOUND',
        storeLink: 'NOT_FOUND',
        packageId: null,
        isVideo: false,
        videoId: null
    };

    // Helper to extract store link from googleadservices redirect
    const extractStoreLink = (href) => {
        if (!href) return null;

        const isValidStoreLink = (url) => {
            if (!url) return false;
            const isPlayStore = url.includes('play.google.com/store/apps') && url.includes('id=');
            const isAppStore = (url.includes('apps.apple.com') || url.includes('itunes.apple.com')) && url.includes('/app/');
            return isPlayStore || isAppStore;
        };

        if (isValidStoreLink(href)) return href;

        if (href.includes('googleadservices.com') || href.includes('/pagead/aclk')) {
            try {
                const match = href.match(/[?&]adurl=([^&\s]+)/i);
                if (match && match[1]) {
                    const decoded = decodeURIComponent(match[1]);
                    if (isValidStoreLink(decoded)) return decoded;
                }
            } catch (e) { }
        }
        return null;
    };

    // Helper to clean app name
    const cleanAppName = (text) => {
        if (!text) return null;
        let clean = text.trim();
        clean = clean.replace(/[\u200B-\u200D\uFEFF\u2066-\u2069]/g, '');
        clean = clean.replace(/\.[a-zA-Z][\w-]*/g, ' ');
        clean = clean.replace(/[a-zA-Z-]+\s*:\s*[^;]+;/g, ' ');
        clean = clean.split('!@~!@~')[0];
        if (clean.includes('|')) {
            const parts = clean.split('|').map(p => p.trim()).filter(p => p.length > 2);
            if (parts.length > 0) clean = parts[0];
        }
        clean = clean.replace(/\s+/g, ' ').trim();
        if (clean.length < 2 || /^[\d\s\W]+$/.test(clean)) return null;
        return clean;
    };

    // Search all iframes
    const iframes = document.querySelectorAll('iframe');

    for (const iframe of iframes) {
        try {
            const rect = iframe.getBoundingClientRect();
            if (rect.width < 50 || rect.height < 50) continue;

            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            const root = iframeDoc.querySelector('#portrait-landscape-phone') || iframeDoc.body;

            // Check body visibility
            const bodyRect = iframeDoc.body.getBoundingClientRect();
            if (bodyRect.width < 50 || bodyRect.height < 50) continue;

            // Find app name anchors
            const appEls = root.querySelectorAll('a[data-asoch-targets*="ochAppName"], a[data-asoch-targets*="appname" i]');

            for (const el of appEls) {
                const name = cleanAppName(el.innerText);
                if (!name) continue;

                const storeLink = extractStoreLink(el.href);

                if (name && storeLink) {
                    result.appName = name;
                    result.storeLink = storeLink;
                    result.isVideo = true;

                    // Extract package ID
                    const idMatch = storeLink.match(/id=([a-zA-Z0-9._]+)/);
                    if (idMatch) result.packageId = idMatch[1];

                    break;
                } else if (name && result.appName === 'NOT_FOUND') {
                    result.appName = name;
                }
            }

            if (result.storeLink !== 'NOT_FOUND') break;

        } catch (e) {
            // Cross-origin iframe, skip
        }
    }

    // Try to find video ID from network requests or video elements
    try {
        const videos = document.querySelectorAll('video');
        for (const video of videos) {
            const src = video.src || video.currentSrc;
            if (src && src.includes('youtube.com')) {
                const match = src.match(/(?:embed\/|v\/|vi\/|youtu\.be\/|\/v=)([a-zA-Z0-9_-]{11})/);
                if (match) result.videoId = match[1];
            }
        }
    } catch (e) { }

    return result;
}

function extractAllVariations() {
    const results = [];
    const iframes = document.querySelectorAll('iframe');

    // Similar logic but collect from ALL frames
    for (const iframe of iframes) {
        try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            const root = iframeDoc.querySelector('#portrait-landscape-phone') || iframeDoc.body;

            const bodyRect = iframeDoc.body.getBoundingClientRect();
            if (bodyRect.width < 10 || bodyRect.height < 10) continue;

            const appEls = root.querySelectorAll('a[data-asoch-targets*="ochAppName"], a[data-asoch-targets*="appname" i]');

            for (const el of appEls) {
                const name = el.innerText?.trim();
                if (!name || name.length < 2) continue;

                let storeLink = null;
                const href = el.href;

                if (href) {
                    if (href.includes('play.google.com') || href.includes('apps.apple.com')) {
                        storeLink = href;
                    } else if (href.includes('googleadservices')) {
                        const match = href.match(/[?&]adurl=([^&\s]+)/i);
                        if (match) {
                            try { storeLink = decodeURIComponent(match[1]); } catch (e) { }
                        }
                    }
                }

                if (name && storeLink) {
                    const idMatch = storeLink.match(/id=([a-zA-Z0-9._]+)/);
                    results.push({
                        appName: name,
                        storeLink: storeLink,
                        packageId: idMatch ? idMatch[1] : null,
                        isVideo: true,
                        videoId: null
                    });
                }
            }
        } catch (e) { }
    }

    // Remove duplicates by package ID
    const unique = [];
    const seen = new Set();
    for (const item of results) {
        const key = item.packageId || item.appName;
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(item);
        }
    }

    return unique;
}
