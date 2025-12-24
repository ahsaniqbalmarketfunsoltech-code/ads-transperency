const puppeteer = require('puppeteer');
const { google } = require('googleapis');
const fs = require('fs');

// ============================================
// CONFIGURATION
// ============================================
const SPREADSHEET_ID = '1beJ263B3m4L8pgD9RWsls-orKLUvLMfT2kExaiyNl7g';
const SHEET_NAME = 'Sheet1';
const CREDENTIALS_PATH = './credentials.json';
const CONCURRENT_PAGES = 4; // Reduced for better stealth
const MAX_WAIT_TIME = 90000; // 90 seconds - increased for slow pages
const POST_CLICK_WAIT = 15000; // Give video 15 seconds to load
const MAX_RETRIES = 5; // Increased retry attempts
const RETRY_WAIT_MULTIPLIER = 1.5; // Increase wait time by 1.5x on each retry

// ============================================
// RANDOMIZATION UTILITIES
// ============================================
function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

// Random user agents to avoid detection
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

// Random viewport sizes
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1600, height: 900 },
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getRandomViewport() {
  return VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
}

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
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  
  return sheets;
}

async function getUrlsFromSheet(sheets) {
  // Get both column A (URLs) and column F (existing video IDs)
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:F`,
  });

  const rows = response.data.values || [];
  const urlData = [];
  
  // Skip header row, process each row
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const url = row[0]?.trim();
    const existingVideoId = row[5]?.trim(); // Column F is index 5
    
    // Only include URLs that are not empty and don't have existing video ID
    if (url && !existingVideoId) {
      urlData.push({
        url: url,
        rowIndex: i - 1 // 0-based index for row (excluding header)
      });
    }
  }
  
  return urlData;
}

async function batchWriteToSheet(sheets, updates) {
  if (updates.length === 0) return;
  
  const data = updates.map(({ rowIndex, videoId }) => ({
    range: `${SHEET_NAME}!F${rowIndex + 2}`,
    values: [[videoId]]
  }));

  try {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        valueInputOption: 'RAW',
        data: data
      }
    });
    console.log(`  ✅ Batch wrote ${updates.length} results`);
  } catch (error) {
    console.error(`  ❌ Batch write error:`, error.message);
  }
}

// ============================================
// ENHANCED VIDEO ID EXTRACTOR WITH RANDOMIZATION
// ============================================
async function extractVideoId(url, browser, attempt = 1, baseWaitTime = POST_CLICK_WAIT) {
  const page = await browser.newPage();
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  let videoSourceId = null;
  const videoIdPatterns = [];

  // Set random user agent and viewport for each page
  const userAgent = getRandomUserAgent();
  const viewport = getRandomViewport();
  
  await page.setUserAgent(userAgent);
  await page.setViewport(viewport);
  
  // Add random delay before starting (human-like behavior)
  await sleep(randomDelay(500, 2000));

  // Enhanced network monitoring - check multiple patterns
  await page.setRequestInterception(true);
  
  const checkForVideoId = (requestUrl) => {
    if (!requestUrl) return null;
    
    // Pattern 1: googlevideo.com/videoplayback?id=...
    if (requestUrl.includes('googlevideo.com/videoplayback')) {
      try {
        const urlObj = new URL(requestUrl);
        const id = urlObj.searchParams.get('id');
        if (id && /^[a-f0-9]{16}$/.test(id)) {
          return id;
        }
      } catch (e) {}
    }
    
    // Pattern 2: Check for video ID in URL path
    const pathMatch = requestUrl.match(/\/videoplayback\?[^&]*id=([a-f0-9]{16})/);
    if (pathMatch && pathMatch[1]) {
      return pathMatch[1];
    }
    
    // Pattern 3: Check for video ID in any googlevideo URL
    const generalMatch = requestUrl.match(/[?&]id=([a-f0-9]{16})/);
    if (generalMatch && generalMatch[1] && requestUrl.includes('googlevideo')) {
      return generalMatch[1];
    }
    
    return null;
  };

  page.on('request', (request) => {
    const resourceType = request.resourceType();
    const requestUrl = request.url();
    
    // Check for video ID in ALL requests
    const foundId = checkForVideoId(requestUrl);
    if (foundId) {
      videoSourceId = foundId;
      videoIdPatterns.push({ source: 'request', id: foundId, url: requestUrl });
    }
    
    // Only block large images and fonts - allow everything else
    if (['image', 'font'].includes(resourceType)) {
      request.abort();
      return;
    }
    
    request.continue();
  });

  // Also monitor response events for video IDs
  page.on('response', (response) => {
    const responseUrl = response.url();
    const foundId = checkForVideoId(responseUrl);
    if (foundId) {
      videoSourceId = foundId;
      videoIdPatterns.push({ source: 'response', id: foundId, url: responseUrl });
    }
  });

  try {
    // Random delay before navigation (human-like)
    await sleep(randomDelay(1000, 3000));
    
    // Use networkidle2 for better stability with slow-loading pages
    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: MAX_WAIT_TIME 
    });
    
    // Check page source for video ID before clicking (sometimes it's already there)
    try {
      const pageContent = await page.content();
      const sourceMatches = pageContent.match(/[?&]id=([a-f0-9]{16})/g);
      if (sourceMatches) {
        for (const match of sourceMatches) {
          const idMatch = match.match(/id=([a-f0-9]{16})/);
          if (idMatch && idMatch[1] && /^[a-f0-9]{16}$/.test(idMatch[1])) {
            videoSourceId = idMatch[1];
            videoIdPatterns.push({ source: 'page_source', id: idMatch[1] });
            console.log(`  🔍 Found video ID in page source: ${idMatch[1]}`);
          }
        }
      }
    } catch (e) {
      // Continue if source check fails
    }
    
    // Initial wait - increase on retries with randomization
    const baseInitialWait = 3000 * Math.pow(RETRY_WAIT_MULTIPLIER, attempt - 1);
    const initialWait = baseInitialWait + randomDelay(500, 2000);
    await sleep(initialWait);

    // Enhanced play button detection with multiple strategies
    const playButtonInfo = await page.evaluate(() => {
      const results = { found: false, x: 0, y: 0, strategy: '' };

      // Strategy 1: Look for .play-button class
      const searchForPlayButton = (root) => {
        // Try multiple selectors
        const selectors = [
          '.play-button',
          '[class*="play"]',
          '[class*="Play"]',
          'button[aria-label*="play" i]',
          'button[aria-label*="Play" i]',
          '[role="button"][aria-label*="play" i]',
        ];
        
        for (const selector of selectors) {
          try {
            const playButton = root.querySelector(selector);
            if (playButton) {
              const rect = playButton.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                results.found = true;
                results.x = rect.left + rect.width / 2;
                results.y = rect.top + rect.height / 2;
                results.strategy = `selector: ${selector}`;
                return true;
              }
            }
          } catch (e) {}
        }

        // Check shadow DOM
        const elements = root.querySelectorAll('*');
        for (const el of elements) {
          if (el.shadowRoot) {
            const found = searchForPlayButton(el.shadowRoot);
            if (found) return true;
          }
        }
        return false;
      };

      // Strategy 2: Check iframes
      const iframes = document.querySelectorAll('iframe');
      for (let i = 0; i < iframes.length; i++) {
        try {
          const iframeDoc = iframes[i].contentDocument || iframes[i].contentWindow?.document;
          if (iframeDoc) {
            const found = searchForPlayButton(iframeDoc);
            if (found) {
              results.strategy = 'iframe';
              break;
            }
          }
        } catch (e) {}
      }

      // Strategy 3: Search main document
      if (!results.found) {
        searchForPlayButton(document);
      }

      // Strategy 4: Click on video container/iframe center as fallback
      if (!results.found) {
        const videoElements = document.querySelectorAll('video, iframe, [class*="video"], [id*="video"]');
        for (const el of videoElements) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 100 && rect.height > 100) {
            results.found = true;
            results.x = rect.left + rect.width / 2;
            results.y = rect.top + rect.height / 2;
            results.strategy = 'video_element_center';
            break;
          }
        }
      }

      // Strategy 5: Click center of viewport as last resort
      if (!results.found) {
        results.found = true;
        results.x = window.innerWidth / 2;
        results.y = window.innerHeight / 2;
        results.strategy = 'viewport_center';
      }

      return results;
    });

    if (playButtonInfo.found) {
      // Human-like mouse movement and click with randomization
      const client = await page.target().createCDPSession();
      
      // Add small random offset to click position (more human-like)
      const clickX = playButtonInfo.x + randomDelay(-5, 5);
      const clickY = playButtonInfo.y + randomDelay(-5, 5);
      
      // Move mouse to position with slight curve (human-like)
      const steps = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i <= steps; i++) {
        const progress = i / steps;
        const curveX = clickX + (Math.random() - 0.5) * 10 * (1 - progress);
        const curveY = clickY + (Math.random() - 0.5) * 10 * (1 - progress);
        
        await client.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: Math.round(curveX),
          y: Math.round(curveY)
        });
        await sleep(randomDelay(50, 150));
      }
      
      // Small pause before clicking
      await sleep(randomDelay(100, 300));
      
      // Press mouse button
      await client.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: Math.round(clickX),
        y: Math.round(clickY),
        button: 'left',
        clickCount: 1
      });
      await sleep(randomDelay(50, 150));
      
      // Release mouse button
      await client.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: Math.round(clickX),
        y: Math.round(clickY),
        button: 'left',
        clickCount: 1
      });
      
      console.log(`  🖱️  Clicked using strategy: ${playButtonInfo.strategy}`);
      
      // Wait for video to start - increased wait time on retries with randomization
      const baseWaitTime = POST_CLICK_WAIT * Math.pow(RETRY_WAIT_MULTIPLIER, attempt - 1);
      const waitTime = baseWaitTime + randomDelay(2000, 5000);
      
      // Monitor for video ID during wait period
      const checkInterval = 2000;
      const maxChecks = Math.ceil(waitTime / checkInterval);
      
      for (let check = 0; check < maxChecks; check++) {
        await sleep(checkInterval);
        
        // Check if we already found the ID
        if (videoSourceId) {
          console.log(`  ✅ Video ID found during wait: ${videoSourceId}`);
          break;
        }
        
        // Try to extract from page source periodically
        try {
          const pageContent = await page.content();
          const sourceMatches = pageContent.match(/[?&]id=([a-f0-9]{16})/g);
          if (sourceMatches) {
            for (const match of sourceMatches) {
              const idMatch = match.match(/id=([a-f0-9]{16})/);
              if (idMatch && idMatch[1] && /^[a-f0-9]{16}$/.test(idMatch[1])) {
                videoSourceId = idMatch[1];
                videoIdPatterns.push({ source: 'page_source_after_click', id: idMatch[1] });
                console.log(`  🔍 Found video ID in page source after click: ${idMatch[1]}`);
                break;
              }
            }
          }
        } catch (e) {}
        
        if (videoSourceId) break;
      }
    }

    // Final check: Try to extract from page source one more time
    if (!videoSourceId) {
      try {
        const pageContent = await page.content();
        const sourceMatches = pageContent.match(/[?&]id=([a-f0-9]{16})/g);
        if (sourceMatches) {
          for (const match of sourceMatches) {
            const idMatch = match.match(/id=([a-f0-9]{16})/);
            if (idMatch && idMatch[1] && /^[a-f0-9]{16}$/.test(idMatch[1])) {
              videoSourceId = idMatch[1];
              videoIdPatterns.push({ source: 'final_page_source', id: idMatch[1] });
            }
          }
        }
      } catch (e) {}
    }

    await page.close();
    return videoSourceId;
  } catch (err) {
    console.error(`  ❌ Error (attempt ${attempt}): ${err.message}`);
    await page.close();
    return null;
  }
}

// Retry wrapper function with randomization
async function extractVideoIdWithRetry(url, browser, rowIndex) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) {
      console.log(`  🔄 [${rowIndex + 1}] Retry attempt ${attempt}/${MAX_RETRIES}...`);
    }
    
    const videoId = await extractVideoId(url, browser, attempt, POST_CLICK_WAIT);
    
    if (videoId) {
      if (attempt > 1) {
        console.log(`  ✅ [${rowIndex + 1}] Video ID found on attempt ${attempt}: ${videoId}`);
      }
      return videoId;
    }
    
    if (attempt < MAX_RETRIES) {
      // Wait before retrying (exponential backoff with randomization)
      const baseRetryDelay = 3000 * Math.pow(2, attempt - 1);
      const retryDelay = baseRetryDelay + randomDelay(1000, 3000);
      console.log(`  ⏳ [${rowIndex + 1}] Waiting ${(retryDelay / 1000).toFixed(1)}s before retry...`);
      await new Promise(r => setTimeout(r, retryDelay));
    }
  }
  
  return null;
}

// ============================================
// CONCURRENT PROCESSING WITH RANDOMIZATION
// ============================================
async function processUrlBatch(urlData, startIndex, browser) {
  // Process with slight staggered start (more human-like, less suspicious)
  const results = await Promise.all(
    urlData.map(async (item, i) => {
      const actualIndex = startIndex + i;
      const rowIndex = item.rowIndex;
      const url = item.url;
      
      // Stagger the start of each URL processing (random delay)
      const staggerDelay = randomDelay(0, 2000);
      if (staggerDelay > 0) {
        await new Promise(r => setTimeout(r, staggerDelay));
      }
      
      console.log(`[${rowIndex + 1}] Processing: ${url.substring(0, 60)}...`);
      
      const videoId = await extractVideoIdWithRetry(url, browser, rowIndex);
      
      if (videoId) {
        console.log(`  ✅ [${rowIndex + 1}] Video ID: ${videoId}`);
        return { rowIndex: rowIndex, videoId };
      } else {
        console.log(`  ⚠️  [${rowIndex + 1}] No video ID found after ${MAX_RETRIES} attempts`);
        return { rowIndex: rowIndex, videoId: 'NOT_FOUND' };
      }
    })
  );
  
  return results;
}

// ============================================
// MAIN FUNCTION
// ============================================
(async () => {
  console.log('📊 Starting BALANCED Google Sheets + Puppeteer Integration...\n');
  const startTime = Date.now();

  const sheets = await getGoogleSheetsClient();
  console.log('✅ Connected to Google Sheets\n');

  const urlData = await getUrlsFromSheet(sheets);
  console.log(`📋 Found ${urlData.length} URLs to process (skipping already scraped)\n`);

  if (urlData.length === 0) {
    console.log('⚠️  No URLs found to process (all may already be scraped)');
    process.exit(0);
  }

  // Launch browser with enhanced stealth features
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
      '--lang=en-US,en',
    ]
  });

  console.log(`🌐 Browser launched with stealth features`);
  console.log(`📊 Processing ${CONCURRENT_PAGES} URLs at a time with randomization\n`);

  // Process URLs in batches with random delays
  const allResults = [];
  const totalBatches = Math.ceil(urlData.length / CONCURRENT_PAGES);
  
  for (let i = 0; i < urlData.length; i += CONCURRENT_PAGES) {
    const batch = urlData.slice(i, i + CONCURRENT_PAGES);
    const batchNumber = Math.floor(i / CONCURRENT_PAGES) + 1;
    
    console.log(`\n📦 Processing batch ${batchNumber}/${totalBatches}`);
    
    // Random delay between batches (human-like behavior)
    if (i > 0) {
      const batchDelay = randomDelay(3000, 8000);
      console.log(`⏳ Waiting ${(batchDelay / 1000).toFixed(1)}s before next batch (anti-detection)...`);
      await new Promise(r => setTimeout(r, batchDelay));
    }
    
    const batchResults = await processUrlBatch(batch, i, browser);
    allResults.push(...batchResults);
    
    // Batch write to sheet
    await batchWriteToSheet(sheets, batchResults);
    
    // Small delay after writing
    await new Promise(r => setTimeout(r, randomDelay(500, 1500)));
  }

  await browser.close();
  
  const endTime = Date.now();
  const totalTime = ((endTime - startTime) / 1000).toFixed(2);
  const avgTime = (totalTime / urlData.length).toFixed(2);
  
  console.log('\n✨ All done!');
  console.log(`⏱️  Total time: ${totalTime}s`);
  console.log(`⏱️  Average per URL: ${avgTime}s`);
  console.log(`✅ Found: ${allResults.filter(r => r.videoId !== 'NOT_FOUND').length}`);
  console.log(`❌ Not found: ${allResults.filter(r => r.videoId === 'NOT_FOUND').length}`);
  
  process.exit(0);
})();