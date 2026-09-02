import { EMA_PERIOD } from "./config";

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
