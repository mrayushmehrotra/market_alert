import { EMA_PERIOD } from "./config";

// ---------- VWAP ----------

export function computeVWAPFromCandles(candles) {
  let cumTypicalVolume = 0;
  let cumVolume = 0;

  for (const c of candles) {
    const typicalPrice = (c.h + c.l + c.c) / 3;
    cumTypicalVolume += typicalPrice * c.v;
    cumVolume += c.v;
  }

  const vwap = cumVolume > 0 ? cumTypicalVolume / cumVolume : 0;
  return { vwap, cumVolume, cumTypicalVolume };
}

export function updateVWAP(cumTypicalVolume, cumVolume, candle) {
  const typicalPrice = (candle.h + candle.l + candle.c) / 3;
  const newCumTV = cumTypicalVolume + typicalPrice * candle.v;
  const newCumVol = cumVolume + candle.v;
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
