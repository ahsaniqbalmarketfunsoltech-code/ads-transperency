// ========================================
// Google Ads Extractor Pro - Content Script
// Runs on Google Ads Transparency pages
// ========================================

(function () {
    'use strict';

    // Add floating extract button to the page
    function addFloatingButton() {
        if (document.getElementById('gads-extractor-fab')) return;

        const fab = document.createElement('div');
        fab.id = 'gads-extractor-fab';
        fab.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <polyline points="7,10 12,15 17,10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
        fab.title = 'Extract Ad Data';
        document.body.appendChild(fab);

        fab.addEventListener('click', () => {
            // Open the extension popup
            chrome.runtime.sendMessage({ type: 'openPopup' });

            // Show quick result
            const data = quickExtract();
            showQuickToast(data);
        });
    }

    // Quick extract without opening popup
    function quickExtract() {
        const result = {
            appName: 'NOT_FOUND',
            storeLink: 'NOT_FOUND'
        };

        const iframes = document.querySelectorAll('iframe');

        for (const iframe of iframes) {
            try {
                const rect = iframe.getBoundingClientRect();
                if (rect.width < 50 || rect.height < 50) continue;

                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                const root = iframeDoc.querySelector('#portrait-landscape-phone') || iframeDoc.body;

                const appEls = root.querySelectorAll('a[data-asoch-targets*="ochAppName"], a[data-asoch-targets*="appname" i]');

                for (const el of appEls) {
                    const name = el.innerText?.trim();
                    if (!name || name.length < 2) continue;

                    const href = el.href;
                    if (href && (href.includes('play.google.com') || href.includes('googleadservices'))) {
                        result.appName = name;

                        // Extract real link
                        if (href.includes('googleadservices')) {
                            const match = href.match(/[?&]adurl=([^&\s]+)/i);
                            if (match) {
                                try { result.storeLink = decodeURIComponent(match[1]); } catch (e) { }
                            }
                        } else {
                            result.storeLink = href;
                        }
                        break;
                    }
                }

                if (result.storeLink !== 'NOT_FOUND') break;
            } catch (e) { }
        }

        return result;
    }

    function showQuickToast(data) {
        const existing = document.getElementById('gads-quick-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'gads-quick-toast';
        toast.innerHTML = `
      <div class="gads-toast-header">
        <span>✅ Extracted!</span>
        <button class="gads-toast-close">×</button>
      </div>
      <div class="gads-toast-content">
        <div class="gads-toast-row">
          <span class="gads-toast-label">App:</span>
          <span class="gads-toast-value">${data.appName}</span>
        </div>
        <div class="gads-toast-row">
          <span class="gads-toast-label">Link:</span>
          <span class="gads-toast-value gads-toast-link" data-link="${data.storeLink}">
            ${data.storeLink !== 'NOT_FOUND' ? '📋 Click to copy' : 'Not found'}
          </span>
        </div>
      </div>
    `;
        document.body.appendChild(toast);

        // Close button
        toast.querySelector('.gads-toast-close').addEventListener('click', () => toast.remove());

        // Copy link
        const linkEl = toast.querySelector('.gads-toast-link');
        if (data.storeLink !== 'NOT_FOUND') {
            linkEl.addEventListener('click', () => {
                navigator.clipboard.writeText(data.storeLink);
                linkEl.textContent = '✓ Copied!';
                setTimeout(() => linkEl.textContent = '📋 Click to copy', 1500);
            });
        }

        // Auto-hide after 10 seconds
        setTimeout(() => toast.remove(), 10000);
    }

    // Initialize when page loads
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addFloatingButton);
    } else {
        addFloatingButton();
    }

    // Re-add on navigation (SPA)
    const observer = new MutationObserver(() => {
        if (!document.getElementById('gads-extractor-fab')) {
            addFloatingButton();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();
