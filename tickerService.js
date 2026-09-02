import { INSTRUMENTS, EMA_PERIOD, CANDLE_INTERVAL_INDSTOCKS, CANDLE_INTERVAL_COINDCX } from "./config";
import {
  fetchHistoricalCandles as fetchIndstocksCandles,
  connectPriceFeed,
  subscribeToInstruments,
  disconnectPriceFeed,
  startRESTPolling as startIndstocksPolling,
  stopRESTPolling as stopIndstocksPolling,
} from "./indstocksClient";
import {
  fetchHistoricalCandles as fetchCoindcxCandles,
  startRESTPolling as startCoindcxPolling,
  stopRESTPolling as stopCoindcxPolling,
} from "./coindcxClient";
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
  SOL: createIndicatorState(),
};

const latestPrices = {
  NIFTY: { price: 0, open: 0, high: 0, low: 0, volume: 0, change: 0, direction: "above" },
  SENSEX: { price: 0, open: 0, high: 0, low: 0, volume: 0, change: 0, direction: "above" },
  SOL: { price: 0, open: 0, high: 0, low: 0, volume: 0, change: 0, direction: "above" },
};

let lastCandleTs = { NIFTY: 0, SENSEX: 0, SOL: 0 };
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

function round2(n) {
  if (!n) return 0;
  return Math.round(n * 100) / 100;
}

function getISTNow() {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(Date.now() + IST_OFFSET_MS);
}

function getTodayMarketOpenMs() {
  const ist = getISTNow();
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const openIST = new Date(ist);
  openIST.setUTCHours(9, 15, 0, 0);
  return openIST.getTime() - IST_OFFSET_MS;
}

// ---------- Bootstrap indicators ----------

async function bootstrapIndstocks(label) {
  const inst = INSTRUMENTS[label];
  if (!inst || !inst.restScrip) return;

  const nowMs = Date.now();
  // Request candles for the past 3 days so data is always loaded even after market hours / weekends
  const startMs = nowMs - 3 * 24 * 60 * 60 * 1000;

  try {
    let candles = await fetchIndstocksCandles(inst.restScrip, startMs, nowMs);

    if (!candles || candles.length === 0) {
      // Fallback to 7 days if today is a weekend / market holiday
      const fallbackStart = nowMs - 7 * 24 * 60 * 60 * 1000;
      candles = await fetchIndstocksCandles(inst.restScrip, fallbackStart, nowMs);
    }

    if (!candles || candles.length === 0) {
      console.log(`[Ticker] No historical candles for ${label}`);
      return;
    }

    candles.sort((a, b) => a.ts - b.ts);

    const vwapResult = computeVWAPFromCandles(candles);
    state[label].vwap = vwapResult.vwap;
    state[label].cumVolume = vwapResult.cumVolume;
    state[label].cumTypicalVolume = vwapResult.cumTypicalVolume;

    const closes = candles.map((c) => c.c);
    state[label].ema9 = computeEMA9FromCloses(closes, EMA_PERIOD);
    state[label].lastClose = closes[closes.length - 1] || 0;

    lastCandleTs[label] = candles[candles.length - 1].ts;

    const last = candles[candles.length - 1];
    latestPrices[label] = {
      price: last.c,
      open: last.o,
      high: last.h,
      low: last.l,
      volume: last.v,
      change: last.o > 0 ? ((last.c - last.o) / last.o) * 100 : 0,
      direction: last.c >= state[label].vwap ? "above" : "below",
    };
  } catch (err) {
    console.warn(`[Ticker] Bootstrap error ${label}:`, err.message);
    if (err.message.includes("403") || err.message.includes("access_token")) {
      if (onStatusCallback) {
        onStatusCallback("INDstocks API token expired (403). Get a new token from indstocks.com");
      }
    }
  }
}

async function bootstrapCoindcx() {
  const inst = INSTRUMENTS.SOL;
  if (!inst) return;

  try {
    const candles = await fetchCoindcxCandles(inst.pair, CANDLE_INTERVAL_COINDCX, 500);
    if (!candles || candles.length === 0) return;

    candles.sort((a, b) => a.ts - b.ts);

    const vwapResult = computeVWAPFromCandles(candles);
    state.SOL.vwap = vwapResult.vwap;
    state.SOL.cumVolume = vwapResult.cumVolume;
    state.SOL.cumTypicalVolume = vwapResult.cumTypicalVolume;

    const closes = candles.map((c) => c.c);
    state.SOL.ema9 = computeEMA9FromCloses(closes, EMA_PERIOD);
    state.SOL.lastClose = closes[closes.length - 1] || 0;

    lastCandleTs.SOL = candles[candles.length - 1].ts;

    const last = candles[candles.length - 1];
    latestPrices.SOL = {
      price: last.c,
      open: last.o,
      high: last.h,
      low: last.l,
      volume: last.v,
      change: 0,
      direction: last.c >= state.SOL.vwap ? "above" : "below",
    };
  } catch (err) {
    console.warn(`[Ticker] Bootstrap error SOL:`, err.message);
  }
}

// ---------- Real-time tick handlers ----------

function handleIndstocksQuote(msg) {
  const { instrument, data } = msg;
  let label = null;
  for (const [key, inst] of Object.entries(INSTRUMENTS)) {
    if (inst.wsInstrument && (inst.wsInstrument.includes(instrument) || instrument === inst.wsInstrument)) {
      label = key;
      break;
    }
  }
  if (!label) return;

  const price = data.ltp || data.close || latestPrices[label].price;
  if (!price) return;

  processPriceUpdate(label, price, data.high, data.low, data.volume, data.open);
}

function handleIndstocksRESTPoll({ NIFTY: nPrice, SENSEX: sPrice }) {
  if (nPrice) processPriceUpdate("NIFTY", nPrice);
  if (sPrice) processPriceUpdate("SENSEX", sPrice);
}

function handleCoindcxTick(data) {
  if (!data || !data.price) return;
  processPriceUpdate("SOL", data.price, data.high, data.low, data.volume, null, data.change);
}

function processPriceUpdate(label, price, high, low, volume, open, changeVal) {
  const prevEMA = state[label].ema9;
  const prevVWAP = state[label].vwap;

  if (price !== latestPrices[label].price) {
    latestPrices[label].price = price;
    if (open) latestPrices[label].open = open;
    if (high) latestPrices[label].high = high;
    if (low) latestPrices[label].low = low;
    if (volume) latestPrices[label].volume = volume;
    if (changeVal !== undefined && changeVal !== null) {
      latestPrices[label].change = changeVal;
    } else if (latestPrices[label].open > 0) {
      latestPrices[label].change = ((price - latestPrices[label].open) / latestPrices[label].open) * 100;
    }
    latestPrices[label].direction = price >= prevVWAP ? "above" : "below";

    // Update EMA9
    if (prevEMA > 0) {
      state[label].ema9 = updateEMA9(prevEMA, price, EMA_PERIOD);
      state[label].lastClose = price;
    } else {
      state[label].ema9 = price;
    }

    // Update VWAP
    const currentCandle = {
      h: latestPrices[label].high || price,
      l: latestPrices[label].low || price,
      c: price,
      v: latestPrices[label].volume || 100,
    };
    const vwapResult = updateVWAP(
      state[label].cumTypicalVolume,
      state[label].cumVolume,
      currentCandle
    );
    state[label].vwap = vwapResult.vwap;

    // Detect Crossover
    const cross = detectCross(prevEMA, prevVWAP, state[label].ema9, state[label].vwap);
    if (cross) {
      crossCount++;
      const crossPayload = {
        label: INSTRUMENTS[label]?.label || label,
        cross,
        price,
        vwap: round2(state[label].vwap),
        ema: round2(state[label].ema9),
      };
      if (onCrossCallback) onCrossCallback(crossPayload);
      showCrossAlert(crossPayload);
    }
  }

  showOrUpdateTickerNotification(getData());
  if (onDataCallback) onDataCallback(getData());
}

// ---------- Public API ----------

import { setApiToken } from "./indstocksClient";

export async function updateIndstocksToken(newToken) {
  setApiToken(newToken);
  if (onStatusCallback) onStatusCallback("Updating token & fetching NIFTY / SENSEX...");
  await Promise.all([
    bootstrapIndstocks("NIFTY"),
    bootstrapIndstocks("SENSEX"),
  ]);
  if (onStatusCallback) onStatusCallback("INDstocks token updated");
  if (onDataCallback) onDataCallback(getData());
}

export function getData() {
  return {
    NIFTY: {
      price: latestPrices.NIFTY.price,
      open: latestPrices.NIFTY.open,
      high: latestPrices.NIFTY.high,
      low: latestPrices.NIFTY.low,
      volume: latestPrices.NIFTY.volume,
      change: latestPrices.NIFTY.change,
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
      change: latestPrices.SENSEX.change,
      direction: latestPrices.SENSEX.direction,
      vwap: round2(state.SENSEX.vwap),
      ema9: round2(state.SENSEX.ema9),
    },
    SOL: {
      price: latestPrices.SOL.price,
      open: latestPrices.SOL.open,
      high: latestPrices.SOL.high,
      low: latestPrices.SOL.low,
      volume: latestPrices.SOL.volume,
      change: latestPrices.SOL.change,
      direction: latestPrices.SOL.direction,
      vwap: round2(state.SOL.vwap),
      ema9: round2(state.SOL.ema9),
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

  // Bootstrap historical indicators for all 3 assets in parallel
  if (onStatusCallback) onStatusCallback("Fetching historical data for NIFTY, SENSEX & SOL...");
  await Promise.all([
    bootstrapIndstocks("NIFTY"),
    bootstrapIndstocks("SENSEX"),
    bootstrapCoindcx(),
  ]);

  showOrUpdateTickerNotification(getData());

  // Start 1-second countdown session timer loop
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

  // Connect live price feeds
  if (onStatusCallback) onStatusCallback("Connecting to live market feeds...");

  // 1. INDstocks WebSocket & REST polling for NIFTY & SENSEX
  const indInstruments = [INSTRUMENTS.NIFTY.wsInstrument, INSTRUMENTS.SENSEX.wsInstrument];
  connectPriceFeed(
    handleIndstocksQuote,
    () => {
      subscribeToInstruments(indInstruments);
    },
    () => {
      console.log("[INDstocks] WS disconnected, falling back to REST");
    }
  );
  startIndstocksPolling(handleIndstocksRESTPoll, 5000);

  // 2. CoinDCX REST polling for SOL/USDT
  startCoindcxPolling(handleCoindcxTick, 3000);

  if (onStatusCallback) onStatusCallback("Connected — 6h multi-asset monitoring active");
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
  stopIndstocksPolling();
  stopCoindcxPolling();
  await cancelTickerNotification();

  // Reset state
  for (const label of Object.keys(state)) {
    state[label] = createIndicatorState();
    latestPrices[label] = {
      price: 0,
      open: 0,
      high: 0,
      low: 0,
      volume: 0,
      change: 0,
      direction: "above",
    };
    lastCandleTs[label] = 0;
  }
}
