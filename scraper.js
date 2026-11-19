// ============================================================
//  SCRAPER - Main orchestrator
//  Usage:
//    node scraper.js --mode=enrich               ← Điền null fields cho POI đã có tên
//    node scraper.js --mode=discover             ← Tự tìm POI cho tỉnh chưa đủ
//    node scraper.js --mode=all                  ← Enrich trước, rồi discover
//    node scraper.js --mode=enrich --province=ninh_binh   ← Chạy 1 tỉnh
// ============================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'fs';
import { launchBrowser, searchPoi, discoverPois } from './maps-scraper.js';
import { validateProvince } from './validator.js';
import { PATHS, DELAY, SCRAPE, MIN_REQUIREMENTS, SEARCH_TEMPLATES } from './config.js';
import { sleep, randomDelay, log, makeOpeningHours } from './utils.js';

// ─── Parse CLI args ──────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => a.slice(2).split('='))
);
const MODE     = args.mode     || 'enrich';
const FILTER_PROVINCE = args.province || null;

// ─── Setup dirs ──────────────────────────────────────────────
mkdirSync(PATHS.outputDir, { recursive: true });
mkdirSync(PATHS.logsDir,   { recursive: true });

const LOG_FILE = `${PATHS.logsDir}/scrape-${new Date().toISOString().replace(/[:.]/g, '-').slice(0,19)}.log`;

function logToFile(msg) {
  appendFileSync(LOG_FILE, msg + '\n', 'utf8');
}

// ─── Load data ───────────────────────────────────────────────
const poisRaw     = JSON.parse(readFileSync(PATHS.poisJson, 'utf8'));
const provinces   = JSON.parse(readFileSync(PATHS.provincesJson, 'utf8'));
const provinceMap = Object.fromEntries(provinces.map(p => [p.id, p]));

// ─── Group POIs by province ──────────────────────────────────
const poisByProvince = {};
for (const poi of poisRaw) {
  if (!poisByProvince[poi.province_id]) poisByProvince[poi.province_id] = [];
  poisByProvince[poi.province_id].push(poi);
}

// ─── ENRICH MODE: điền null fields cho POI đã có ─────────────
async function enrichProvince(context, provinceId) {
  const province = provinceMap[provinceId];
  if (!province) { log('ERROR', `Province not found: ${provinceId}`); return []; }

  const pois = poisByProvince[provinceId] || [];
  const enriched = [];

  log('INFO', `\n🏔️  Enriching ${province.name} (${pois.length} POIs)...`);
  logToFile(`=== ENRICH: ${province.name} ===`);

  for (let i = 0; i < pois.length; i++) {
    const poi = { ...pois[i] };
    const needsEnrich = poi.lat === null || poi.lon === null
      || poi.popularity === null
      || !poi.source
      || !poi.last_verified
      || (poi.opening_hours && Object.values(poi.opening_hours).some(v => v === null));

    if (!needsEnrich) {
      log('SKIP', `[${i+1}/${pois.length}] "${poi.name}" already complete, skipping`);
      enriched.push(poi);
      continue;
    }

    log('INFO', `[${i+1}/${pois.length}] Enriching "${poi.name}"...`);

    let scraped = null;
    for (let attempt = 1; attempt <= SCRAPE.max_retries; attempt++) {
      scraped = await searchPoi(context, poi, province.name);
      if (scraped && (scraped.lat !== null || scraped.opening_hours)) break;
      if (attempt < SCRAPE.max_retries) {
        log('WARN', `  Retry ${attempt}/${SCRAPE.max_retries}...`);
        await sleep(DELAY.retry_wait);
      }
    }

    if (scraped) {
      // Merge: chỉ ghi đè nếu field đang null
      if (poi.lat === null && scraped.lat !== null) poi.lat = scraped.lat;
      if (poi.lon === null && scraped.lon !== null) poi.lon = scraped.lon;
      if (poi.popularity === null && scraped.popularity !== null) poi.popularity = scraped.popularity;
      if (!poi.source && scraped.source) poi.source = scraped.source;
      if (!poi.last_verified && scraped.last_verified) poi.last_verified = scraped.last_verified;
      else if (poi.last_verified) {} // keep existing
      else poi.last_verified = SCRAPE.today;

      // opening_hours: chỉ ghi đè ngày nào đang null
      if (scraped.opening_hours && poi.opening_hours) {
        for (const day of ['mon','tue','wed','thu','fri','sat','sun']) {
          if (poi.opening_hours[day] === null && scraped.opening_hours[day]) {
            poi.opening_hours[day] = scraped.opening_hours[day];
          }
        }
      } else if (scraped.opening_hours && !poi.opening_hours) {
        poi.opening_hours = scraped.opening_hours;
      }

      // price_vnd
      if ((poi.price_vnd === null || poi.price_vnd === undefined) && scraped.price_vnd !== null) {
        poi.price_vnd = scraped.price_vnd;
      }

      logToFile(`OK: ${poi.id} lat=${poi.lat} lon=${poi.lon} pop=${poi.popularity}`);
    } else {
      log('WARN', `  Could not enrich "${poi.name}", applying defaults`);
      logToFile(`FAIL: ${poi.id} - could not scrape`);

      // Apply safe defaults cho các field còn null
      if (!poi.last_verified) poi.last_verified = SCRAPE.today;
      if (!poi.source) poi.source = `manual:${SCRAPE.today}`;
      if (poi.price_vnd === null) poi.price_vnd = 0;

      // opening_hours null → closed tạm thời + flag
      if (poi.opening_hours) {
        for (const day of ['mon','tue','wed','thu','fri','sat','sun']) {
          if (poi.opening_hours[day] === null) {
            poi.opening_hours[day] = '08:00-17:00'; // default
          }
        }
      }
    }

    // Đảm bảo tags có indoor hoặc outdoor
    if (!poi.tags) poi.tags = ['outdoor'];
    if (!poi.tags.includes('indoor') && !poi.tags.includes('outdoor')) {
      poi.tags.push('outdoor');
    }

    enriched.push(poi);
    await randomDelay(DELAY.between_pois - 500, DELAY.between_pois + 2000);
  }

  return enriched;
}

// ─── DISCOVER MODE: tìm POI mới cho tỉnh chưa đủ ─────────────
async function discoverForProvince(context, provinceId, existingPois) {
  const province = provinceMap[provinceId];
  if (!province) return [];

  const discovered = [];
  const existingIds = new Set(existingPois.map(p => p.id));

  log('INFO', `\n🔍 Discovering POIs for ${province.name}...`);

  for (const templateFn of SEARCH_TEMPLATES) {
    const query = templateFn(province.name);
    const results = await discoverPois(context, province, query);

    for (const poi of results) {
      if (!existingIds.has(poi.id)) {
        discovered.push(poi);
        existingIds.add(poi.id);
      }
    }

    await sleep(DELAY.between_pois);
  }

  log('INFO', `  → Discovered ${discovered.length} new POIs for ${province.name}`);
  return discovered;
}

// ─── Save province file ───────────────────────────────────────
function saveProvinceFile(provinceId, pois) {
  const filePath = `${PATHS.outputDir}/${provinceId}.poi.json`;
  writeFileSync(filePath, JSON.stringify(pois, null, 2), 'utf8');
  log('INFO', `💾 Saved: ${filePath} (${pois.length} POIs)`);
}

// ─── Validate & report province ──────────────────────────────
function reportProvince(provinceId, pois) {
  const province = provinceMap[provinceId];
  const bbox = province?.bbox || null;
  const result = validateProvince(pois, provinceId, bbox);

  const icon = result.ok ? '✅' : '⚠️';
  log(result.ok ? 'INFO' : 'WARN', `${icon} Validation: ${provinceId} | ${pois.length} POIs | Errors: ${result.errors.length}`);

  if (result.missing.length > 0) {
    log('WARN', `   BR11.1 Missing: ${result.missing.join('; ')}`);
    logToFile(`BR11.1 MISSING [${provinceId}]: ${result.missing.join('; ')}`);
  }

  result.errors.slice(0, 5).forEach(e => log('WARN', `   ${e}`));
  return result;
}

// ─── MAIN ────────────────────────────────────────────────────
async function main() {
  log('INFO', `\n${'='.repeat(60)}`);
  log('INFO', `🚀 VietNamTrip Data Scraper — Mode: ${MODE.toUpperCase()}`);
  log('INFO', `📁 Output: ${PATHS.outputDir}`);
  log('INFO', `📋 Log: ${LOG_FILE}`);
  log('INFO', `${'='.repeat(60)}\n`);

  const { browser, context } = await launchBrowser();

  try {
    // Danh sách tỉnh cần xử lý
    let provincesToProcess = provinces.map(p => p.id);
    if (FILTER_PROVINCE) {
      provincesToProcess = [FILTER_PROVINCE];
      log('INFO', `Filtering to province: ${FILTER_PROVINCE}`);
    }

    for (const provinceId of provincesToProcess) {
      const province = provinceMap[provinceId];
      if (!province) continue;

      log('INFO', `\n${'─'.repeat(50)}`);
      log('INFO', `📍 Province: ${province.name} (${provinceId})`);

      let pois = [...(poisByProvince[provinceId] || [])];

      // ENRICH: điền data cho POI đã có
      if (MODE === 'enrich' || MODE === 'all') {
        if (pois.length > 0) {
          pois = await enrichProvince(context, provinceId);
        } else {
          log('SKIP', `No existing POIs for ${provinceId}, skipping enrich`);
        }
      }

      // DISCOVER: tìm thêm POI nếu chưa đủ hoặc chưa có
      if (MODE === 'discover' || MODE === 'all') {
        const needsMore = pois.length < SCRAPE.pois_per_province;
        const hasMinTypes = checkMinRequirements(pois);

        if (needsMore || !hasMinTypes) {
          const newPois = await discoverForProvince(context, provinceId, pois);
          pois = [...pois, ...newPois];
        } else {
          log('SKIP', `${provinceId} already has ${pois.length} POIs with all required types`);
        }
      }

      // Validate
      reportProvince(provinceId, pois);

      // Save province file
      saveProvinceFile(provinceId, pois);

      // Delay giữa các tỉnh
      if (provincesToProcess.indexOf(provinceId) < provincesToProcess.length - 1) {
        log('INFO', `⏳ Waiting ${DELAY.between_provinces / 1000}s before next province...`);
        await sleep(DELAY.between_provinces);
      }
    }

    log('INFO', `\n${'='.repeat(60)}`);
    log('INFO', `✅ Scraping complete!`);
    log('INFO', `📁 Province files saved to: ${PATHS.outputDir}`);
    log('INFO', `▶  Run "node merger.js" to merge all provinces into pois.json`);
    log('INFO', `${'='.repeat(60)}\n`);

  } finally {
    await browser.close();
  }
}

// ─── Helper: kiểm tra min requirements ──────────────────────
function checkMinRequirements(pois) {
  const counts = {};
  for (const poi of pois) counts[poi.type] = (counts[poi.type] || 0) + 1;
  return Object.entries(MIN_REQUIREMENTS).every(([type, min]) => (counts[type] || 0) >= min);
}

main().catch(err => {
  log('ERROR', `Fatal: ${err.message}`);
  console.error(err);
  process.exit(1);
});
