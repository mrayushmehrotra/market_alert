// Web implementation of notifications.
// The browser has no Android foreground service or custom sound channels, so
// this module is a web-safe stub: it logs telemetry and can use the standard
// Web Notifications API for cross alerts.

import { Platform } from "react-native";

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

export async function showCrossAlert({ label, cross, price, vwap, ema }) {
  try {
    const ok = await ensurePermission();
    if (!ok) return;

    const direction = cross === "bullish" ? "crossed ABOVE" : "crossed BELOW";
    const title = `${label} EMA9/VWAP Cross`;
    const body = `EMA9 ${direction} VWAP\nPrice ${price} | VWAP ${vwap} | EMA9 ${ema}`;

    new Notification(title, { body, tag: "cross-alert" });
  } catch (err) {
    console.error("[notifications.web] Failed to show cross alert:", err);
  }
}

export async function loadSavedSoundConfig() {}
export async function setCustomSound(uri, name) {}
export function getCustomSoundInfo() {
  return { uri: null, name: "Default (notify.mp3)", isDefault: true };
}
export async function playAlertSound() {}

export async function cancelTickerNotification() {}
