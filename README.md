# CàoData DSA Data VietNamTrip — Scraper

Script tự động cào dữ liệu từ Google Maps cho dự án **VietNamTrip DSA**.

## Cài đặt

```bash
cd "C:\Users\User\Documents\CàoData DSA Data VietNamTrip"
npm install
npx playwright install chromium
```

## Sử dụng

### 1. Enrich — Điền data cho POI đã có tên (ưu tiên chạy trước)
```bash
node scraper.js --mode=enrich
```
Chỉ chạy cho 1 tỉnh:
```bash
node scraper.js --mode=enrich --province=ninh_binh
```

### 2. Discover — Tìm POI mới cho tỉnh chưa đủ 14 địa điểm
```bash
node scraper.js --mode=discover
```

### 3. All — Enrich + Discover toàn bộ
```bash
node scraper.js --mode=all
```

### 4. Merge — Gộp tất cả file tỉnh thành 1 file tổng
```bash
node merger.js
```

### 5. Validate — Kiểm tra schema + BR11.1
```bash
node validator.js
```

## Cấu trúc output

```
output/
  ninh_binh.poi.json        ← dữ liệu từng tỉnh
  quang_ninh.poi.json
  ...
  pois.merged.json           ← file tổng (sau khi chạy merger.js)
  pois.rejected.json         ← POI bị loại (thiếu tọa độ)
logs/
  scrape-2026-11-19.log      ← log chi tiết từng lần chạy
  validation-report.json     ← báo cáo validate
```

## Pipeline xử lý

```
pois.json (tên có sẵn)
      ↓ ENRICH
Google Maps search → lat, lon, opening_hours, price, popularity, source
      ↓
Validate schema + BR11.1 (3 restaurant, 2 lodging, 1 hospital 24/7)
      ↓ nếu thiếu → DISCOVER
Google Maps search theo 3 hướng (tourist / food / local)
      ↓
Save [tỉnh].poi.json
      ↓ MERGE
pois.merged.json (clean) + pois.rejected.json (cần review thủ công)
```

## Null fields được điền

| Field | Nguồn |
|---|---|
| `lat`, `lon` | URL Google Maps |
| `opening_hours` | Google Maps hours section |
| `price_vnd` | Google Maps price info |
| `popularity` | Google rating → map [1-5] sang [0-1] |
| `source` | Google Maps URL của địa điểm |
| `last_verified` | Ngày chạy script (tự động) |

## Lưu ý

- Script dùng delay ngẫu nhiên 3-5 giây giữa mỗi POI để tránh bị block
- Nếu bị Google block: tắt script, chờ 15-30 phút, chạy lại
- Các POI thiếu `lat/lon` sau 3 lần retry sẽ được flag `needs_review`
- Chạy từng tỉnh (`--province=xxx`) nếu muốn kiểm tra kết quả trước
