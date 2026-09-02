import { NativeModules, Platform } from "react-native";
import Constants from "expo-constants";
import * as ExpoNotifications from "expo-notifications";
import * as Device from "expo-device";

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

// Configure how notifications appear when app is in foreground
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
// Bundled at build time from assets/sounds/notify.mp3 → android/res/raw/notify.mp3
const CROSS_ALERT_SOUND =
  Constants.expoConfig?.extra?.CROSS_ALERT_SOUND || "notify";
const CROSS_ALERTS_CHANNEL_ID = "cross-alerts";

// ---------- Channels ----------

export async function setupChannels() {
  // Always request permission
  await requestPermission();

  if (Platform.OS === "android") {
    // Set up Android notification channels via expo-notifications
    await ExpoNotifications.setNotificationChannelAsync("ticker", {
      name: "Live Price Ticker",
      importance: ExpoNotifications.AndroidImportance.LOW,
      lockscreenVisibility: ExpoNotifications.AndroidNotificationVisibility.PUBLIC,
    });

    await ExpoNotifications.setNotificationChannelAsync(CROSS_ALERTS_CHANNEL_ID, {
      name: "Cross Alerts",
      importance: ExpoNotifications.AndroidImportance.HIGH,
      sound: CROSS_ALERT_SOUND,
      lockscreenVisibility: ExpoNotifications.AndroidNotificationVisibility.PUBLIC,
    });
  }

  if (notifee) {
    await notifee.createChannel({
      id: "ticker",
      name: "Live Price Ticker",
      importance: AndroidImportance.LOW,
      visibility: AndroidVisibility.PUBLIC,
    });

    await notifee.createChannel({
      id: CROSS_ALERTS_CHANNEL_ID,
      name: "Cross Alerts",
      importance: AndroidImportance.HIGH,
      sound: CROSS_ALERT_SOUND,
      visibility: AndroidVisibility.PUBLIC,
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
  const fmt = (d) => {
    if (!d || !d.price) return "--";
    const arrow = d.direction === "above" ? "▲" : "▼";
    return `${formatNumber(d.price)} ${arrow}`;
  };

  return `NIFTY: ${fmt(data.NIFTY)}  |  SENSEX: ${fmt(data.SENSEX)}`;
}

function formatTickerSubText(data) {
  const parts = [];
  if (data.NIFTY?.vwap) {
    parts.push(`N: VWAP ${formatNumber(data.NIFTY.vwap)} EMA ${formatNumber(data.NIFTY.ema9)}`);
  }
  if (data.SENSEX?.vwap) {
    parts.push(`S: VWAP ${formatNumber(data.SENSEX.vwap)} EMA ${formatNumber(data.SENSEX.ema9)}`);
  }
  return parts.join("  |  ");
}

export async function showOrUpdateTickerNotification(data) {
  if (notifee) {
    // Notifee: persistent foreground service notification
    await notifee.displayNotification({
      id: TICKER_NOTIFICATION_ID,
      title: formatTickerTitle(data),
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
  // Expo Go fallback: we don't spam ticker updates as individual notifications
  // since expo-notifications can't do persistent/ongoing notifications.
  // The ticker notification is skipped; only cross alerts fire.
}

// ---------- Cross alert notification ----------

export async function showCrossAlert({ label, cross, price, vwap, ema }) {
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
