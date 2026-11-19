// ============================================================
//  UTILS - helper functions
// ============================================================

import { DELAY } from './config.js';

/** Sleep ms */
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Random delay trong khoảng [min, max] ms */
export const randomDelay = (min, max) =>
  sleep(min + Math.floor(Math.random() * (max - min)));

/** Chuyển tên tiếng Việt sang snake_case không dấu */
export function toSnakeId(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')     // bỏ dấu
    .replace(/đ/gi, 'd')                  // đ → d
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')          // ký tự đặc biệt → _
    .replace(/^_+|_+$/g, '');             // trim _
}

/** Map Google rating [1-5] → popularity [0-1] */
export function ratingToPopularity(rating) {
  if (!rating || rating < 1) return null;
  return Math.round(((rating - 1) / 4) * 100) / 100;
}

/** Parse giờ từ chuỗi Google "7:00 AM – 5:00 PM" → "07:00-17:00" */
export function parseHours(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const lower = raw.trim().toLowerCase();
  if (lower === 'open 24 hours' || lower === 'mở cửa 24 giờ') return '00:00-23:59';
  if (lower === 'closed' || lower === 'đóng cửa') return 'closed';

  // "7:00 AM – 5:00 PM" hoặc "7:00 SA – 5:00 CH"
  const match = lower.match(/(\d{1,2}):(\d{2})\s*(am|pm|sa|ch)\s*[–\-–]\s*(\d{1,2}):(\d{2})\s*(am|pm|sa|ch)/);
  if (!match) return null;

  const to24 = (h, m, period) => {
    let hour = parseInt(h);
    const isPM = period === 'pm' || period === 'ch';
    if (isPM && hour !== 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${m}`;
  };

  const open  = to24(match[1], match[2], match[3]);
  const close = to24(match[4], match[5], match[6]);
  return `${open}-${close}`;
}

/** Tạo opening_hours object đầy đủ từ 1 chuỗi (áp dụng cho tất cả ngày) */
export function makeOpeningHours(timeStr) {
  const days = ['mon','tue','wed','thu','fri','sat','sun'];
  return Object.fromEntries(days.map(d => [d, timeStr]));
}

/** Parse opening_hours từ mảng Google (["Monday: 7:00 AM – 5:00 PM", ...]) */
export function parseWeeklyHours(hoursArr) {
  if (!hoursArr || !Array.isArray(hoursArr)) return null;
  const dayMap = {
    'monday':'mon','tuesday':'tue','wednesday':'wed',
    'thursday':'thu','friday':'fri','saturday':'sat','sunday':'sun',
    'thứ hai':'mon','thứ ba':'tue','thứ tư':'wed',
    'thứ năm':'thu','thứ sáu':'fri','thứ bảy':'sat','chủ nhật':'sun',
  };
  const result = { mon:null, tue:null, wed:null, thu:null, fri:null, sat:null, sun:null };
  for (const line of hoursArr) {
    const lower = line.toLowerCase();
    for (const [dayName, dayKey] of Object.entries(dayMap)) {
      if (lower.startsWith(dayName)) {
        const timePart = line.split(':').slice(1).join(':').trim();
        result[dayKey] = parseHours(timePart);
        break;
      }
    }
  }
  // Nếu tất cả null thì trả null
  return Object.values(result).every(v => v === null) ? null : result;
}

/** Kiểm tra tọa độ có nằm trong bbox tỉnh không */
export function isInBbox(lat, lon, bbox) {
  // bbox: [minLon, minLat, maxLon, maxLat]
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon;
}

/** Format số VND gọn hơn cho log */
export function fmtVnd(n) {
  if (!n) return 'null';
  return n.toLocaleString('vi-VN') + '₫';
}

/** Log với timestamp */
export function log(level, msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const icon = { INFO: '✅', WARN: '⚠️', ERROR: '❌', SKIP: '⏭️' }[level] || '•';
  console.log(`[${ts}] ${icon} [${level}] ${msg}`);
}
