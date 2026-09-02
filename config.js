import Constants from "expo-constants";

export const COINDCX_API_KEY =
  Constants.expoConfig?.extra?.COINDCX_API_KEY || "";
export const COINDCX_API_SECRET =
  Constants.expoConfig?.extra?.COINDCX_API_SECRET || "";

export const COINDCX_PUBLIC_URL = "https://public.coindcx.com";
export const COINDCX_REST_URL = "https://api.coindcx.com";

export const INSTRUMENTS = {
  SOL: {
    label: "SOL / USDT",
    pair: "B-SOL_USDT",
    market: "SOL_USDT",
  },
};

export const EMA_PERIOD = 9;
export const CANDLE_INTERVAL = "5m";

