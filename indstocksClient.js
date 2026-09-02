import {
  API_TOKEN,
  INDSTOCKS_BASE_URL,
  INDSTOCKS_WS_URL,
  CANDLE_INTERVAL,
  INSTRUMENTS,
} from "./config";

const INSTRUMENTS_REST = {
  NIFTY: INSTRUMENTS.NIFTY.restScrip,
  SENSEX: INSTRUMENTS.SENSEX.restScrip,
};

// ---------- REST ----------

export async function fetchHistoricalCandles(scripCode, startTimeMs, endTimeMs) {
  const url = `${INDSTOCKS_BASE_URL}/market/historical/${CANDLE_INTERVAL}?scrip-codes=${scripCode}&start_time=${startTimeMs}&end_time=${endTimeMs}`;

  const res = await fetch(url, {
    headers: { Authorization: API_TOKEN },
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
  const codes = scripCodes.join(",");
  const url = `${INDSTOCKS_BASE_URL}/market/quotes/ltp?scrip-codes=${codes}`;

  const res = await fetch(url, {
    headers: { Authorization: API_TOKEN },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LTP fetch failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  return json.data || {};
}

export async function fetchInstruments(source = "index") {
  const url = `${INDSTOCKS_BASE_URL}/market/instruments?source=${source}`;

  const res = await fetch(url, {
    headers: { Authorization: API_TOKEN },
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
const MAX_RECONNECT_DELAY = 30000;

export function connectPriceFeed(onQuote, onConnect, onDisconnect) {
  if (ws) {
    ws.close();
    ws = null;
  }

  const isWeb = typeof window !== "undefined" && typeof window.document !== "undefined";
  if (isWeb) {
    // Browsers cannot set custom headers on WebSocket connections, so we
    // connect without the auth header. The feed may not authenticate on web;
    // the REST polling fallback still keeps prices/alerts working.
    ws = new WebSocket(INDSTOCKS_WS_URL);
  } else {
    ws = new WebSocket(INDSTOCKS_WS_URL, [], {
      headers: { Authorization: API_TOKEN },
    });
  }

  ws.onopen = () => {
    console.log("[WS] Connected to INDstocks price feed");
    reconnectDelay = 1000;
    if (onConnect) onConnect();
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);

      // Ignore heartbeats
      if (msg.type === "heartbeat" || msg.ping) return;

      if (msg.mode && msg.instrument && msg.data) {
        if (onQuote) onQuote(msg);
      }
    } catch (err) {
      console.error("[WS] Failed to parse message:", err);
    }
  };

  ws.onerror = (err) => {
    console.error("[WS] Error:", err.message || err);
  };

  ws.onclose = () => {
    console.log("[WS] Disconnected — reconnecting in", reconnectDelay, "ms");
    if (onDisconnect) onDisconnect();
    scheduleReconnect(onQuote, onConnect, onDisconnect);
  };

  return ws;
}

function scheduleReconnect(onQuote, onConnect, onDisconnect) {
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  reconnectTimeout = setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    connectPriceFeed(onQuote, onConnect, onDisconnect);
  }, reconnectDelay);
}

export function subscribeToInstruments(instruments) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn("[WS] Cannot subscribe — not connected");
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
export function startRESTPolling(callback, intervalMs = 5000) {
  stopRESTPolling();
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
    } catch (err) {
      console.error("[Poll] LTP poll failed:", err.message);
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
