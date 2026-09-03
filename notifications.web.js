// Web implementation of notifications.
// The browser has no Android foreground service or custom sound channels, so
// this module is a web-safe stub: it logs telemetry and can use the standard
// Web Notifications API for cross alerts.

import { Platform, Image } from "react-native";
import storage from "./storage";

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

let customSoundUri = null;
let customSoundName = null;
const CUSTOM_SOUND_KEY = "NIFTY_ALERT_CUSTOM_SOUND_URI";
const CUSTOM_SOUND_NAME_KEY = "NIFTY_ALERT_CUSTOM_SOUND_NAME";

export async function loadSavedSoundConfig() {
  try {
    const uri = await storage.getItem(CUSTOM_SOUND_KEY);
    const name = await storage.getItem(CUSTOM_SOUND_NAME_KEY);
    if (uri) {
      customSoundUri = uri;
      customSoundName = name || "Custom Sound";
    }
  } catch {}
}

export async function setCustomSound(uri, name) {
  customSoundUri = uri || null;
  customSoundName = name || null;
  try {
    if (uri) {
      await storage.setItem(CUSTOM_SOUND_KEY, uri);
      if (name) await storage.setItem(CUSTOM_SOUND_NAME_KEY, name);
    } else {
      await storage.removeItem(CUSTOM_SOUND_KEY);
      await storage.removeItem(CUSTOM_SOUND_NAME_KEY);
    }
  } catch {}
}

export function getCustomSoundInfo() {
  return {
    uri: customSoundUri,
    name: customSoundName || "Default (notify.mp3)",
    isDefault: !customSoundUri,
  };
}

export async function playAlertSound() {
  try {
    let src = customSoundUri;
    if (!src) {
      const resolved = Image.resolveAssetSource(require("./assets/sounds/notify.mp3"));
      src = resolved ? resolved.uri : null;
    }
    if (!src) {
      console.warn("[WebSound] Could not resolve sound asset source.");
      return;
    }

    const audio = new Audio(src);
    audio.volume = 1.0;
    await audio.play();
  } catch (err) {
    if (err.name === "NotAllowedError") {
      console.warn("[WebSound] Chrome blocked autoplay until user interacts with the page (click anywhere on the page first).");
    } else {
      console.warn("[WebSound] Audio playback error:", err.message);
    }
  }
}

export async function cancelTickerNotification() {}
