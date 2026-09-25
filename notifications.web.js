// Web implementation of notifications.
// The browser has no Android foreground service or custom sound channels, so
// this module is a web-safe stub: it logs telemetry and can use the standard
// Web Notifications API for cross alerts.

import { Platform, Image } from "react-native";

let permission = Platform.OS === "web" ? Notification?.permission : "denied";

async function ensurePermission() {
  if (!("Notification" in window)) return false;
  if (permission === "granted") return true;
  if (permission === "denied") return false;
  const result = await Notification.requestPermission();
  permission = result;
  return result === "granted";
}

// Channels are Android-only concepts — no-op on web.
export async function setupChannels() {}

// No persistent Spotify-style notification on web — no-op.
export async function showOrUpdateTickerNotification() {}

export async function showCrossAlert(payload = {}) {
  playAlertSound();

  try {
    const ok = await ensurePermission();
    if (!ok) return;

    const { type, label, cross, direction, price, vwap, ema, sma, supertrend, value } = payload;
    let title = "";
    let body = "";

    if (type === "supertrend") {
      const isBullish = cross === "bullish" || direction === "bullish" || direction === 1;
      const dir = isBullish ? "BULLISH (uptrend)" : "BEARISH (downtrend)";
      title = `${label} Supertrend Flip`;
      body = payload.body || `Supertrend flipped ${dir}`;
      if (!payload.body) {
        const parts = [];
        if (price != null) parts.push(`Price ${price}`);
        const stVal = supertrend ?? value;
        if (stVal != null) parts.push(`Supertrend ${stVal}`);
        if (parts.length) body += `\n${parts.join(" | ")}`;
      }
    } else if (type === "sma") {
      const isAbove = cross === "bullish" || direction === "bullish" || cross === "above";
      const action = isAbove ? "closed ABOVE" : "closed BELOW";
      title = `${label} SMA Daily Cross`;
      body = payload.body || `Daily candle ${action} SMA`;
      if (!payload.body) {
        const parts = [];
        if (price != null) parts.push(`Price ${price}`);
        const smaVal = sma ?? value;
        if (smaVal != null) parts.push(`SMA ${smaVal}`);
        if (parts.length) body += `\n${parts.join(" | ")}`;
      }
    } else {
      const dir = cross === "bullish" ? "crossed ABOVE" : "crossed BELOW";
      title = `${label} EMA9/VWAP Cross`;
      body = payload.body || `EMA9 ${dir} VWAP\nPrice ${price} | VWAP ${vwap} | EMA9 ${ema}`;
    }

    new Notification(title, { body, tag: payload.tag || "cross-alert" });
  } catch (err) {
    console.error("[notifications.web] Failed to show cross alert:", err);
  }
}

function getAssetUri(assetModule) {
  if (!assetModule) return null;
  if (typeof assetModule === "string") return assetModule;

  if (typeof assetModule === "object") {
    if (assetModule.uri) return assetModule.uri;
    if (assetModule.default) {
      if (typeof assetModule.default === "string") return assetModule.default;
      if (assetModule.default.uri) return assetModule.default.uri;
    }
  }

  try {
    const resolve = Image?.resolveAssetSource || (Image?.default && Image.default.resolveAssetSource);
    if (typeof resolve === "function") {
      const res = resolve(assetModule);
      if (res && res.uri) return res.uri;
    }
  } catch (e) {}

  return "./assets/sounds/notify.mp3";
}

export async function playAlertSound() {
  try {
    const src = getAssetUri(require("./assets/sounds/notify.mp3"));
    if (!src) {
      console.warn("[WebSound] Could not resolve sound asset source.");
      return;
    }
    const audio = new Audio(src);
    audio.volume = 1.0;
    await audio.play();
  } catch (err) {
    if (err.name === "NotAllowedError") {
      console.warn("[WebSound] Chrome blocked autoplay until user interacts with the page.");
    } else {
      console.warn("[WebSound] Audio playback error:", err.message);
    }
  }
}

export async function cancelTickerNotification() {}
