import Constants from "expo-constants";

export const API_TOKEN =
  Constants.expoConfig?.extra?.INDMONEY_API_KEY || "";
export const INDSTOCKS_BASE_URL = "https://api.indstocks.com";
export const INDSTOCKS_WS_URL =
  "wss://ws-prices.indstocks.com/api/v1/ws/prices";

export const COINDCX_API_KEY =
  Constants.expoConfig?.extra?.COINDCX_API_KEY || "";
export const COINDCX_API_SECRET =
  Constants.expoConfig?.extra?.COINDCX_API_SECRET || "";

export const COINDCX_PUBLIC_URL = "https://public.coindcx.com";
export const COINDCX_REST_URL = "https://api.coindcx.com";

export const INSTRUMENTS = {
  NIFTY: {
    label: "NIFTY 50",
    restScrip: "NSE_40000001",
    wsInstrument: "NIDX:26000",
  },
  SENSEX: {
    label: "SENSEX",
    restScrip: "BSE_40000006",
    wsInstrument: "BIDX:1",
  },
  SOL: {
    label: "SOL / USDT",
    pair: "B-SOL_USDT",
    market: "SOL_USDT",
  },
};

export const EMA_PERIOD = 9;
export const CANDLE_INTERVAL_INDSTOCKS = "5minute";
export const CANDLE_INTERVAL_COINDCX = "5m";
export const CANDLE_INTERVAL = "5minute";


