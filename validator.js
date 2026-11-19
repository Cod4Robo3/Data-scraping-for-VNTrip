// ============================================================
//  VALIDATOR - kiểm tra schema và BR 11.1 cho từng tỉnh
// ============================================================

import { readFileSync, writeFileSync } from 'fs';
import { PATHS, MIN_REQUIREMENTS } from './config.js';
import { log } from './utils.js';

const VALID_TYPES = ['attraction','restaurant','lodging','hospital','pharmacy','transport_hub','shop','experience'];
const DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
const VALID_HOURS_RE = /^(\d{2}:\d{2}-\d{2}:\d{2}|00:00-23:59|closed)$/;
const VALID_DIFFICULTY = ['easy','moderate','hard'];

/**
 * Validate 1 POI theo schema
 * Returns { ok: boolean, errors: string[], warnings: string[] }
 */
export function validatePoi(poi, bbox = null) {
  const errors = [];
  const warnings = [];

  // Required string fields
  for (const f of ['id','name','province_id','type']) {
    if (!poi[f] || typeof poi[f] !== 'string') errors.push(`Missing required field: ${f}`);
  }

  // Valid type
  if (poi.type && !VALID_TYPES.includes(poi.type)) {
    errors.push(`Invalid type: "${poi.type}". Must be one of: ${VALID_TYPES.join(', ')}`);
  }

  // lat/lon
  if (poi.lat === null || poi.lat === undefined) errors.push('Missing lat');
  if (poi.lon === null || poi.lon === undefined) errors.push('Missing lon');
  if (poi.lat !== null && poi.lon !== null && bbox) {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    if (poi.lat < minLat || poi.lat > maxLat || poi.lon < minLon || poi.lon > maxLon) {
      errors.push(`Coordinates (${poi.lat}, ${poi.lon}) outside province bbox ${JSON.stringify(bbox)}`);
    }
  }

  // opening_hours
  if (!poi.opening_hours || typeof poi.opening_hours !== 'object') {
    errors.push('Missing opening_hours');
  } else {
    for (const day of DAYS) {
      const val = poi.opening_hours[day];
      if (val === null || val === undefined) {
        warnings.push(`opening_hours.${day} is null`);
      } else if (!VALID_HOURS_RE.test(val)) {
        errors.push(`opening_hours.${day} invalid format: "${val}"`);
      }
    }
  }

  // price_vnd
  if (poi.price_vnd === null || poi.price_vnd === undefined) {
    warnings.push('price_vnd is null (will use 0)');
  } else if (typeof poi.price_vnd !== 'number' || poi.price_vnd < 0) {
    errors.push(`price_vnd must be non-negative number, got: ${poi.price_vnd}`);
  }

  // tags
  if (!poi.tags || !Array.isArray(poi.tags) || poi.tags.length === 0) {
    errors.push('Missing tags array');
  } else {
    const hasIndoorOutdoor = poi.tags.includes('indoor') || poi.tags.includes('outdoor');
    if (!hasIndoorOutdoor) warnings.push('tags missing "indoor" or "outdoor"');
  }

  // visit_minutes & difficulty (attraction only)
  if (poi.type === 'attraction') {
    if (!poi.visit_minutes || poi.visit_minutes.short == null || poi.visit_minutes.long == null) {
      errors.push('attraction must have visit_minutes.short and visit_minutes.long');
    }
    if (!poi.difficulty || !VALID_DIFFICULTY.includes(poi.difficulty)) {
      errors.push(`attraction must have difficulty: easy|moderate|hard, got: ${poi.difficulty}`);
    }
  } else {
    if (poi.visit_minutes !== null) {
      warnings.push(`Non-attraction has visit_minutes (should be null)`);
    }
    if (poi.difficulty !== null) {
      warnings.push(`Non-attraction has difficulty (should be null)`);
    }
  }

  // popularity
  if (poi.popularity !== null && poi.popularity !== undefined) {
    if (typeof poi.popularity !== 'number' || poi.popularity < 0 || poi.popularity > 1) {
      errors.push(`popularity must be [0,1] or null, got: ${poi.popularity}`);
    }
  }

  // source & last_verified
  if (!poi.source) errors.push('Missing source');
  if (!poi.last_verified) errors.push('Missing last_verified');
  if (poi.last_verified && !/^\d{4}-\d{2}-\d{2}$/.test(poi.last_verified)) {
    errors.push(`last_verified must be YYYY-MM-DD, got: ${poi.last_verified}`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Validate danh sách POI của 1 tỉnh
 * Returns { ok, stats, errors[], warnings[], missing[] }
 */
export function validateProvince(pois, provinceId, bbox = null) {
  const stats = { total: pois.length, byType: {}, nullFields: {} };
  const allErrors = [];
  const allWarnings = [];

  for (const poi of pois) {
    // Count by type
    stats.byType[poi.type] = (stats.byType[poi.type] || 0) + 1;

    // Count null fields
    for (const f of ['lat','lon','price_vnd','popularity','source','last_verified']) {
      if (poi[f] === null || poi[f] === undefined) {
        stats.nullFields[f] = (stats.nullFields[f] || 0) + 1;
      }
    }

    const { errors, warnings } = validatePoi(poi, bbox);
    errors.forEach(e => allErrors.push(`[${poi.id}] ${e}`));
    warnings.forEach(w => allWarnings.push(`[${poi.id}] ${w}`));
  }

  // BR 11.1: kiểm tra minimum requirements
  const missing = [];
  for (const [type, minCount] of Object.entries(MIN_REQUIREMENTS)) {
    const actual = stats.byType[type] || 0;
    if (actual < minCount) {
      missing.push(`Cần thêm ${minCount - actual} ${type} (hiện có ${actual}/${minCount})`);
    }
  }

  // Hospital phải 24/7
  const hospitals = pois.filter(p => p.type === 'hospital');
  for (const h of hospitals) {
    if (h.opening_hours) {
      const is24h = Object.values(h.opening_hours).every(v => v === '00:00-23:59');
      if (!is24h) allErrors.push(`[${h.id}] Hospital phải mở 24/7 (00:00-23:59)`);
    }
  }

  return {
    ok: allErrors.length === 0 && missing.length === 0,
    stats,
    errors: allErrors,
    warnings: allWarnings,
    missing,
  };
}

// ─── CLI mode ───────────────────────────────────────────────
if (process.argv[1].endsWith('validator.js')) {
  const pois = JSON.parse(readFileSync(PATHS.poisJson, 'utf8'));
  const provinces = JSON.parse(readFileSync(PATHS.provincesJson, 'utf8'));
  const bboxMap = Object.fromEntries(provinces.map(p => [p.id, p.bbox]));

  const byProvince = {};
  for (const poi of pois) {
    if (!byProvince[poi.province_id]) byProvince[poi.province_id] = [];
    byProvince[poi.province_id].push(poi);
  }

  let totalErrors = 0;
  const report = {};

  for (const [provId, provPois] of Object.entries(byProvince)) {
    const result = validateProvince(provPois, provId, bboxMap[provId]);
    report[provId] = result;
    totalErrors += result.errors.length + result.missing.length;

    const icon = result.ok ? '✅' : '❌';
    log(result.ok ? 'INFO' : 'ERROR', `${icon} ${provId}: ${provPois.length} POIs | Errors: ${result.errors.length} | Missing: ${result.missing.join('; ') || 'none'}`);
    if (!result.ok) {
      result.errors.slice(0, 5).forEach(e => console.log('   ❌', e));
      result.missing.forEach(m => console.log('   ⚠️ BR11.1:', m));
    }
  }

  const reportPath = `${PATHS.logsDir}/validation-report.json`;
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  log('INFO', `\nTotal errors: ${totalErrors}. Report saved to ${reportPath}`);
}
