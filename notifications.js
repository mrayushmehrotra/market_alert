import { NativeModules, Platform } from "react-native";
import Constants from "expo-constants";
import * as ExpoNotifications from "expo-notifications";
import * as Device from "expo-device";
import { Audio } from "expo-av";

import AsyncStorage from "@react-native-async-storage/async-storage";

// ---------- In-app audio player & custom sound ----------

let soundObject = null;
let customSoundUri = null;
let customSoundName = null;

const CUSTOM_SOUND_KEY = "NIFTY_ALERT_CUSTOM_SOUND_URI";
const CUSTOM_SOUND_NAME_KEY = "NIFTY_ALERT_CUSTOM_SOUND_NAME";

export async function loadSavedSoundConfig() {
  try {
    const uri = await AsyncStorage.getItem(CUSTOM_SOUND_KEY);
    const name = await AsyncStorage.getItem(CUSTOM_SOUND_NAME_KEY);
    if (uri) {
      customSoundUri = uri;
      customSoundName = name || "Custom Sound";
    }
  } catch {}
}

export async function setCustomSound(uri, name) {
  try {
    if (uri) {
      customSoundUri = uri;
      customSoundName = name || "Custom Sound";
      await AsyncStorage.setItem(CUSTOM_SOUND_KEY, uri);
      if (name) await AsyncStorage.setItem(CUSTOM_SOUND_NAME_KEY, name);
    } else {
      customSoundUri = null;
      customSoundName = null;
      await AsyncStorage.removeItem(CUSTOM_SOUND_KEY);
      await AsyncStorage.removeItem(CUSTOM_SOUND_NAME_KEY);
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
    if (soundObject) {
      await soundObject.unloadAsync();
      soundObject = null;
    }

    const soundSource = customSoundUri
      ? { uri: customSoundUri }
      : require("./assets/sounds/notify.mp3");

    const { sound } = await Audio.Sound.createAsync(soundSource);
    soundObject = sound;
    await soundObject.playAsync();
  } catch (err) {
    console.warn("[Sound] Failed to play alert sound, falling back to default:", err.message);
    try {
      const { sound } = await Audio.Sound.createAsync(
        require("./assets/sounds/notify.mp3")
      );
      soundObject = sound;
      await soundObject.playAsync();
    } catch {}
  }
}

// ---------- Notifee (dev client only) ----------

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

    // Register required Android foreground service task runner
    notifee.registerForegroundService(() => {
      return new Promise(() => {
        // Keeps foreground service active
      });
    });
  } catch (e) {
    console.warn("[notifications] Failed to load notifee:", e.message);
  }
}

// When notifee isn't available (Expo Go), we fall back to expo-notifications.
const useExpoFallback = !notifee;

if (useExpoFallback) {
  console.log("[notifications] Using expo-notifications fallback (Expo Go mode).");
}

// ---------- Permission ----------

async function requestPermission() {
  if (!Device.isDevice) {
    console.warn("[notifications] Must use a physical device for push notifications.");
    return false;
  }

  const { status: existingStatus } = await ExpoNotifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await ExpoNotifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.warn("[notifications] Permission not granted.");
    return false;
  }

  return true;
}

// ---------- Expo-notifications setup ----------

ExpoNotifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const TICKER_NOTIFICATION_ID = "nifty-sensex-ticker";
const CROSS_ALERT_SOUND = "notify";
const CROSS_ALERTS_CHANNEL_ID = "cross_alerts_v3";

// ---------- Channels ----------

export async function setupChannels() {
  await requestPermission();

  if (Platform.OS === "android") {
    try {
      await ExpoNotifications.deleteNotificationChannelAsync("cross-alerts");
      await ExpoNotifications.deleteNotificationChannelAsync("cross_alerts");
    } catch {}

    await ExpoNotifications.setNotificationChannelAsync("ticker", {
      name: "Live Price Ticker",
      importance: ExpoNotifications.AndroidImportance.LOW,
      lockscreenVisibility: ExpoNotifications.AndroidNotificationVisibility.PUBLIC,
    });

    await ExpoNotifications.setNotificationChannelAsync(CROSS_ALERTS_CHANNEL_ID, {
      name: "Cross Alerts V3",
      importance: ExpoNotifications.AndroidImportance.HIGH,
      sound: CROSS_ALERT_SOUND,
      lockscreenVisibility: ExpoNotifications.AndroidNotificationVisibility.PUBLIC,
      vibrationPattern: [0, 250, 250, 250],
      enableVibrate: true,
    });
  }

  if (notifee) {
    try {
      await notifee.deleteChannel("cross-alerts");
      await notifee.deleteChannel("cross_alerts");
    } catch {}

    await notifee.createChannel({
      id: "ticker",
      name: "Live Price Ticker",
      importance: AndroidImportance.LOW,
      visibility: AndroidVisibility.PUBLIC,
    });

    await notifee.createChannel({
      id: CROSS_ALERTS_CHANNEL_ID,
      name: "Cross Alerts V3",
      importance: AndroidImportance.HIGH,
      sound: CROSS_ALERT_SOUND,
      visibility: AndroidVisibility.PUBLIC,
      vibration: true,
    });
  }
}

// ---------- Persistent ticker notification ----------

function formatNumber(n) {
  if (n == null || n === 0) return "--";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

function formatTickerTitle(data) {
  const time = data.session?.formattedTime || "06:00:00";
  const crosses = data.session?.crossCount ?? 0;
  return `⏱️ ${time}  |  ⚡ Crosses: ${crosses}`;
}

function formatTickerBody(data) {
  const parts = [];
  if (data.NIFTY?.price) {
    const arr = data.NIFTY.direction === "above" ? "▲" : "▼";
    parts.push(`NIFTY: ${formatNumber(data.NIFTY.price)}${arr}`);
  }
  if (data.SENSEX?.price) {
    const arr = data.SENSEX.direction === "above" ? "▲" : "▼";
    parts.push(`SENSEX: ${formatNumber(data.SENSEX.price)}${arr}`);
  }
  if (data.SOL?.price) {
    const arr = data.SOL.direction === "above" ? "▲" : "▼";
    parts.push(`SOL: $${formatNumber(data.SOL.price)}${arr}`);
  }
  return parts.join(" | ") || "Monitoring active...";
}

function formatTickerSubText(data) {
  const parts = [];
  if (data.NIFTY?.vwap) {
    parts.push(`N: V${formatNumber(data.NIFTY.vwap)} E${formatNumber(data.NIFTY.ema9)}`);
  }
  if (data.SENSEX?.vwap) {
    parts.push(`S: V${formatNumber(data.SENSEX.vwap)} E${formatNumber(data.SENSEX.ema9)}`);
  }
  if (data.SOL?.vwap) {
    parts.push(`SOL: V$${formatNumber(data.SOL.vwap)} E$${formatNumber(data.SOL.ema9)}`);
  }
  return parts.join(" | ");
}

export async function showOrUpdateTickerNotification(data) {
  const title = formatTickerTitle(data);
  const body = formatTickerBody(data);
  const subtitle = formatTickerSubText(data);

  if (notifee) {
    try {
      await notifee.displayNotification({
        id: TICKER_NOTIFICATION_ID,
        title,
        body,
        subtitle,
        android: {
          channelId: "ticker",
          asForegroundService: true,
          ongoing: true,
          smallIcon: "ic_launcher",
          color: "#1DB954",
          onlyAlertOnce: true,
          pressAction: { id: "default" },
        },
      });
    } catch (err) {
      console.warn("[Notifee] Foreground service error, attempting ongoing fallback:", err.message);
      try {
        await notifee.displayNotification({
          id: TICKER_NOTIFICATION_ID,
          title,
          body,
          subtitle,
          android: {
            channelId: "ticker",
            ongoing: true,
            smallIcon: "ic_launcher",
            color: "#1DB954",
            onlyAlertOnce: true,
            pressAction: { id: "default" },
          },
        });
      } catch {}
    }
  }
}

// ---------- Cross alert notification ----------

export async function showCrossAlert({ label, cross, price, vwap, ema }) {
  // Play in-app alert sound via expo-av
  playAlertSound();

  const direction = cross === "bullish" ? "crossed ABOVE" : "crossed BELOW";
  const title = `${label} EMA9/VWAP Cross`;
  const body = `EMA9 ${direction} VWAP\nPrice ${formatNumber(price)} | VWAP ${formatNumber(vwap)} | EMA9 ${formatNumber(ema)}`;

  if (notifee) {
    await notifee.displayNotification({
      title,
      body,
      android: {
        channelId: CROSS_ALERTS_CHANNEL_ID,
        importance: AndroidImportance.HIGH,
        sound: CROSS_ALERT_SOUND,
        pressAction: { id: "default" },
      },
    });
  } else {
    // Expo Go fallback
    await ExpoNotifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: Platform.OS === "android" ? CROSS_ALERT_SOUND : true,
        priority: ExpoNotifications.AndroidNotificationPriority.HIGH,
        ...(Platform.OS === "android" ? { channelId: CROSS_ALERTS_CHANNEL_ID } : {}),
      },
      trigger: null, // fire immediately
    });
  }
}

// ---------- Cleanup ----------

export async function cancelTickerNotification() {
  if (notifee) {
    await notifee.cancelNotification(TICKER_NOTIFICATION_ID);
  }
  // expo-notifications: dismiss all (only relevant if we ever showed one)
  await ExpoNotifications.dismissAllNotificationsAsync();
}

// ---------- Foreground event handler ----------

if (notifee) {
  notifee.onForegroundEvent(({ type }) => {
    if (type === EventType.PRESS) {
      console.log("Ticker notification pressed");
    }
  });
}
