// ============================================================
//  MERGER - gộp tất cả [province].poi.json thành pois.json
// ============================================================

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { PATHS } from './config.js';
import { validatePoi } from './validator.js';
import { log } from './utils.js';

const OUTPUT_DIR = PATHS.outputDir;
const TODAY = new Date().toISOString().split('T')[0];

function mergeAll() {
  if (!existsSync(OUTPUT_DIR)) {
    log('ERROR', `Output dir not found: ${OUTPUT_DIR}`);
    process.exit(1);
  }

  const files = readdirSync(OUTPUT_DIR)
    .filter(f => f.endsWith('.poi.json'))
    .sort();

  if (files.length === 0) {
    log('WARN', 'No .poi.json files found in output dir');
    return;
  }

  log('INFO', `Found ${files.length} province files to merge`);

  const all = [];
  const rejected = [];
  const idSet = new Set();

  for (const file of files) {
    const path = `${OUTPUT_DIR}/${file}`;
    const pois = JSON.parse(readFileSync(path, 'utf8'));
    log('INFO', `Merging ${file}: ${pois.length} POIs`);

    for (const poi of pois) {
      // Check duplicate IDs
      if (idSet.has(poi.id)) {
        log('WARN', `  Duplicate ID "${poi.id}" in ${file}, skipping`);
        rejected.push({ ...poi, _reject_reason: 'duplicate_id' });
        continue;
      }

      // Validate trước khi gộp
      const { ok, errors } = validatePoi(poi);

      // Chỉ loại nếu thiếu lat/lon (không thể dùng cho pipeline)
      if (poi.lat === null || poi.lon === null) {
        log('WARN', `  [${poi.id}] No coordinates, moved to rejected`);
        rejected.push({ ...poi, _reject_reason: 'missing_coordinates', _errors: errors });
        continue;
      }

      idSet.add(poi.id);
      all.push(poi);
    }
  }

  // Sắp xếp theo province_id rồi theo type
  all.sort((a, b) => {
    if (a.province_id !== b.province_id) return a.province_id.localeCompare(b.province_id);
    return a.type.localeCompare(b.type);
  });

  // Ghi file tổng
  const mergedPath = `${OUTPUT_DIR}/pois.merged.json`;
  writeFileSync(mergedPath, JSON.stringify(all, null, 2), 'utf8');
  log('INFO', `✅ Merged ${all.length} POIs → ${mergedPath}`);

  // Ghi file rejected
  if (rejected.length > 0) {
    const rejectedPath = `${OUTPUT_DIR}/pois.rejected.json`;
    writeFileSync(rejectedPath, JSON.stringify(rejected, null, 2), 'utf8');
    log('WARN', `⚠️  ${rejected.length} POIs rejected → ${rejectedPath}`);
  }

  // Summary
  const byProvince = {};
  for (const poi of all) {
    if (!byProvince[poi.province_id]) byProvince[poi.province_id] = { total: 0 };
    byProvince[poi.province_id].total++;
  }

  console.log('\n📊 Summary by province:');
  for (const [prov, stats] of Object.entries(byProvince)) {
    console.log(`   ${prov}: ${stats.total} POIs`);
  }
  console.log(`\n   TOTAL: ${all.length} POIs merged\n`);
}

mergeAll();
