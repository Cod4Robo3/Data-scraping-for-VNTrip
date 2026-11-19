// ============================================================
//  CONFIG - CàoData DSA VietNamTrip
// ============================================================

export const PATHS = {
  poisJson:      'C:/Users/User/Documents/DSA vntrip prj/VNTrip GĐ2/data/pois.json',
  provincesJson: 'C:/Users/User/Documents/DSA vntrip prj/VNTrip GĐ2/data/provinces.json',
  outputDir:     'C:/Users/User/Documents/CàoData DSA Data VietNamTrip/output',
  logsDir:       'C:/Users/User/Documents/CàoData DSA Data VietNamTrip/logs',
};

// Delay giữa mỗi request (ms) để tránh bị Google block
export const DELAY = {
  between_pois:     3000,   // 3 giây giữa mỗi POI
  between_provinces: 8000,  // 8 giây giữa mỗi tỉnh
  retry_wait:       15000,  // 15 giây khi retry sau lỗi
};

export const SCRAPE = {
  max_retries:        3,
  pois_per_province:  14,   // số POI tối thiểu khi auto-discover
  today: new Date().toISOString().split('T')[0], // YYYY-MM-DD
};

// Template tìm kiếm cho 3 hướng auto-discover
export const SEARCH_TEMPLATES = [
  // Hướng 1: Điểm du lịch nổi tiếng
  (provinceName) => `địa điểm du lịch nổi tiếng ${provinceName} Vietnam`,
  // Hướng 2: Ẩm thực / nhà hàng
  (provinceName) => `nhà hàng quán ăn ngon ${provinceName} Vietnam`,
  // Hướng 3: Trải nghiệm local ít tourist
  (provinceName) => `trải nghiệm địa phương local ${provinceName} Vietnam ít du lịch`,
];

// Mapping loại POI từ Google Maps sang schema
export const TYPE_MAP = {
  'restaurant':        'restaurant',
  'food':              'restaurant',
  'meal_takeaway':     'restaurant',
  'meal_delivery':     'restaurant',
  'cafe':              'restaurant',
  'bar':               'restaurant',
  'lodging':           'lodging',
  'hotel':             'lodging',
  'resort':            'lodging',
  'hostel':            'lodging',
  'hospital':          'hospital',
  'doctor':            'hospital',
  'pharmacy':          'pharmacy',
  'drugstore':         'pharmacy',
  'transit_station':   'transport_hub',
  'bus_station':       'transport_hub',
  'train_station':     'transport_hub',
  'airport':           'transport_hub',
  'store':             'shop',
  'shopping_mall':     'shop',
  'market':            'shop',
  'tourist_attraction':'attraction',
  'museum':            'attraction',
  'park':              'attraction',
  'natural_feature':   'attraction',
  'point_of_interest': 'attraction',
  'establishment':     'attraction',
};

// Tags mặc định theo type
export const DEFAULT_TAGS = {
  restaurant:    ['indoor', 'food'],
  lodging:       ['indoor', 'accommodation'],
  hospital:      ['indoor', 'healthcare', 'emergency'],
  pharmacy:      ['indoor', 'healthcare'],
  transport_hub: ['indoor', 'outdoor', 'transport'],
  shop:          ['indoor', 'shopping'],
  attraction:    ['outdoor'],
  experience:    ['outdoor', 'local'],
};

// Yêu cầu tối thiểu mỗi tỉnh (BR 11.1)
export const MIN_REQUIREMENTS = {
  restaurant: 3,
  lodging:    2,
  hospital:   1,
};
