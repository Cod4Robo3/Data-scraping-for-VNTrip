// ============================================================
//  GOOGLE MAPS SCRAPER - Playwright-based
// ============================================================

import { chromium } from 'playwright';
import { sleep, randomDelay, ratingToPopularity, parseWeeklyHours,
         makeOpeningHours, parseHours, isInBbox, log, toSnakeId } from './utils.js';
import { DELAY, SCRAPE, TYPE_MAP, DEFAULT_TAGS } from './config.js';

/** Mở browser Playwright với stealth settings */
export async function launchBrowser() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    ],
  });
  const context = await browser.newContext({
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    viewport: { width: 1280, height: 720 },
    extraHTTPHeaders: { 'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8' },
  });
  // Ẩn webdriver flag
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  return { browser, context };
}

/**
 * Tìm kiếm 1 POI trên Google Maps theo tên + tỉnh
 * Returns enriched data object hoặc null nếu không tìm thấy
 */
export async function searchPoi(context, poi, provinceName) {
  const page = await context.newPage();
  let result = null;

  try {
    const query = encodeURIComponent(`${poi.name} ${provinceName} Vietnam`);
    const url = `https://www.google.com/maps/search/${query}`;
    log('INFO', `Searching: "${poi.name}" (${poi.province_id})`);

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await randomDelay(2000, 4000);

    // Kiểm tra có kết quả không
    const firstResult = page.locator('[data-result-index="0"], .Nv2PK, [role="article"]').first();
    const hasResults = await firstResult.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasResults) {
      await firstResult.click();
      await randomDelay(2000, 3000);
    }

    // Lấy tọa độ từ URL
    const currentUrl = page.url();
    const coords = extractCoordsFromUrl(currentUrl);

    // Lấy tên địa điểm để verify
    const nameEl = await page.locator('h1.DUwDvf, h1[class*="fontHeadlineLarge"]').first();
    const foundName = await nameEl.textContent({ timeout: 5000 }).catch(() => null);

    // Lấy rating
    const ratingEl = await page.locator('[class*="fontDisplayLarge"], span.MW4etd').first();
    const ratingText = await ratingEl.textContent({ timeout: 3000 }).catch(() => null);
    const rating = ratingText ? parseFloat(ratingText.replace(',', '.')) : null;

    // Lấy giờ mở cửa
    const hoursData = await extractOpeningHours(page);

    // Lấy giá (nếu có)
    const price = await extractPrice(page, poi.type);

    // Lấy địa chỉ để verify tỉnh
    const addressEl = await page.locator('[data-item-id="address"] .Io6YTe, button[data-item-id="address"]').first();
    const address = await addressEl.textContent({ timeout: 3000 }).catch(() => null);

    // Lấy Google Maps URL làm source
    const shareUrl = await extractShareUrl(page) || currentUrl;

    result = {
      lat: coords?.lat ?? null,
      lon: coords?.lon ?? null,
      opening_hours: hoursData,
      price_vnd: price,
      popularity: ratingToPopularity(rating),
      source: shareUrl,
      last_verified: SCRAPE.today,
      _foundName: foundName,
      _address: address,
      _rating: rating,
    };

    log('INFO', `  → Found: lat=${result.lat}, lon=${result.lon}, rating=${rating}, price=${price}`);

  } catch (err) {
    log('WARN', `  → Error scraping "${poi.name}": ${err.message}`);
  } finally {
    await page.close();
  }

  return result;
}

/** Extract lat/lon từ Google Maps URL */
function extractCoordsFromUrl(url) {
  // Format: @lat,lon,zoom  hoặc  !3dlat!4dlon
  const atMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) return { lat: parseFloat(atMatch[1]), lon: parseFloat(atMatch[2]) };

  const dMatch = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (dMatch) return { lat: parseFloat(dMatch[1]), lon: parseFloat(dMatch[2]) };

  return null;
}

/** Extract opening hours từ Google Maps page */
async function extractOpeningHours(page) {
  try {
    // Tìm nút "Giờ hoạt động" hoặc "Hours"
    const hoursBtn = page.locator('[data-item-id*="oh"], [aria-label*="hours" i], [aria-label*="giờ" i]').first();
    const hasHours = await hoursBtn.isVisible({ timeout: 3000 }).catch(() => false);

    if (hasHours) {
      // Click để expand giờ hoạt động
      await hoursBtn.click().catch(() => {});
      await sleep(1000);
    }

    // Lấy text từ bảng giờ
    const hoursRows = await page.locator('table.eK4R0e tr, [data-item-id*="oh"] tr').allTextContents().catch(() => []);
    if (hoursRows.length > 0) {
      return parseWeeklyHours(hoursRows);
    }

    // Fallback: lấy từ aria-label của section giờ
    const hoursSection = await page.locator('[aria-label*="8:00" i], [data-hide-tooltip]').first().textContent({ timeout: 2000 }).catch(() => null);
    if (hoursSection) {
      const parsed = parseHours(hoursSection);
      if (parsed) return makeOpeningHours(parsed);
    }

    return null;
  } catch {
    return null;
  }
}

/** Extract giá từ Google Maps page theo type POI */
async function extractPrice(page, type) {
  try {
    // Tìm giá vé / giá phòng / giá trung bình
    const priceSelectors = [
      '[data-attrid*="price"], [aria-label*="price" i]',
      '[jsname*="price"], .price',
      '[data-item-id*="price"]',
    ];

    for (const sel of priceSelectors) {
      const el = page.locator(sel).first();
      const visible = await el.isVisible({ timeout: 2000 }).catch(() => false);
      if (visible) {
        const text = await el.textContent();
        const price = extractPriceNumber(text);
        if (price !== null) return price;
      }
    }

    // Fallback: search trong toàn bộ text của page
    const pageText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    const priceMatch = pageText.match(/(\d{1,3}(?:[.,]\d{3})*)\s*(?:vnđ|vnd|đ|₫)/i);
    if (priceMatch) {
      return extractPriceNumber(priceMatch[0]);
    }

    return null;
  } catch {
    return null;
  }
}

/** Trích xuất số tiền VND từ chuỗi */
function extractPriceNumber(text) {
  if (!text) return null;
  const cleaned = text.replace(/[.,\s]/g, '').replace(/[^\d]/g, '');
  if (!cleaned) return null;
  const num = parseInt(cleaned);
  // Sanity check: giá hợp lý 1,000 - 50,000,000 VND
  if (num < 1000 || num > 50000000) return null;
  return num;
}

/** Lấy share URL ngắn của địa điểm */
async function extractShareUrl(page) {
  try {
    const shareBtn = page.locator('[data-share-url], [aria-label*="Share" i], [aria-label*="Chia sẻ" i]').first();
    const hasShare = await shareBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (!hasShare) return page.url();

    // Lấy URL hiện tại với format ngắn hơn
    return page.url().split('?')[0];
  } catch {
    return null;
  }
}

/**
 * Auto-discover POIs cho 1 tỉnh chưa có data
 * Returns array của POI objects theo schema
 */
export async function discoverPois(context, province, searchQuery) {
  const page = await context.newPage();
  const discovered = [];

  try {
    const query = encodeURIComponent(searchQuery);
    const url = `https://www.google.com/maps/search/${query}`;
    log('INFO', `Discovering: "${searchQuery}"`);

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await randomDelay(2000, 3000);

    // Scroll để load thêm kết quả
    const resultPanel = page.locator('[role="feed"], .m6QErb').first();
    for (let i = 0; i < 3; i++) {
      await resultPanel.evaluate(el => el.scrollTop += 500).catch(() => {});
      await sleep(1000);
    }

    // Lấy danh sách kết quả
    const results = page.locator('[data-result-index], .Nv2PK, [role="article"]');
    const count = await results.count().catch(() => 0);
    log('INFO', `  → Found ${count} results`);

    for (let i = 0; i < Math.min(count, 6); i++) {
      try {
        const item = results.nth(i);
        const nameEl = item.locator('.qBF1Pd, .fontHeadlineSmall, h3').first();
        const name = await nameEl.textContent({ timeout: 3000 }).catch(() => null);
        if (!name) continue;

        await item.click();
        await randomDelay(2000, 3000);

        const currentUrl = page.url();
        const coords = extractCoordsFromUrl(currentUrl);

        // Chỉ lấy nếu tọa độ trong bbox tỉnh
        if (coords && !isInBbox(coords.lat, coords.lon, province.bbox)) {
          log('SKIP', `  → "${name}" ngoài bbox ${province.name}, bỏ qua`);
          await page.goBack().catch(() => {});
          continue;
        }

        const ratingEl = page.locator('span.MW4etd').first();
        const ratingText = await ratingEl.textContent({ timeout: 2000 }).catch(() => null);
        const rating = ratingText ? parseFloat(ratingText.replace(',', '.')) : null;

        const hoursData = await extractOpeningHours(page);
        const price = await extractPrice(page, 'attraction');
        const shareUrl = currentUrl.split('?')[0];

        // Detect type từ trang
        const typeText = await page.locator('.DkEaL, [jstcache]').first().textContent({ timeout: 2000 }).catch(() => '');
        const detectedType = detectType(typeText);

        const poiId = toSnakeId(name);
        const tags = [...(DEFAULT_TAGS[detectedType] || DEFAULT_TAGS.attraction)];

        discovered.push({
          id: poiId,
          name: name.trim(),
          province_id: province.id,
          type: detectedType,
          lat: coords?.lat ?? null,
          lon: coords?.lon ?? null,
          opening_hours: hoursData || makeOpeningHours(null),
          visit_minutes: detectedType === 'attraction' ? { short: 90, long: 150 } : null,
          price_vnd: price ?? 0,
          tags,
          difficulty: detectedType === 'attraction' ? 'easy' : null,
          popularity: ratingToPopularity(rating),
          source: shareUrl,
          last_verified: SCRAPE.today,
        });

        log('INFO', `  ✅ Discovered: "${name}" (${detectedType})`);
        await page.goBack().catch(() => {});
        await randomDelay(1500, 2500);

      } catch (innerErr) {
        log('WARN', `  → Error on item ${i}: ${innerErr.message}`);
      }
    }
  } catch (err) {
    log('ERROR', `discoverPois failed: ${err.message}`);
  } finally {
    await page.close();
  }

  return discovered;
}

/** Detect POI type từ chuỗi mô tả của Google */
function detectType(text) {
  if (!text) return 'attraction';
  const lower = text.toLowerCase();
  for (const [keyword, type] of Object.entries(TYPE_MAP)) {
    if (lower.includes(keyword.replace('_', ' '))) return type;
  }
  return 'attraction';
}
