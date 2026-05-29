const axios = require('axios');
const cheerio = require('cheerio');

const BASE = 'https://fragment.com';

// Maps CSS class → readable status
const STATUS_MAP = {
  'tm-status-avail': 'available',
  'tm-status-taken': 'taken',
  'tm-status-unavail': 'unavailable',
  'tm-status-sold': 'sold',
  'tm-status-sale': 'for_sale',
  'tm-status-auction': 'on_auction',
};

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://fragment.com/',
};

/**
 * @returns {{ username, status, priceTon, priceUsd, exists }}
 */
async function checkFragmentUsername(username) {
  const url = `${BASE}/username/${encodeURIComponent(username)}`;

  const res = await axios.get(url, {
    headers: HEADERS,
    timeout: 12000,
    maxRedirects: 0,           // 302 redirect = username doesn't exist
    validateStatus: (s) => s < 400,
  });

  // Fragment redirects to homepage for non-existent usernames
  if (res.status === 302 || res.status === 301) {
    return { username, exists: false, status: 'not_found' };
  }

  const $ = cheerio.load(res.data);

  // Status — grab the CSS class from the status badge
  const statusEl = $('.tm-section-header-status');
  const statusClass = [...statusEl[0]?.attribs?.class?.split(' ') ?? []].find((c) => STATUS_MAP[c]);
  const status = STATUS_MAP[statusClass] ?? statusEl.text().trim().toLowerCase().replace(/\s+/g, '_') ?? 'unknown';

  // Price in TON
  const tonRaw = $('.tm-value.icon-ton').first().text().trim();
  const priceTon = tonRaw ? parseFloat(tonRaw.replace(/,/g, '')) : null;

  // Price in USD
  const usdRaw = $('.table-cell-desc').first().text().trim();
  const usdMatch = usdRaw.match(/\$([\d,]+(?:\.\d+)?)/);
  const priceUsd = usdMatch ? parseFloat(usdMatch[1].replace(/,/g, '')) : null;

  return {
    username,
    exists: true,
    status,           // available | taken | unavailable | sold | for_sale | on_auction
    priceTon,         // null if not for sale
    priceUsd,
    url: `https://fragment.com/username/${username}`,
  };
}

module.exports = { checkFragmentUsername };
