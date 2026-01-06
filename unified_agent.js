/**
 * UNIFIED GOOGLE ADS TRANSPARENCY AGENT
 * =====================================
 * Combines app data extraction + video ID extraction in ONE visit.
 * 
 * Sheet Structure:
 *   Column A: Advertiser Name (manual input or extracted)
 *   Column B: Ads URL (the Google Ads Transparency link to scrape)
 *   Column C: App Link (Play Store / App Store link)
 *   Column D: App Name
 *   Column E: Video ID
 * 
 * Logic:
 *   1. If C & D are empty → Extract metadata (App Link + App Name)
 *   2. If C has a valid store link AND E is empty → Extract Video ID
 *   3. If C is "NOT_FOUND" → Skip video extraction (it's a text ad)
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const { google } = require('googleapis');
const fs = require('fs');

// ============================================
// CONFIGURATION
// ============================================
const SPREADSHEET_ID = '1l4JpCcA1GSkta1CE77WxD_YCgePHI87K7NtMu1Sd4Q0';
const SHEET_NAME = 'Sheet1'; // Your new unified sheet
const CREDENTIALS_PATH = './credentials.json';
const CONCURRENT_PAGES = parseInt(process.env.CONCURRENT_PAGES) || 2;
const MAX_WAIT_TIME = 60000;
const MAX_RETRIES = 3;
const VIDEO_WAIT_TIME = 12000; // Time to wait for video to load after clicking play
const RETRY_WAIT_MULTIPLIER = 1.5;

// Batch delay range (in ms)
const BATCH_DELAY_MIN = parseInt(process.env.BATCH_DELAY_MIN) || 5000;
const BATCH_DELAY_MAX = parseInt(process.env.BATCH_DELAY_MAX) || 12000;

// Anti-detection: Rotating User Agents
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

// Anti-detection: Random viewport sizes
const VIEWPORTS = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
    { width: 1280, height: 720 }
];

// Helper functions
const randomDelay = (min, max) => new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ============================================
// GOOGLE SHEETS SETUP
// ============================================
async function getGoogleSheetsClient() {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const authClient = await auth.getClient();
    return google.sheets({ version: 'v4', auth: authClient });
}

async function getUrlData(sheets) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A:E`, // A=Advertiser, B=URL, C=App Link, D=App Name, E=Video ID
    });
    const rows = response.data.values || [];
    const toProcess = [];

    // Skip header row (index 0)
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const advertiserName = row[0]?.trim() || ''; // Column A - Advertiser Name
        const url = row[1]?.trim() || '';             // Column B - Ads URL
        const storeLink = row[2]?.trim() || '';       // Column C - App Link
        const appName = row[3]?.trim() || '';         // Column D - App Name
        const videoId = row[4]?.trim() || '';         // Column E - Video ID

        if (!url) continue; // Skip rows without URL in Column B

        // Determine what needs to be extracted
        const needsMetadata = !storeLink || !appName;
        const hasValidStoreLink = storeLink &&
            storeLink !== 'NOT_FOUND' &&
            (storeLink.includes('play.google.com') || storeLink.includes('apps.apple.com'));
        const needsVideoId = hasValidStoreLink && !videoId;

        // Only add to processing queue if something needs to be done
        if (needsMetadata || needsVideoId) {
            toProcess.push({
                url,
                rowIndex: i,
                needsMetadata,
                needsVideoId,
                existingStoreLink: storeLink,
                existingAppName: appName,
                advertiserName
            });
        }
    }

    return toProcess;
}

async function batchWriteToSheet(sheets, updates) {
    if (updates.length === 0) return;

    const data = [];
    updates.forEach(({ rowIndex, storeLink, appName, videoId }) => {
        const rowNum = rowIndex + 1; // 1-indexed for Sheets

        // Column C = App Link
        if (storeLink && storeLink !== 'SKIP') {
            data.push({
                range: `${SHEET_NAME}!C${rowNum}`,
                values: [[storeLink]]
            });
        }
        // Column D = App Name
        if (appName && appName !== 'SKIP') {
            data.push({
                range: `${SHEET_NAME}!D${rowNum}`,
                values: [[appName]]
            });
        }
        // Column E = Video ID
        if (videoId && videoId !== 'SKIP') {
            data.push({
                range: `${SHEET_NAME}!E${rowNum}`,
                values: [[videoId]]
            });
        }
    });

    if (data.length === 0) return;

    try {
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: { valueInputOption: 'RAW', data: data }
        });
        console.log(`  ✅ Wrote ${updates.length} results to sheet`);
    } catch (error) {
        console.error(`  ❌ Write error:`, error.message);
    }
}

// ============================================
// SELF-RESTART LOGIC
// ============================================
async function triggerSelfRestart() {
    const repo = process.env.GITHUB_REPOSITORY;
    const token = process.env.GH_TOKEN;
    if (!repo || !token) return;

    console.log(`\n🔄 Triggering auto-restart...`);
    const https = require('https');
    const data = JSON.stringify({ event_type: 'unified_agent_trigger' });
    const options = {
        hostname: 'api.github.com',
        port: 443,
        path: `/repos/${repo}/dispatches`,
        method: 'POST',
        headers: {
            'Authorization': `token ${token}`,
            'User-Agent': 'Node.js',
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    };
    const req = https.request(options);
    req.write(data);
    req.end();
}

// ============================================
// UNIFIED EXTRACTION LOGIC
// ============================================
async function extractAllData(url, browser, needsMetadata, needsVideoId, existingStoreLink) {
    const page = await browser.newPage();
    let result = {
        storeLink: needsMetadata ? 'NOT_FOUND' : 'SKIP',
        appName: needsMetadata ? 'NOT_FOUND' : 'SKIP',
        videoId: 'SKIP'
    };
    let capturedVideoId = null;

    // ANTI-DETECTION: Random User-Agent and viewport
    const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    const viewport = VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
    await page.setUserAgent(userAgent);
    await page.setViewport(viewport);

    // ANTI-DETECTION: Mask webdriver property
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        window.chrome = { runtime: {} };
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    // Network listener for Video ID (from agent.js)
    await page.setRequestInterception(true);
    page.on('request', (request) => {
        const reqUrl = request.url();
        if (reqUrl.includes('googlevideo.com/videoplayback')) {
            const urlParams = new URLSearchParams(reqUrl.split('?')[1]);
            const id = urlParams.get('id');
            if (id && /^[a-f0-9]{16}$/.test(id)) {
                capturedVideoId = id;
            }
        }
        // Block heavy resources to speed up loading
        const resourceType = request.resourceType();
        if (['image', 'font'].includes(resourceType)) {
            request.abort();
        } else {
            request.continue();
        }
    });

    try {
        console.log(`  🚀 Loading (${viewport.width}x${viewport.height}): ${url.substring(0, 60)}...`);
        await randomDelay(1000, 2000);
        await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });

        const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: MAX_WAIT_TIME });

        // Block detection
        const content = await page.content();
        if ((response && response.status && response.status() === 429) ||
            content.includes('Our systems have detected unusual traffic') ||
            content.includes('Too Many Requests') ||
            content.toLowerCase().includes('captcha')) {
            console.error('  ⚠️ BLOCKED: Google is detecting unusual traffic.');
            await page.close();
            return { storeLink: 'BLOCKED', appName: 'BLOCKED', videoId: 'BLOCKED' };
        }

        await randomDelay(2000, 4000);

        // Human-like scrolling
        await page.evaluate(async () => {
            const randomScroll = 600 + Math.random() * 400;
            window.scrollBy(0, randomScroll);
            await new Promise(r => setTimeout(r, 300 + Math.random() * 400));
            window.scrollBy(0, -randomScroll / 2);
        });

        // =====================================================
        // PHASE 1: METADATA EXTRACTION (App Link + App Name)
        // =====================================================
        if (needsMetadata) {
            console.log(`  📊 Extracting metadata...`);

            // Get blacklist name (advertiser name) to avoid confusion
            const blacklistName = await page.evaluate(() => {
                const topTitle = document.querySelector('h1, .advertiser-name');
                return topTitle ? topTitle.innerText.trim().toLowerCase() : '';
            });

            // Extract from frames (visibility-aware logic from app_data_agent.js)
            const frames = page.frames();
            for (const frame of frames) {
                try {
                    const frameData = await frame.evaluate((blacklist) => {
                        const data = { appName: null, storeLink: null };
                        const root = document.querySelector('#portrait-landscape-phone') || document.body;

                        // Check if this frame is actually visible
                        const bodyRect = document.body.getBoundingClientRect();
                        if (bodyRect.width < 50 || bodyRect.height < 50) {
                            return { ...data, isHidden: true };
                        }

                        // Store link extraction with strict validation
                        const extractStoreLink = (href) => {
                            if (!href || typeof href !== 'string') return null;
                            if (href.includes('javascript:') || href === '#') return null;

                            const isValidStoreLink = (url) => {
                                if (!url) return false;
                                const isPlayStore = url.includes('play.google.com/store/apps') && url.includes('id=');
                                const isAppStore = (url.includes('apps.apple.com') || url.includes('itunes.apple.com')) && url.includes('/app/');
                                return isPlayStore || isAppStore;
                            };

                            if (isValidStoreLink(href)) return href;

                            // Extract from redirect URLs
                            if (href.includes('googleadservices.com') || href.includes('/pagead/aclk')) {
                                try {
                                    const patterns = [/[?&]adurl=([^&\s]+)/i, /[?&]dest=([^&\s]+)/i, /[?&]url=([^&\s]+)/i];
                                    for (const pattern of patterns) {
                                        const match = href.match(pattern);
                                        if (match && match[1]) {
                                            const decoded = decodeURIComponent(match[1]);
                                            if (isValidStoreLink(decoded)) return decoded;
                                        }
                                    }
                                } catch (e) { }
                            }

                            // Direct regex match
                            try {
                                const playMatch = href.match(/(https?:\/\/play\.google\.com\/store\/apps\/details\?id=[a-zA-Z0-9._]+)/);
                                if (playMatch && playMatch[1]) return playMatch[1];
                                const appMatch = href.match(/(https?:\/\/(apps|itunes)\.apple\.com\/[^\s&"']+\/app\/[^\s&"']+)/);
                                if (appMatch && appMatch[1]) return appMatch[1];
                            } catch (e) { }

                            return null;
                        };

                        // Clean app name
                        const cleanAppName = (text) => {
                            if (!text || typeof text !== 'string') return null;
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
                            if (clean.length < 2) return null;
                            if (/^[\d\s\W]+$/.test(clean)) return null;
                            return clean;
                        };

                        // Try app name selectors
                        const appNameSelectors = [
                            'a[data-asoch-targets*="ochAppName"]',
                            'a[data-asoch-targets*="appname" i]',
                            'a[class*="short-app-name"]',
                            '.short-app-name a'
                        ];

                        for (const selector of appNameSelectors) {
                            const elements = root.querySelectorAll(selector);
                            for (const el of elements) {
                                const rawName = el.innerText || el.textContent || '';
                                const appName = cleanAppName(rawName);
                                if (!appName || appName.toLowerCase() === blacklist) continue;

                                const storeLink = extractStoreLink(el.href);
                                if (appName && storeLink) {
                                    return { appName, storeLink, isHidden: false };
                                } else if (appName && !data.appName) {
                                    data.appName = appName;
                                }
                            }
                        }

                        // Backup: Install button for link
                        if (data.appName && !data.storeLink) {
                            const installSels = [
                                'a[data-asoch-targets*="ochButton"]',
                                'a[data-asoch-targets*="Install" i]',
                                'a[aria-label*="Install" i]'
                            ];
                            for (const sel of installSels) {
                                const el = root.querySelector(sel);
                                if (el && el.href) {
                                    const storeLink = extractStoreLink(el.href);
                                    if (storeLink) {
                                        data.storeLink = storeLink;
                                        break;
                                    }
                                }
                            }
                        }

                        data.isHidden = false;
                        return data;
                    }, blacklistName);

                    if (frameData.isHidden) continue;

                    // Update result if we found complete data
                    if (frameData.appName && frameData.storeLink && result.storeLink === 'NOT_FOUND') {
                        result.appName = frameData.appName;
                        result.storeLink = frameData.storeLink;
                        console.log(`  ✓ Found: ${result.appName} -> ${result.storeLink.substring(0, 50)}...`);
                        break;
                    }

                    // Store partial results
                    if (frameData.appName && result.appName === 'NOT_FOUND') {
                        result.appName = frameData.appName;
                    }
                    if (frameData.storeLink && result.storeLink === 'NOT_FOUND') {
                        result.storeLink = frameData.storeLink;
                    }
                } catch (e) { }
            }

            // Clean up store link if it contains redirect
            if (result.storeLink !== 'NOT_FOUND' && result.storeLink.includes('adurl=')) {
                try {
                    const urlObj = new URL(result.storeLink);
                    const adUrl = urlObj.searchParams.get('adurl');
                    if (adUrl && adUrl.startsWith('http')) result.storeLink = adUrl;
                } catch (e) { }
            }
        }

        // =====================================================
        // PHASE 2: VIDEO ID EXTRACTION
        // =====================================================
        // Determine if we should try to get video ID
        const finalStoreLink = result.storeLink !== 'SKIP' ? result.storeLink : existingStoreLink;
        const hasValidLink = finalStoreLink &&
            finalStoreLink !== 'NOT_FOUND' &&
            (finalStoreLink.includes('play.google.com') || finalStoreLink.includes('apps.apple.com'));

        if (needsVideoId || (needsMetadata && hasValidLink)) {
            console.log(`  🎬 Attempting to extract Video ID...`);

            // Find and click play button (logic from agent.js)
            const playButtonInfo = await page.evaluate(() => {
                const results = { found: false, x: 0, y: 0 };

                const searchForPlayButton = (root) => {
                    const playButton = root.querySelector('.play-button');
                    if (playButton) {
                        const rect = playButton.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            results.found = true;
                            results.x = rect.left + rect.width / 2;
                            results.y = rect.top + rect.height / 2;
                            return true;
                        }
                    }
                    const elements = root.querySelectorAll('*');
                    for (const el of elements) {
                        if (el.shadowRoot) {
                            const found = searchForPlayButton(el.shadowRoot);
                            if (found) return true;
                        }
                    }
                    return false;
                };

                // Search in iframes first
                const iframes = document.querySelectorAll('iframe');
                for (let i = 0; i < iframes.length; i++) {
                    try {
                        const iframeDoc = iframes[i].contentDocument || iframes[i].contentWindow?.document;
                        if (iframeDoc) {
                            const found = searchForPlayButton(iframeDoc);
                            if (found) break;
                        }
                    } catch (e) { }
                }

                // Fallback to main document
                if (!results.found) searchForPlayButton(document);

                // Fallback: Click center of visible iframe
                if (!results.found) {
                    for (const iframe of iframes) {
                        const rect = iframe.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            results.found = true;
                            results.x = rect.left + rect.width / 2;
                            results.y = rect.top + rect.height / 2;
                            break;
                        }
                    }
                }

                return results;
            });

            if (playButtonInfo.found) {
                try {
                    const client = await page.target().createCDPSession();
                    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: playButtonInfo.x, y: playButtonInfo.y });
                    await sleep(100);
                    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: playButtonInfo.x, y: playButtonInfo.y, button: 'left', clickCount: 1 });
                    await sleep(80);
                    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: playButtonInfo.x, y: playButtonInfo.y, button: 'left', clickCount: 1 });

                    // Wait for video to load
                    await sleep(VIDEO_WAIT_TIME);

                    if (capturedVideoId) {
                        result.videoId = capturedVideoId;
                        console.log(`  ✓ Video ID: ${capturedVideoId}`);
                    } else {
                        result.videoId = 'NOT_FOUND';
                        console.log(`  ⚠️ No video ID captured (might be text ad)`);
                    }
                } catch (e) {
                    console.log(`  ⚠️ Click failed: ${e.message}`);
                    result.videoId = 'NOT_FOUND';
                }
            } else {
                // No play button = likely a text ad
                result.videoId = hasValidLink ? 'NOT_FOUND' : 'SKIP';
            }
        }

        await page.close();
        return result;
    } catch (err) {
        console.error(`  ❌ Error: ${err.message}`);
        await page.close();
        return { storeLink: 'ERROR', appName: 'ERROR', videoId: 'ERROR' };
    }
}

async function extractWithRetry(item, browser) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 1) console.log(`  🔄 Retry attempt ${attempt}/${MAX_RETRIES}...`);

        const data = await extractAllData(
            item.url,
            browser,
            item.needsMetadata,
            item.needsVideoId,
            item.existingStoreLink
        );

        if (data.storeLink === 'BLOCKED') return data;

        // Success if we got something useful
        const gotMetadata = !item.needsMetadata || (data.storeLink !== 'NOT_FOUND' || data.appName !== 'NOT_FOUND');
        const gotVideoId = !item.needsVideoId || data.videoId !== 'NOT_FOUND';

        if (gotMetadata || gotVideoId) return data;

        await randomDelay(2000, 4000);
    }
    return { storeLink: 'NOT_FOUND', appName: 'NOT_FOUND', videoId: 'NOT_FOUND' };
}

// ============================================
// MAIN EXECUTION
// ============================================
(async () => {
    console.log(`🤖 Starting UNIFIED Google Ads Agent...\n`);
    console.log(`📋 Sheet: ${SHEET_NAME}`);
    console.log(`⚡ Columns: A=Advertiser Name, B=Ads URL, C=App Link, D=App Name, E=Video ID\n`);

    const sessionStartTime = Date.now();
    const MAX_RUNTIME = 330 * 60 * 1000; // 5.5 hours

    const sheets = await getGoogleSheetsClient();
    const toProcess = await getUrlData(sheets);

    if (toProcess.length === 0) {
        console.log('✨ All rows are complete. Nothing to process.');
        process.exit(0);
    }

    // Log summary
    const needsMeta = toProcess.filter(x => x.needsMetadata).length;
    const needsVideo = toProcess.filter(x => x.needsVideoId).length;
    console.log(`📊 Found ${toProcess.length} rows to process:`);
    console.log(`   - ${needsMeta} need metadata extraction`);
    console.log(`   - ${needsVideo} need video ID extraction\n`);

    const browser = await puppeteer.launch({
        headless: true,
        defaultViewport: { width: 1920, height: 1080 },
        args: [
            '--autoplay-policy=no-user-gesture-required',
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ]
    });

    console.log(`🌐 Browser launched - Processing ${CONCURRENT_PAGES} URLs at a time\n`);

    for (let i = 0; i < toProcess.length; i += CONCURRENT_PAGES) {
        // Check for timeout
        if (Date.now() - sessionStartTime > MAX_RUNTIME) {
            console.log('\n⏰ Reached time limit. Saving and restarting...');
            await browser.close();
            await triggerSelfRestart();
            process.exit(0);
        }

        const batch = toProcess.slice(i, i + CONCURRENT_PAGES);
        console.log(`📦 Batch ${Math.floor(i / CONCURRENT_PAGES) + 1}/${Math.ceil(toProcess.length / CONCURRENT_PAGES)}`);

        const results = await Promise.all(batch.map(async (item) => {
            const data = await extractWithRetry(item, browser);
            return {
                rowIndex: item.rowIndex,
                storeLink: data.storeLink,
                appName: data.appName,
                videoId: data.videoId
            };
        }));

        // Check for blocks
        if (results.some(r => r.storeLink === 'BLOCKED')) {
            console.log('🛑 Block detected. Restarting to get fresh IP...');
            await browser.close();
            await triggerSelfRestart();
            process.exit(0);
        }

        // Debug output
        results.forEach(r => {
            console.log(`  → Row ${r.rowIndex + 1}: Link=${r.storeLink?.substring(0, 40) || 'SKIP'}... | Name=${r.appName} | VideoID=${r.videoId}`);
        });

        await batchWriteToSheet(sheets, results);

        // Random delay between batches
        const batchDelay = BATCH_DELAY_MIN + Math.random() * (BATCH_DELAY_MAX - BATCH_DELAY_MIN);
        console.log(`  ⏳ Waiting ${Math.round(batchDelay / 1000)}s before next batch...\n`);
        await new Promise(r => setTimeout(r, batchDelay));
    }

    await browser.close();

    // Re-check for new data
    const remaining = await getUrlData(sheets);
    if (remaining.length > 0) {
        console.log(`📈 ${remaining.length} more rows found. Restarting...`);
        await triggerSelfRestart();
    }

    console.log('\n🏁 Unified workflow complete.');
    process.exit(0);
})();
