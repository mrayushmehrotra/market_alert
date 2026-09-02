import { INSTRUMENTS, EMA_PERIOD } from "./config";
import {
  fetchHistoricalCandles,
  startRESTPolling,
  stopRESTPolling,
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
  SOL: createIndicatorState(),
};

const latestPrices = {
  SOL: {
    price: 0,
    open: 0,
    high: 0,
    low: 0,
    volume: 0,
    change: 0,
    direction: "above",
  },
};

let lastCandleTs = 0;
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

// ---------- Bootstrap indicators from historical 5m candles ----------

async function bootstrapIndicators() {
  const inst = INSTRUMENTS.SOL;
  if (!inst) return;

  try {
    const candles = await fetchHistoricalCandles(inst.pair, "5m", 500);

    if (!candles || candles.length === 0) {
      console.log(`[Ticker] No historical candles for ${inst.label}`);
      return;
    }

    // Sort by timestamp ascending
    candles.sort((a, b) => a.ts - b.ts);

    // Compute VWAP from all candles
    const vwapResult = computeVWAPFromCandles(candles);
    state.SOL.vwap = vwapResult.vwap;
    state.SOL.cumVolume = vwapResult.cumVolume;
    state.SOL.cumTypicalVolume = vwapResult.cumTypicalVolume;

    // Compute EMA9 from close prices
    const closes = candles.map((c) => c.c);
    state.SOL.ema9 = computeEMA9FromCloses(closes, EMA_PERIOD);
    state.SOL.lastClose = closes[closes.length - 1] || 0;

    // Record last candle timestamp
    lastCandleTs = candles[candles.length - 1].ts;

    // Set latest price from last candle
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

    console.log(
      `[Ticker] ${inst.label} bootstrapped: VWAP=${round2(state.SOL.vwap)} EMA9=${round2(state.SOL.ema9)} candles=${candles.length}`
    );
  } catch (err) {
    console.error(`[Ticker] Failed to bootstrap ${inst.label}:`, err.message);
  }
}

// ---------- Handle live price tick from CoinDCX ----------

function handleLiveTick(data) {
  if (!data || !data.price) return;

  const price = data.price;
  const prevEMA = state.SOL.ema9;
  const prevVWAP = state.SOL.vwap;

  if (price !== latestPrices.SOL.price) {
    latestPrices.SOL.price = price;
    latestPrices.SOL.high = data.high || latestPrices.SOL.high || price;
    latestPrices.SOL.low = data.low || latestPrices.SOL.low || price;
    latestPrices.SOL.volume = data.volume || latestPrices.SOL.volume;
    latestPrices.SOL.change = data.change || latestPrices.SOL.change;
    latestPrices.SOL.direction = price >= prevVWAP ? "above" : "below";

    // Update EMA9
    if (prevEMA > 0) {
      state.SOL.ema9 = updateEMA9(prevEMA, price, EMA_PERIOD);
      state.SOL.lastClose = price;
    } else {
      state.SOL.ema9 = price;
    }

    // Update VWAP with tick
    const currentCandle = {
      h: latestPrices.SOL.high,
      l: latestPrices.SOL.low,
      c: price,
      v: latestPrices.SOL.volume || 100,
    };
    const vwapResult = updateVWAP(
      state.SOL.cumTypicalVolume,
      state.SOL.cumVolume,
      currentCandle
    );
    state.SOL.vwap = vwapResult.vwap;

    // Detect crossover
    const cross = detectCross(prevEMA, prevVWAP, state.SOL.ema9, state.SOL.vwap);
    if (cross) {
      crossCount++;
      const crossPayload = {
        label: INSTRUMENTS.SOL.label,
        cross,
        price,
        vwap: round2(state.SOL.vwap),
        ema: round2(state.SOL.ema9),
      };
      if (onCrossCallback) onCrossCallback(crossPayload);
      showCrossAlert(crossPayload);
    }
  }

  showOrUpdateTickerNotification(getData());
  if (onDataCallback) onDataCallback(getData());
}

// ---------- Public API ----------

export function getData() {
  return {
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

  // Bootstrap from historical data
  if (onStatusCallback) onStatusCallback("Fetching SOL/USDT historical data...");
  await bootstrapIndicators();

  // Show initial notification
  showOrUpdateTickerNotification(getData());

  // Start 1-second session timer loop for countdown updates & auto-stop
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

  // Poll CoinDCX live ticker
  if (onStatusCallback) onStatusCallback("Connected — SOL/USDT 6h monitoring active");
  startRESTPolling(handleLiveTick, 3000);

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

  stopRESTPolling();
  await cancelTickerNotification();

  // Reset state
  state.SOL = createIndicatorState();
  latestPrices.SOL = {
    price: 0,
    open: 0,
    high: 0,
    low: 0,
    volume: 0,
    change: 0,
    direction: "above",
  };
  lastCandleTs = 0;
}
