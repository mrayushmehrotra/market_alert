import { EMA_PERIOD, SUPERTREND_ATR_LENGTH, SUPERTREND_FACTOR, SMA_PERIOD } from "./config";

// ---------- VWAP ----------

function getISTDayString(tsSeconds) {
  if (!tsSeconds) return "";
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const d = new Date(tsSeconds * 1000 + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

export function computeVWAPFromCandles(candles) {
  if (!candles || candles.length === 0) {
    return { vwap: 0, cumVolume: 0, cumTypicalVolume: 0 };
  }

  // VWAP is an intraday indicator that resets every trading session.
  // Filter candles to only include the latest trading day in the dataset.
  const lastTs = candles[candles.length - 1].ts;
  const lastDay = getISTDayString(lastTs);
  const dayCandles = candles.filter((c) => getISTDayString(c.ts) === lastDay);

  let cumTypicalVolume = 0;
  let cumVolume = 0;

  for (const c of dayCandles) {
    const typicalPrice = (c.h + c.l + c.c) / 3;
    // For indices (NIFTY/SENSEX), volume is often 0 or unweighted; fallback to 1 so price is weighted across candles.
    const vol = c.v > 0 ? c.v : 1;
    cumTypicalVolume += typicalPrice * vol;
    cumVolume += vol;
  }

  const vwap = cumVolume > 0 ? cumTypicalVolume / cumVolume : 0;
  return { vwap, cumVolume, cumTypicalVolume };
}

export function updateVWAP(cumTypicalVolume, cumVolume, candle) {
  const typicalPrice = (candle.h + candle.l + candle.c) / 3;
  const vol = candle.v > 0 ? candle.v : 1;
  const newCumTV = cumTypicalVolume + typicalPrice * vol;
  const newCumVol = cumVolume + vol;
  const vwap = newCumVol > 0 ? newCumTV / newCumVol : 0;
  return { vwap, cumVolume: newCumVol, cumTypicalVolume: newCumTV };
}

// ---------- EMA ----------

export function computeEMA9FromCloses(closes, period = EMA_PERIOD) {
  if (closes.length === 0) return 0;
  if (closes.length < period) {
    // Not enough data — return SMA of available closes
    return closes.reduce((a, b) => a + b, 0) / closes.length;
  }

  // First EMA = SMA of first `period` closes
  let ema = 0;
  for (let i = 0; i < period; i++) ema += closes[i];
  ema /= period;

  const multiplier = 2 / (period + 1);
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * multiplier + ema * (1 - multiplier);
  }

  return ema;
}

export function updateEMA9(prevEMA, newClose, period = EMA_PERIOD) {
  const multiplier = 2 / (period + 1);
  return newClose * multiplier + prevEMA * (1 - multiplier);
}

// ---------- Cross Detection ----------

export function detectCross(prevEMA, prevVWAP, currEMA, currVWAP) {
  if (!prevEMA || !prevVWAP || !currEMA || !currVWAP) return null;

  const wasAbove = prevEMA > prevVWAP;
  const isAbove = currEMA > currVWAP;

  if (!wasAbove && isAbove) return "bullish"; // EMA crossed ABOVE VWAP
  if (wasAbove && !isAbove) return "bearish"; // EMA crossed BELOW VWAP
  return null;
}

// ---------- Indicator State Factory ----------

export function createIndicatorState() {
  return {
    vwap: 0,
    ema9: 0,
    cumVolume: 0,
    cumTypicalVolume: 0,
    lastClose: 0,
  };
}

// ==========================================================
// SUPERTREND INDICATOR (ATR Length=5, Factor=1)
// ==========================================================

/**
 * Compute ATR (Average True Range) using Wilder's smoothing (RMA).
 * Returns array of ATR values aligned with candles (first `period` entries are NaN).
 */
function computeATR(candles, period = SUPERTREND_ATR_LENGTH) {
  if (!candles || candles.length < 2) return [];

  const atr = new Array(candles.length).fill(NaN);

  // True Range for each candle (starting from index 1)
  const tr = [0]; // index 0 has no previous close
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].h;
    const low = candles[i].l;
    const prevClose = candles[i - 1].c;
    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }

  // Seed ATR with SMA of first `period` TRs (starting from index 1)
  if (candles.length < period + 1) return atr;

  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  atr[period] = sum / period;

  // Wilder's RMA smoothing: ATR_i = (ATR_{i-1} * (n-1) + TR_i) / n
  for (let i = period + 1; i < candles.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }

  return atr;
}

/**
 * Compute full Supertrend series from historical candles.
 * Uses "Wait for timeframe closes" logic — only confirmed closed candles are processed.
 *
 * Returns: { value, direction, finalUpperBand, finalLowerBand, atrValues }
 *   direction: 1 = uptrend (bullish), -1 = downtrend (bearish)
 */
export function computeSupertrendFromCandles(
  candles,
  atrLength = SUPERTREND_ATR_LENGTH,
  factor = SUPERTREND_FACTOR
) {
  if (!candles || candles.length < atrLength + 2) {
    return { value: 0, direction: 1, finalUpperBand: 0, finalLowerBand: 0 };
  }

  const atr = computeATR(candles, atrLength);

  // Arrays to store band history
  const finalUpper = new Array(candles.length).fill(0);
  const finalLower = new Array(candles.length).fill(0);
  const supertrend = new Array(candles.length).fill(0);
  const direction = new Array(candles.length).fill(1); // 1=up, -1=down

  // Start computing from the first valid ATR index
  const startIdx = atrLength;

  for (let i = startIdx; i < candles.length; i++) {
    const hl2 = (candles[i].h + candles[i].l) / 2;
    const atrVal = atr[i];

    if (isNaN(atrVal)) continue;

    const basicUpper = hl2 + factor * atrVal;
    const basicLower = hl2 - factor * atrVal;

    // Final Upper Band: can only move DOWN (tighten), never up
    if (i === startIdx) {
      finalUpper[i] = basicUpper;
    } else {
      finalUpper[i] =
        basicUpper < finalUpper[i - 1] || candles[i - 1].c > finalUpper[i - 1]
          ? basicUpper
          : finalUpper[i - 1];
    }

    // Final Lower Band: can only move UP (tighten), never down
    if (i === startIdx) {
      finalLower[i] = basicLower;
    } else {
      finalLower[i] =
        basicLower > finalLower[i - 1] || candles[i - 1].c < finalLower[i - 1]
          ? basicLower
          : finalLower[i - 1];
    }

    // Determine trend direction
    if (i === startIdx) {
      direction[i] = candles[i].c > finalUpper[i] ? 1 : -1;
    } else {
      if (direction[i - 1] === 1) {
        // Was uptrend — stays up unless close drops below final lower
        direction[i] = candles[i].c < finalLower[i] ? -1 : 1;
      } else {
        // Was downtrend — stays down unless close breaks above final upper
        direction[i] = candles[i].c > finalUpper[i] ? 1 : -1;
      }
    }

    // Supertrend value = lower band when uptrend, upper band when downtrend
    supertrend[i] = direction[i] === 1 ? finalLower[i] : finalUpper[i];
  }

  const lastIdx = candles.length - 1;
  return {
    value: supertrend[lastIdx],
    direction: direction[lastIdx], // 1 = bullish, -1 = bearish
    finalUpperBand: finalUpper[lastIdx],
    finalLowerBand: finalLower[lastIdx],
  };
}

/**
 * Detect if Supertrend direction has flipped.
 * Returns "bullish" (turned green), "bearish" (turned red), or null.
 */
export function detectSupertrendFlip(prevDirection, currDirection) {
  if (prevDirection === currDirection) return null;
  if (prevDirection === -1 && currDirection === 1) return "bullish"; // flipped to uptrend
  if (prevDirection === 1 && currDirection === -1) return "bearish"; // flipped to downtrend
  return null;
}

// ==========================================================
// SMA (Simple Moving Average) — for 1D candle close detection
// ==========================================================

/**
 * Compute SMA from an array of close prices.
 * Returns the SMA value for the latest `period` closes.
 */
export function computeSMAFromCloses(closes, period = SMA_PERIOD) {
  if (!closes || closes.length === 0) return 0;
  const len = Math.min(period, closes.length);
  const slice = closes.slice(-len);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

/**
 * Detect if the latest daily candle closed above or below the SMA line.
 * prevClose/prevSMA are from the previous candle, currClose/currSMA from the latest closed candle.
 * Returns "bullish" if crossed above, "bearish" if crossed below, null if no change.
 */
export function detectSMACross(prevClose, prevSMA, currClose, currSMA) {
  if (!prevSMA || !currSMA || !prevClose || !currClose) return null;

  const wasAbove = prevClose > prevSMA;
  const isAbove = currClose > currSMA;

  if (!wasAbove && isAbove) return "bullish"; // closed above SMA
  if (wasAbove && !isAbove) return "bearish"; // closed below SMA
  return null;
}

// ---------- Crypto Indicator State Factory ----------

export function createCryptoIndicatorState() {
  return {
    // Supertrend (4H)
    supertrendValue: 0,
    supertrendDirection: 1, // 1 = bullish/up, -1 = bearish/down
    // SMA (1D)
    sma: 0,
    lastDailyClose: 0,
    prevDailyClose: 0,
    prevSMA: 0,
    // General
    lastClose: 0,
  };
}

