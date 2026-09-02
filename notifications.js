import { NativeModules } from "react-native";

// Check if notifee native module exists BEFORE loading @notifee/react-native.
// Loading notifee triggers module-scope AppRegistry.registerHeadlessTask calls
// that corrupt the app registry when the native module isn't present, causing
// the "main has not been registered" crash.
const hasNotifeeNative = !!NativeModules.NotifeeApiModule;

let notifee = null;
let AndroidImportance = {};
let AndroidVisibility = {};
let EventType = {};

if (hasNotifeeNative) {
  try {
    const mod = require("@notifee/react-native");
    notifee = mod.default || mod;
    AndroidImportance = mod.AndroidImportance || {};
    AndroidVisibility = mod.AndroidVisibility || {};
    EventType = mod.EventType || {};
  } catch (e) {
    console.warn("[notifications] Failed to load notifee:", e.message);
  }
} else {
  console.warn(
    "[notifications] Notifee native module not found — notifications disabled.",
    "Build a dev client with `npx expo run:android` to enable notifications."
  );
}

const TICKER_NOTIFICATION_ID = "nifty-sensex-ticker";

// ---------- Channels ----------

export async function setupChannels() {
  if (!notifee) return;

  // Silent, persistent channel for the live price ticker (Spotify-style)
  await notifee.createChannel({
    id: "ticker",
    name: "Live Price Ticker",
    importance: AndroidImportance.LOW,
    visibility: AndroidVisibility.PUBLIC,
  });

  // High-importance channel with custom sound for actual cross alerts
  await notifee.createChannel({
    id: "cross-alerts",
    name: "Cross Alerts",
    importance: AndroidImportance.HIGH,
    sound: "cross_alert",
    visibility: AndroidVisibility.PUBLIC,
  });
}

// ---------- Persistent ticker notification ----------

function formatNumber(n) {
  if (n == null || n === 0) return "--";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

function formatTickerBody(data) {
  const fmt = (d) => {
    if (!d || !d.price) return "--";
    const arrow = d.direction === "above" ? "^" : "v";
    return `${formatNumber(d.price)} ${arrow}`;
  };

  const n = data.NIFTY;
  const s = data.SENSEX;

  return `NIFTY: ${fmt(n)}  |  SENSEX: ${fmt(s)}`;
}

function formatTickerSubText(data) {
  const parts = [];
  if (data.NIFTY?.vwap) {
    parts.push(`N: VWAP ${formatNumber(data.NIFTY.vwap)} EMA9 ${formatNumber(data.NIFTY.ema9)}`);
  }
  if (data.SENSEX?.vwap) {
    parts.push(`S: VWAP ${formatNumber(data.SENSEX.vwap)} EMA9 ${formatNumber(data.SENSEX.ema9)}`);
  }
  return parts.join("  |  ");
}

export async function showOrUpdateTickerNotification(data) {
  if (!notifee) return;

  await notifee.displayNotification({
    id: TICKER_NOTIFICATION_ID,
    title: "NIFTY / SENSEX Live",
    body: formatTickerBody(data),
    subtitle: formatTickerSubText(data),
    android: {
      channelId: "ticker",
      asForegroundService: true,
      ongoing: true,
      smallIcon: "ic_notification",
      color: "#1DB954",
      onlyAlertOnce: true,
    },
  });
}

// ---------- Cross alert notification ----------

export async function showCrossAlert({ label, cross, price, vwap, ema }) {
  if (!notifee) return;

  const direction = cross === "bullish" ? "crossed ABOVE" : "crossed BELOW";

  await notifee.displayNotification({
    title: `${label} EMA9/VWAP Cross`,
    body: `EMA9 ${direction} VWAP\nPrice ${formatNumber(price)} | VWAP ${formatNumber(vwap)} | EMA9 ${formatNumber(ema)}`,
    android: {
      channelId: "cross-alerts",
      importance: AndroidImportance.HIGH,
      sound: "cross_alert",
      pressAction: { id: "default" },
    },
  });
}

// ---------- Cleanup ----------

export async function cancelTickerNotification() {
  if (!notifee) return;
  await notifee.cancelNotification(TICKER_NOTIFICATION_ID);
}

// ---------- Foreground event handler ----------

if (notifee) {
  notifee.onForegroundEvent(({ type }) => {
    if (type === EventType.PRESS) {
      console.log("Ticker notification pressed");
    }
  });
}
