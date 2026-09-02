import Constants from "expo-constants";

export const API_TOKEN =
  Constants.expoConfig?.extra?.INDMONEY_API_KEY || "";

export const INDSTOCKS_BASE_URL = "https://api.indstocks.com";
export const INDSTOCKS_WS_URL =
  "wss://ws-prices.indstocks.com/api/v1/ws/prices";

// Scrip codes for REST API (GET /market/historical, /market/quotes)
// These are from the instruments CSV: source=index
// Will be validated at runtime; fallback values from docs
export const INSTRUMENTS = {
  NIFTY: {
    label: "NIFTY",
    restScrip: "NSE_40000001", // NIFTY 50 index
    wsInstrument: "NIDX:26000", // WebSocket format for NIFTY 50
  },
  SENSEX: {
    label: "SENSEX",
    restScrip: "BSE_40000006", // SENSEX index (BSE) — token from instruments CSV
    wsInstrument: "BIDX:1", // WebSocket format for SENSEX
  },
};

export const EMA_PERIOD = 9;
export const CANDLE_INTERVAL = "5minute";

// Indian market hours IST
export const MARKET_OPEN_HOUR = 9;
export const MARKET_OPEN_MINUTE = 15;
export const MARKET_CLOSE_HOUR = 15;
export const MARKET_CLOSE_MINUTE = 30;
