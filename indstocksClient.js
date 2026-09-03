import Constants from "expo-constants";
import storage from "./storage";
import {
  API_TOKEN,
  INDSTOCKS_BASE_URL,
  INDSTOCKS_WS_URL,
  CANDLE_INTERVAL_INDSTOCKS,
  INSTRUMENTS,
} from "./config";

const TOKEN_STORAGE_KEY = "NIFTY_ALERT_INDMONEY_API_KEY";

let customToken = "";

export async function loadSavedApiToken() {
  try {
    const saved = await storage.getItem(TOKEN_STORAGE_KEY);
    if (saved) {
      customToken = saved.replace(/^["']|["']$/g, "").trim();
    }
  } catch {}
}

export function setApiToken(token) {
  const clean = (token || "").replace(/^["']|["']$/g, "").trim();
  customToken = clean;
  if (clean) {
    storage.setItem(TOKEN_STORAGE_KEY, clean);
  } else {
    storage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export function getApiToken() {
  if (customToken) return customToken;
  const raw =
    process.env.EXPO_PUBLIC_INDMONEY_API_KEY ||
    Constants.expoConfig?.extra?.INDMONEY_API_KEY ||
    process.env.INDMONEY_API_KEY ||
    API_TOKEN ||
    "";
  return raw.replace(/^["']|["']$/g, "").trim();
}

const INSTRUMENTS_REST = {
  NIFTY: INSTRUMENTS.NIFTY.restScrip,
  SENSEX: INSTRUMENTS.SENSEX.restScrip,
};

// ---------- REST ----------

export async function fetchHistoricalCandles(scripCode, startTimeMs, endTimeMs) {
  const token = getApiToken();
  const url = `${INDSTOCKS_BASE_URL}/market/historical/${CANDLE_INTERVAL_INDSTOCKS}?scrip-codes=${scripCode}&start_time=${startTimeMs}&end_time=${endTimeMs}`;

  const res = await fetch(url, {
    headers: { Authorization: token },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Historical data fetch failed (${res.status}): ${text}`);
  }

  const json = await res.json();

  if (!json.success) {
    throw new Error("Historical data API returned success=false");
  }

  const scripData = json.data?.[scripCode];
  return scripData?.candles || [];
}

export async function fetchLTP(scripCodes) {
  const token = getApiToken();
  const codes = scripCodes.join(",");
  const url = `${INDSTOCKS_BASE_URL}/market/quotes/ltp?scrip-codes=${codes}`;

  const res = await fetch(url, {
    headers: { Authorization: token },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LTP fetch failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  return json.data || {};
}

export async function fetchInstruments(source = "index") {
  const token = getApiToken();
  const url = `${INDSTOCKS_BASE_URL}/market/instruments?source=${source}`;

  const res = await fetch(url, {
    headers: { Authorization: token },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Instruments fetch failed (${res.status}): ${text}`);
  }

  const csv = await res.text();
  return csv;
}

// ---------- WebSocket ----------

let ws = null;
let reconnectTimeout = null;
let reconnectDelay = 1000;
let intentionalDisconnect = false;
const MAX_RECONNECT_DELAY = 30000;

function describeCloseCode(code) {
  const known = {
    1000: "normal closure",
    1001: "going away",
    1002: "protocol error",
    1003: "unsupported data",
    1006: "abnormal closure",
    1007: "invalid payload",
    1008: "policy violation (check API token)",
    1009: "message too big",
    1011: "server error",
    1015: "TLS handshake failed",
  };
  return known[code] || `code ${code}`;
}

function parseWsMessage(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "object") return raw;

  const text = String(raw).trim();
  if (!text || text === "ping" || text === "pong") return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function connectPriceFeed(onQuote, onConnect, onDisconnect) {
  const token = getApiToken();
  if (!token) {
    console.warn("[WS] Skipping WebSocket — missing API token (REST polling still active)");
    if (onDisconnect) onDisconnect();
    return null;
  }

  intentionalDisconnect = false;

  if (ws) {
    ws.close();
    ws = null;
  }

  const isWeb = typeof window !== "undefined" && typeof window.document !== "undefined";
  try {
    if (isWeb) {
      // Browsers cannot set custom headers on WebSocket connections.
      ws = new WebSocket(INDSTOCKS_WS_URL);
    } else {
      ws = new WebSocket(INDSTOCKS_WS_URL, null, {
        headers: { Authorization: token },
      });
    }
  } catch (err) {
    console.warn("[WS] Failed to create WebSocket:", err.message);
    if (!intentionalDisconnect) scheduleReconnect(onQuote, onConnect, onDisconnect);
    return null;
  }

  ws.onopen = () => {
    console.log("[WS] Connected to INDstocks price feed");
    reconnectDelay = 1000;
    if (onConnect) onConnect();
  };

  ws.onmessage = (event) => {
    const msg = parseWsMessage(event.data);
    if (!msg) return;

    // Ignore heartbeats
    if (msg.type === "heartbeat" || msg.ping) return;

    if (msg.mode && msg.instrument && msg.data) {
      if (onQuote) onQuote(msg);
    }
  };

  ws.onerror = () => {
    // RN/Web only expose a generic Event here; onclose carries the useful details.
  };

  ws.onclose = (event) => {
    const detail = event.reason || describeCloseCode(event.code);
    console.warn(`[WS] Disconnected (${event.code}: ${detail})`);

    if (intentionalDisconnect) return;

    if (onDisconnect) onDisconnect();
    scheduleReconnect(onQuote, onConnect, onDisconnect);
  };

  return ws;
}

function scheduleReconnect(onQuote, onConnect, onDisconnect) {
  if (intentionalDisconnect || !getApiToken()) return;

  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  reconnectTimeout = setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    console.log("[WS] Reconnecting in", reconnectDelay, "ms");
    connectPriceFeed(onQuote, onConnect, onDisconnect);
  }, reconnectDelay);
}

let lastSubscribeWarnAt = 0;

export function subscribeToInstruments(instruments) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    const now = Date.now();
    if (now - lastSubscribeWarnAt >= 30000) {
      lastSubscribeWarnAt = now;
      console.warn("[WS] Cannot subscribe — not connected (retrying)");
    }
    return;
  }

  const msg = {
    action: "subscribe",
    mode: "quote",
    instruments: instruments,
  };

  ws.send(JSON.stringify(msg));
  console.log("[WS] Subscribed to:", instruments);
}

export function disconnectPriceFeed() {
  intentionalDisconnect = true;

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
}

// ---------- REST Polling (fallback when WS unavailable) ----------

let pollTimer = null;

// Polls REST LTP for live prices. `callback` receives {label, price} entries.
// Used as a reliable fallback/normalizer alongside the WebSocket feed.
let lastPollErrorLoggedAt = 0;
const POLL_ERROR_THROTTLE_MS = 30000;

export function startRESTPolling(callback, intervalMs = 5000) {
  stopRESTPolling();
  lastPollErrorLoggedAt = 0;
  const run = async () => {
    try {
      const codes = [INSTRUMENTS_REST.NIFTY, INSTRUMENTS_REST.SENSEX];
      const data = await fetchLTP(codes);
      if (callback) {
        const result = {
          NIFTY:
            data[INSTRUMENTS_REST.NIFTY]?.live_price ||
            data[INSTRUMENTS_REST.NIFTY]?.ltp ||
            null,
          SENSEX:
            data[INSTRUMENTS_REST.SENSEX]?.live_price ||
            data[INSTRUMENTS_REST.SENSEX]?.ltp ||
            null,
        };
        callback(result);
      }
      lastPollErrorLoggedAt = 0;
    } catch (err) {
      const now = Date.now();
      if (now - lastPollErrorLoggedAt >= POLL_ERROR_THROTTLE_MS) {
        lastPollErrorLoggedAt = now;
        console.warn("[Poll] LTP poll failed:", err.message, "(retrying silently)");
      }
    }
  };
  run();
  pollTimer = setInterval(run, intervalMs);
}

export function stopRESTPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
