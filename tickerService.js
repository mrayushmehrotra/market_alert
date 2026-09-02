import { INSTRUMENTS, EMA_PERIOD } from "./config";
import {
  fetchHistoricalCandles,
  connectPriceFeed,
  subscribeToInstruments,
  disconnectPriceFeed,
  startRESTPolling,
  stopRESTPolling,
} from "./indstocksClient";
import {
  computeVWAPFromCandles,
  updateVWAP,
  computeEMA9FromCloses,
  updateEMA9,
  detectCross,
  createIndicatorState,
} from "./indicators";
import {
  setupChannels,
  showOrUpdateTickerNotification,
  showCrossAlert,
  cancelTickerNotification,
} from "./notifications";

// ---------- State ----------

const SESSION_DURATION_MS = 6 * 60 * 60 * 1000; // 6 hours
let sessionStartTime = null;
let crossCount = 0;
let sessionTimer = null;
let sessionRunning = false;

const state = {
  NIFTY: createIndicatorState(),
  SENSEX: createIndicatorState(),
};

const latestPrices = {
  NIFTY: { price: 0, open: 0, high: 0, low: 0, volume: 0, direction: "above" },
  SENSEX: { price: 0, open: 0, high: 0, low: 0, volume: 0, direction: "above" },
};

let lastCandleTs = { NIFTY: 0, SENSEX: 0 };
let onDataCallback = null;
let onCrossCallback = null;
let onStatusCallback = null;

// ---------- Helpers ----------

function formatDuration(ms) {
  if (ms <= 0) return "00:00:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function getSessionInfo() {
  if (!sessionRunning || !sessionStartTime) {
    return {
      running: false,
      crossCount: crossCount,
      remainingMs: SESSION_DURATION_MS,
      formattedTime: "06:00:00",
    };
  }
  const elapsed = Date.now() - sessionStartTime;
  const remaining = Math.max(0, SESSION_DURATION_MS - elapsed);
  return {
    running: true,
    crossCount: crossCount,
    remainingMs: remaining,
    formattedTime: formatDuration(remaining),
  };
}

function getISTNow() {
  // IST is UTC+5:30 (19800000 ms). Avoid toLocaleString parsing which
  // can return Invalid Date on Hermes / some JS engines.
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const nowUtc = Date.now();
  return new Date(nowUtc + IST_OFFSET_MS);
}

function getTodayMarketOpenMs() {
  const ist = getISTNow();
  // Build 09:15:00.000 IST today in UTC ms
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const openIST = new Date(ist);
  openIST.setUTCHours(9, 15, 0, 0);
  // openIST is in "shifted" time, convert back to real UTC
  return openIST.getTime() - IST_OFFSET_MS;
}

function isWithinMarketHours() {
  const now = getISTNow();
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  if (h < 9 || (h === 9 && m < 15)) return false;
  if (h > 15 || (h === 15 && m > 30)) return false;
  return true;
}

function getCandleWindowStart(tsSeconds) {
  // Align to 5-minute boundary
  return Math.floor(tsSeconds / 300) * 300;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ---------- Bootstrap indicators from historical candles ----------

async function bootstrapIndicators(label) {
  const inst = INSTRUMENTS[label];
  if (!inst) return;

  const nowMs = Date.now();
  const todayOpenMs = getTodayMarketOpenMs();
  const startMs = Math.min(todayOpenMs, nowMs - 24 * 60 * 60 * 1000); // fallback 24h

  try {
    const candles = await fetchHistoricalCandles(inst.restScrip, startMs, nowMs);

    if (!candles || candles.length === 0) {
      console.log(`[Ticker] No historical candles for ${label}`);
      return;
    }

    // Sort by timestamp ascending
    candles.sort((a, b) => a.ts - b.ts);

    // Compute VWAP from all candles
    const vwapResult = computeVWAPFromCandles(candles);
    state[label].vwap = vwapResult.vwap;
    state[label].cumVolume = vwapResult.cumVolume;
    state[label].cumTypicalVolume = vwapResult.cumTypicalVolume;

    // Compute EMA9 from close prices
    const closes = candles.map((c) => c.c);
    state[label].ema9 = computeEMA9FromCloses(closes, EMA_PERIOD);
    state[label].lastClose = closes[closes.length - 1] || 0;

    // Record last candle timestamp to detect new candles
    lastCandleTs[label] = candles[candles.length - 1].ts;

    // Set latest price from last candle
    const last = candles[candles.length - 1];
    latestPrices[label] = {
      price: last.c,
      open: last.o,
      high: last.h,
      low: last.l,
      volume: last.v,
      direction: last.c >= state[label].vwap ? "above" : "below",
    };

    console.log(
      `[Ticker] ${label} bootstrapped: VWAP=${round2(state[label].vwap)} EMA9=${round2(state[label].ema9)} candles=${candles.length}`
    );
  } catch (err) {
    console.error(`[Ticker] Failed to bootstrap ${label}:`, err.message);
  }
}

// ---------- Handle real-time quote ----------

function handleQuote(msg) {
  const { instrument, data, timestamp } = msg;
  const tsSeconds = Math.floor(timestamp / 1000);

  // Determine which label this quote belongs to
  let label = null;
  for (const [key, inst] of Object.entries(INSTRUMENTS)) {
    if (inst.wsInstrument.includes(instrument) || instrument === inst.wsInstrument) {
      label = key;
      break;
    }
  }

  if (!label) return;

  const prevEMA = state[label].ema9;
  const prevVWAP = state[label].vwap;

  // Update latest price
  latestPrices[label] = {
    price: data.ltp || data.close || latestPrices[label].price,
    open: data.open || latestPrices[label].open,
    high: data.high || latestPrices[label].high,
    low: data.low || latestPrices[label].low,
    volume: data.volume || latestPrices[label].volume,
    direction: data.ltp >= prevVWAP ? "above" : "below",
  };

  // Check if this is a new 5-minute candle
  const candleWindow = getCandleWindowStart(tsSeconds);
  const isNewCandle = candleWindow > lastCandleTs[label];

  if (isNewCandle && state[label].lastClose > 0) {
    // Finalize previous candle for VWAP — use the last known data
    const prevCandle = {
      h: latestPrices[label].high,
      l: latestPrices[label].low,
      c: state[label].lastClose,
      v: latestPrices[label].volume,
    };

    const vwapResult = updateVWAP(
      state[label].cumTypicalVolume,
      state[label].cumVolume,
      prevCandle
    );
    state[label].vwap = vwapResult.vwap;
    state[label].cumVolume = vwapResult.cumVolume;
    state[label].cumTypicalVolume = vwapResult.cumTypicalVolume;

    // Reset for new candle
    lastCandleTs[label] = candleWindow;
    latestPrices[label].high = data.high || data.ltp || 0;
    latestPrices[label].low = data.low || data.ltp || 0;
    latestPrices[label].volume = data.volume || 0;
  }

  // Update VWAP with current tick's typical price
  if (data.ltp && data.volume) {
    const currentCandle = {
      h: latestPrices[label].high || data.ltp,
      l: latestPrices[label].low || data.ltp,
      c: data.ltp,
      v: latestPrices[label].volume || 0,
    };

    const vwapResult = updateVWAP(
      state[label].cumTypicalVolume,
      state[label].cumVolume,
      currentCandle
    );
    state[label].vwap = vwapResult.vwap;
    state[label].cumVolume = vwapResult.cumVolume;
    state[label].cumTypicalVolume = vwapResult.cumTypicalVolume;
  }

  // Update EMA9
  if (data.ltp) {
    state[label].ema9 = updateEMA9(prevEMA, data.ltp, EMA_PERIOD);
    state[label].lastClose = data.ltp;
  }

  // Detect cross
  const cross = detectCross(prevEMA, prevVWAP, state[label].ema9, state[label].vwap);
  if (cross) {
    crossCount++;
    const crossPayload = {
      label,
      cross,
      price: latestPrices[label].price,
      vwap: round2(state[label].vwap),
      ema: round2(state[label].ema9),
    };
    if (onCrossCallback) onCrossCallback(crossPayload);
    showCrossAlert(crossPayload);
  }

  // Update notification
  showOrUpdateTickerNotification(getData());

  // Notify UI
  if (onDataCallback) {
    onDataCallback(getData());
  }
}

// ---------- Handle REST LTP poll (fallback for live price + EMA9) ----------

function handleRESTPoll({ NIFTY: nPrice, SENSEX: sPrice }) {
  const entries = [
    ["NIFTY", nPrice],
    ["SENSEX", sPrice],
  ];

  for (const [label, price] of entries) {
    if (!price) continue;

    const prevEMA = state[label].ema9;
    const prevVWAP = state[label].vwap;

    if (price !== latestPrices[label].price) {
      latestPrices[label].price = price;
      latestPrices[label].direction = price >= prevVWAP ? "above" : "below";

      if (prevEMA > 0) {
        state[label].ema9 = updateEMA9(prevEMA, price, EMA_PERIOD);
        state[label].lastClose = price;
      }

      const cross = detectCross(prevEMA, prevVWAP, state[label].ema9, state[label].vwap);
      if (cross) {
        crossCount++;
        const crossPayload = {
          label,
          cross,
          price,
          vwap: round2(state[label].vwap),
          ema: round2(state[label].ema9),
        };
        if (onCrossCallback) onCrossCallback(crossPayload);
        showCrossAlert(crossPayload);
      }
    }
  }

  showOrUpdateTickerNotification(getData());

  if (onDataCallback) onDataCallback(getData());
}

// ---------- Public API ----------

export function getData() {
  return {
    NIFTY: {
      price: latestPrices.NIFTY.price,
      open: latestPrices.NIFTY.open,
      high: latestPrices.NIFTY.high,
      low: latestPrices.NIFTY.low,
      volume: latestPrices.NIFTY.volume,
      direction: latestPrices.NIFTY.direction,
      vwap: round2(state.NIFTY.vwap),
      ema9: round2(state.NIFTY.ema9),
    },
    SENSEX: {
      price: latestPrices.SENSEX.price,
      open: latestPrices.SENSEX.open,
      high: latestPrices.SENSEX.high,
      low: latestPrices.SENSEX.low,
      volume: latestPrices.SENSEX.volume,
      direction: latestPrices.SENSEX.direction,
      vwap: round2(state.SENSEX.vwap),
      ema9: round2(state.SENSEX.ema9),
    },
    session: getSessionInfo(),
  };
}

export function onData(callback) {
  onDataCallback = callback;
}

export function onCross(callback) {
  onCrossCallback = callback;
}

export function onStatus(callback) {
  onStatusCallback = callback;
}

export async function startTicker() {
  if (onStatusCallback) onStatusCallback("Setting up notifications...");

  await setupChannels();

  // Reset 6-hour session counters
  sessionStartTime = Date.now();
  sessionRunning = true;
  crossCount = 0;

  // Bootstrap from historical data
  if (onStatusCallback) onStatusCallback("Fetching historical data...");
  await Promise.all([
    bootstrapIndicators("NIFTY"),
    bootstrapIndicators("SENSEX"),
  ]);

  // Show initial notification
  showOrUpdateTickerNotification(getData());

  // Start 1-second session timer loop to update countdown & auto-stop after 6 hours
  if (sessionTimer) clearInterval(sessionTimer);
  sessionTimer = setInterval(() => {
    if (!sessionRunning) return;
    const session = getSessionInfo();
    if (session.remainingMs <= 0) {
      stopTicker();
      if (onStatusCallback) onStatusCallback("6-Hour Session Completed");
      return;
    }
    showOrUpdateTickerNotification(getData());
    if (onDataCallback) onDataCallback(getData());
  }, 1000);

  // Connect WebSocket
  if (onStatusCallback) onStatusCallback("Connecting to live feed...");

  const instruments = Object.values(INSTRUMENTS).map((i) => i.wsInstrument);

  connectPriceFeed(
    handleQuote,
    () => {
      subscribeToInstruments(instruments);
      if (onStatusCallback) onStatusCallback("Connected — 6h monitoring active");
    },
    () => {
      if (onStatusCallback) {
        onStatusCallback("REST polling active (WebSocket reconnecting…)");
      }
    }
  );

  // REST polling as a reliable fallback to keep live prices + EMA9 fresh
  // even if the WebSocket feed is delayed or unavailable.
  startRESTPolling(handleRESTPoll, 5000);

  // Notify UI with initial data
  if (onDataCallback) onDataCallback(getData());
}

export async function stopTicker() {
  if (sessionTimer) {
    clearInterval(sessionTimer);
    sessionTimer = null;
  }
  sessionRunning = false;
  sessionStartTime = null;

  disconnectPriceFeed();
  stopRESTPolling();
  await cancelTickerNotification();

  // Reset state
  for (const label of Object.keys(state)) {
    state[label] = createIndicatorState();
    latestPrices[label] = { price: 0, open: 0, high: 0, low: 0, volume: 0, direction: "above" };
    lastCandleTs[label] = 0;
  }
}
