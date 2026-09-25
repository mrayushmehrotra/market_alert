import {
  INSTRUMENTS,
  EMA_PERIOD,
  CANDLE_INTERVAL_INDSTOCKS,
  CANDLE_INTERVAL_4H,
  CANDLE_INTERVAL_1D,
  SUPERTREND_ATR_LENGTH,
  SUPERTREND_FACTOR,
  SMA_PERIOD,
} from "./config";
import {
  fetchHistoricalCandles as fetchIndstocksCandles,
  connectPriceFeed,
  subscribeToInstruments,
  disconnectPriceFeed,
  startRESTPolling as startIndstocksPolling,
  stopRESTPolling as stopIndstocksPolling,
  loadSavedApiToken,
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
  computeSupertrendFromCandles,
  detectSupertrendFlip,
  computeSMAFromCloses,
  detectSMACross,
  createCryptoIndicatorState,
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

// Indian stock indicators (EMA9/VWAP — unchanged)
const state = {
  NIFTY: createIndicatorState(),
  SENSEX: createIndicatorState(),
};

// Crypto indicators (Supertrend 4H + SMA 1D)
const cryptoState = {
  SOL: createCryptoIndicatorState(),
  XAU: createCryptoIndicatorState(),
};

const latestPrices = {
  NIFTY: { price: 0, open: 0, high: 0, low: 0, volume: 0, change: 0, direction: "above" },
  SENSEX: { price: 0, open: 0, high: 0, low: 0, volume: 0, change: 0, direction: "above" },
  SOL: { price: 0, open: 0, high: 0, low: 0, volume: 0, change: 0, direction: "above" },
  XAU: { price: 0, open: 0, high: 0, low: 0, volume: 0, change: 0, direction: "above" },
};

let lastCandleTs = { NIFTY: 0, SENSEX: 0 };
let onDataCallback = null;
let onCrossCallback = null;
let onStatusCallback = null;

// Candle polling timer for crypto (60s refresh for 4H/1D candles)
let candlePollTimer = null;

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

// ---------- Bootstrap: Indian Stocks (EMA9/VWAP — UNCHANGED) ----------

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
    if (
      err.message.includes("TOKEN_EXPIRED") ||
      err.message.includes("403") ||
      err.message.includes("401") ||
      err.message.includes("access_token")
    ) {
      if (onStatusCallback) {
        onStatusCallback("⚠️ INDmoney Token Expired — Please update token");
      }
    }
  }
}

// ---------- Bootstrap: Crypto Supertrend (4H) + SMA (1D) ----------

async function bootstrapCryptoSupertrend(key) {
  const inst = INSTRUMENTS[key];
  if (!inst || !inst.pair) return;

  try {
    // Fetch 4H candles for Supertrend (500 candles = ~83 days of 4H data)
    const candles4H = await fetchCoindcxCandles(inst.pair, CANDLE_INTERVAL_4H, 500);
    if (candles4H && candles4H.length > 0) {
      candles4H.sort((a, b) => a.ts - b.ts);
      const st = computeSupertrendFromCandles(candles4H, SUPERTREND_ATR_LENGTH, SUPERTREND_FACTOR);
      cryptoState[key].supertrendValue = st.value;
      cryptoState[key].supertrendDirection = st.direction;
      cryptoState[key].lastClose = candles4H[candles4H.length - 1].c;
      console.log(`[Ticker] ${key} Supertrend bootstrapped: value=${round2(st.value)}, direction=${st.direction === 1 ? "UP" : "DOWN"}`);
    }

    // Fetch 1D candles for SMA (500 candles = ~500 days)
    const candles1D = await fetchCoindcxCandles(inst.pair, CANDLE_INTERVAL_1D, 500);
    if (candles1D && candles1D.length > 0) {
      candles1D.sort((a, b) => a.ts - b.ts);
      const closes = candles1D.map((c) => c.c);
      cryptoState[key].sma = computeSMAFromCloses(closes, SMA_PERIOD);
      cryptoState[key].lastDailyClose = closes[closes.length - 1] || 0;
      // Store previous day's close and SMA for cross detection
      if (closes.length >= 2) {
        cryptoState[key].prevDailyClose = closes[closes.length - 2];
        const prevCloses = closes.slice(0, -1);
        cryptoState[key].prevSMA = computeSMAFromCloses(prevCloses, SMA_PERIOD);
      }
      console.log(`[Ticker] ${key} SMA(${SMA_PERIOD}) bootstrapped: value=${round2(cryptoState[key].sma)}, lastClose=${round2(cryptoState[key].lastDailyClose)}`);
    }

    // Set initial price from latest candle if no LTP yet
    if (latestPrices[key].price === 0 && candles4H && candles4H.length > 0) {
      const last = candles4H[candles4H.length - 1];
      latestPrices[key] = {
        price: last.c,
        open: last.o,
        high: last.h,
        low: last.l,
        volume: last.v,
        change: 0,
        direction: cryptoState[key].supertrendDirection === 1 ? "above" : "below",
      };
    }
  } catch (err) {
    console.warn(`[Ticker] Bootstrap error ${key}:`, err.message);
  }
}

// ---------- Candle Polling for Crypto (60s) ----------

/**
 * Poll 4H and 1D candles every 60s for all crypto pairs.
 * Only processes CLOSED candles ("Wait for timeframe closes" logic).
 * Detects Supertrend direction flips and SMA crosses.
 */
async function pollCryptoCandles() {
  for (const key of ["SOL", "XAU"]) {
    const inst = INSTRUMENTS[key];
    if (!inst || !inst.pair) continue;

    try {
      // --- Supertrend on 4H closed candles ---
      const candles4H = await fetchCoindcxCandles(inst.pair, CANDLE_INTERVAL_4H, 500);
      if (candles4H && candles4H.length > 0) {
        candles4H.sort((a, b) => a.ts - b.ts);

        const prevDirection = cryptoState[key].supertrendDirection;
        const st = computeSupertrendFromCandles(candles4H, SUPERTREND_ATR_LENGTH, SUPERTREND_FACTOR);
        cryptoState[key].supertrendValue = st.value;
        cryptoState[key].supertrendDirection = st.direction;
        cryptoState[key].lastClose = candles4H[candles4H.length - 1].c;

        // Detect Supertrend flip (only on closed candles)
        const flip = detectSupertrendFlip(prevDirection, st.direction);
        if (flip) {
          crossCount++;
          const crossPayload = {
            type: "supertrend",
            label: inst.label,
            cross: flip,
            price: latestPrices[key].price || candles4H[candles4H.length - 1].c,
            supertrend: round2(st.value),
            direction: st.direction === 1 ? "Bullish" : "Bearish",
          };
          console.log(`[Ticker] 🔔 ${key} SUPERTREND FLIP: ${flip.toUpperCase()}`);
          if (onCrossCallback) onCrossCallback(crossPayload);
          showCrossAlert(crossPayload);
        }
      }

      // --- SMA on 1D closed candles ---
      const candles1D = await fetchCoindcxCandles(inst.pair, CANDLE_INTERVAL_1D, 500);
      if (candles1D && candles1D.length > 0) {
        candles1D.sort((a, b) => a.ts - b.ts);
        const closes = candles1D.map((c) => c.c);
        const newSMA = computeSMAFromCloses(closes, SMA_PERIOD);
        const newClose = closes[closes.length - 1] || 0;

        // Detect SMA cross (only when a new daily candle has closed)
        const prevClose = cryptoState[key].lastDailyClose;
        const prevSMA = cryptoState[key].sma;

        if (newClose !== prevClose && prevClose > 0) {
          const smaCross = detectSMACross(prevClose, prevSMA, newClose, newSMA);
          if (smaCross) {
            crossCount++;
            const crossPayload = {
              type: "sma",
              label: inst.label,
              cross: smaCross,
              price: newClose,
              sma: round2(newSMA),
              direction: smaCross === "bullish" ? "Above SMA" : "Below SMA",
            };
            console.log(`[Ticker] 🔔 ${key} SMA CROSS: ${smaCross.toUpperCase()}`);
            if (onCrossCallback) onCrossCallback(crossPayload);
            showCrossAlert(crossPayload);
          }
        }

        // Update stored SMA state
        cryptoState[key].prevDailyClose = cryptoState[key].lastDailyClose;
        cryptoState[key].prevSMA = cryptoState[key].sma;
        cryptoState[key].lastDailyClose = newClose;
        cryptoState[key].sma = newSMA;
      }
    } catch (err) {
      console.warn(`[Ticker] Candle poll error ${key}:`, err.message);
    }
  }

  // Refresh UI after candle poll
  showOrUpdateTickerNotification(getData());
  if (onDataCallback) onDataCallback(getData());
}

function startCandlePolling(intervalMs = 60000) {
  stopCandlePolling();
  candlePollTimer = setInterval(pollCryptoCandles, intervalMs);
}

function stopCandlePolling() {
  if (candlePollTimer) {
    clearInterval(candlePollTimer);
    candlePollTimer = null;
  }
}

// ---------- Real-time tick handlers (Indian Stocks — UNCHANGED) ----------

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

  processIndstocksPriceUpdate(label, price, data.high, data.low, data.volume, data.open);
}

function handleIndstocksRESTPoll({ NIFTY: nPrice, SENSEX: sPrice }) {
  if (nPrice) processIndstocksPriceUpdate("NIFTY", nPrice);
  if (sPrice) processIndstocksPriceUpdate("SENSEX", sPrice);
}

/**
 * Handle multi-market CoinDCX LTP data.
 * Only updates live price display — indicator processing is done via candle polling.
 */
function handleCoindcxMultiTick(data) {
  if (!data || typeof data !== "object") return;

  for (const key of ["SOL", "XAU"]) {
    const inst = INSTRUMENTS[key];
    if (!inst) continue;

    const tickData = data[inst.market];
    if (!tickData || !tickData.price) continue;

    // Update live price display only (indicators are computed from candle polling)
    latestPrices[key] = {
      price: tickData.price,
      high: tickData.high || latestPrices[key].high,
      low: tickData.low || latestPrices[key].low,
      volume: tickData.volume || latestPrices[key].volume,
      change: tickData.change || latestPrices[key].change,
      open: latestPrices[key].open || tickData.price,
      direction: cryptoState[key].supertrendDirection === 1 ? "above" : "below",
    };
  }

  showOrUpdateTickerNotification(getData());
  if (onDataCallback) onDataCallback(getData());
}

// Indian stocks price processing (EMA9/VWAP — UNCHANGED logic)
function processIndstocksPriceUpdate(label, price, high, low, volume, open, changeVal) {
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
      supertrend: round2(cryptoState.SOL.supertrendValue),
      supertrendDirection: cryptoState.SOL.supertrendDirection,
      sma: round2(cryptoState.SOL.sma),
      lastDailyClose: round2(cryptoState.SOL.lastDailyClose),
    },
    XAU: {
      price: latestPrices.XAU.price,
      open: latestPrices.XAU.open,
      high: latestPrices.XAU.high,
      low: latestPrices.XAU.low,
      volume: latestPrices.XAU.volume,
      change: latestPrices.XAU.change,
      direction: latestPrices.XAU.direction,
      supertrend: round2(cryptoState.XAU.supertrendValue),
      supertrendDirection: cryptoState.XAU.supertrendDirection,
      sma: round2(cryptoState.XAU.sma),
      lastDailyClose: round2(cryptoState.XAU.lastDailyClose),
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

  await loadSavedApiToken();
  await setupChannels();

  // Reset 6-hour session counters
  sessionStartTime = Date.now();
  sessionRunning = true;
  crossCount = 0;

  // Bootstrap historical indicators for all assets in parallel
  if (onStatusCallback) onStatusCallback("Fetching historical data for NIFTY, SENSEX, SOL & XAU...");
  await Promise.all([
    bootstrapIndstocks("NIFTY"),
    bootstrapIndstocks("SENSEX"),
    bootstrapCryptoSupertrend("SOL"),
    bootstrapCryptoSupertrend("XAU"),
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

  // 1. INDstocks WebSocket & REST polling for NIFTY & SENSEX (UNCHANGED)
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

  // 2. CoinDCX REST polling for SOL & XAU live prices (3s)
  startCoindcxPolling(handleCoindcxMultiTick, 3000);

  // 3. CoinDCX 4H/1D candle polling for Supertrend & SMA (60s)
  startCandlePolling(60000);

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
  stopCandlePolling();
  await cancelTickerNotification();

  // Reset Indian stock state
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
  }

  // Reset crypto state
  for (const key of Object.keys(cryptoState)) {
    cryptoState[key] = createCryptoIndicatorState();
    latestPrices[key] = {
      price: 0,
      open: 0,
      high: 0,
      low: 0,
      volume: 0,
      change: 0,
      direction: "above",
    };
  }

  lastCandleTs = { NIFTY: 0, SENSEX: 0 };
}
