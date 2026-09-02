import {
  COINDCX_PUBLIC_URL,
  COINDCX_REST_URL,
  CANDLE_INTERVAL,
  INSTRUMENTS,
} from "./config";

// ---------- Historical Candlestick Data ----------

export async function fetchHistoricalCandles(
  pair = INSTRUMENTS.SOL.pair,
  interval = CANDLE_INTERVAL,
  limit = 500
) {
  // CoinDCX public endpoint for candles:
  // GET https://public.coindcx.com/market_data/candles/?pair=B-SOL_USDT&interval=5m&limit=500
  const url = `${COINDCX_PUBLIC_URL}/market_data/candles/?pair=${pair}&interval=${interval}&limit=${limit}`;

  const res = await fetch(url);
  if (!res.ok) {
    // Fallback attempt with SOL_USDT if B-SOL_USDT fails
    const altPair = pair.startsWith("B-") ? pair.replace("B-", "") : `B-${pair}`;
    const altUrl = `${COINDCX_PUBLIC_URL}/market_data/candles/?pair=${altPair}&interval=${interval}&limit=${limit}`;
    const altRes = await fetch(altUrl);
    if (!altRes.ok) {
      const text = await res.text();
      throw new Error(`CoinDCX historical fetch failed (${res.status}): ${text}`);
    }
    const altData = await altRes.json();
    return parseCandles(altData);
  }

  const data = await res.json();
  return parseCandles(data);
}

function parseCandles(raw) {
  if (!Array.isArray(raw)) return [];

  return raw.map((c) => {
    if (typeof c === "object" && c !== null && !Array.isArray(c)) {
      // Object format: { open, high, low, close, volume, time }
      return {
        o: parseFloat(c.open || c.o || 0),
        h: parseFloat(c.high || c.h || 0),
        l: parseFloat(c.low || c.l || 0),
        c: parseFloat(c.close || c.c || 0),
        v: parseFloat(c.volume || c.v || 0),
        ts: Math.floor((c.time || c.ts || Date.now()) / 1000),
      };
    } else if (Array.isArray(c)) {
      // Array format: [time, open, high, low, close, volume]
      return {
        ts: Math.floor(c[0] / 1000),
        o: parseFloat(c[1] || 0),
        h: parseFloat(c[2] || 0),
        l: parseFloat(c[3] || 0),
        c: parseFloat(c[4] || 0),
        v: parseFloat(c[5] || 0),
      };
    }
    return { o: 0, h: 0, l: 0, c: 0, v: 0, ts: 0 };
  });
}

// ---------- Live Ticker (LTP & 24h Stats) ----------

export async function fetchLTP(market = INSTRUMENTS.SOL.market) {
  // GET https://api.coindcx.com/exchange/ticker
  const url = `${COINDCX_REST_URL}/exchange/ticker`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CoinDCX ticker fetch failed (${res.status}): ${text}`);
  }

  const list = await res.json();
  if (!Array.isArray(list)) return null;

  // Match market e.g. "SOL_USDT" or "SOLUSDT"
  const item = list.find(
    (t) =>
      t.market === market ||
      t.market === market.replace("_", "") ||
      t.symbol === market
  );

  if (!item) return null;

  return {
    price: parseFloat(item.last_price || 0),
    high: parseFloat(item.high || 0),
    low: parseFloat(item.low || 0),
    volume: parseFloat(item.volume || 0),
    change: parseFloat(item.change_24_hour || 0),
    bid: parseFloat(item.bid || 0),
    ask: parseFloat(item.ask || 0),
  };
}

// ---------- REST Polling ----------

let pollTimer = null;

export function startRESTPolling(callback, intervalMs = 3000) {
  stopRESTPolling();
  const run = async () => {
    try {
      const data = await fetchLTP();
      if (data && callback) {
        callback(data);
      }
    } catch (err) {
      console.error("[CoinDCX Poll] Error:", err.message);
    }
  };
  run();
  pollTimer = setInterval(run, intervalMs);
}

export function stopRESTPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
