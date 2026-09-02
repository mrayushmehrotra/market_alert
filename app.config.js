const fs = require("fs");
const path = require("path");

function loadEnv() {
  try {
    const envPath = path.resolve(__dirname, ".env");
    const content = fs.readFileSync(envPath, "utf8");
    const env = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      env[key] = val;
    }
    return env;
  } catch {
    return {};
  }
}

const env = loadEnv();

const NOTIFY_SOUND = "./assets/sounds/notify.mp3";
const NOTIFY_SOUND_ABS = path.resolve(__dirname, "assets/sounds/notify.mp3");
const hasNotifySound = fs.existsSync(NOTIFY_SOUND_ABS);
// Android references res/raw by filename without extension (notify.mp3 → "notify").
const CROSS_ALERT_SOUND = hasNotifySound ? "notify" : "default";

module.exports = {
  expo: {
    name: "Nifty Sensex Cross Alert",
    slug: "nifty-sensex-cross-alert",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#0b1320",
    },
    android: {
      package: "com.yourname.niftysensexcrossalert",
      permissions: [
        "FOREGROUND_SERVICE",
        "FOREGROUND_SERVICE_DATA_SYNC",
        "POST_NOTIFICATIONS",
        "WAKE_LOCK",
      ],
    },
    web: {
      favicon: "./assets/favicon.png",
      bundler: "metro",
    },
    plugins: [
      "./plugins/withNotifeeService.js",
      [
        "expo-notifications",
        {
          icon: "./assets/notification-icon.png",
          sounds: ["./assets/sounds/notify.mp3"],
        },
      ],
    ],
    extra: {
      INDMONEY_API_KEY: env.INDMONEY_API_KEY || "",
      COINDCX_API_KEY:
        env.COINDCX_API_KEY || "7ef2426cec6f7220178d00e593f8bb29767dbb2c2c",
      COINDCX_API_SECRET:
        env.COINDCX_API_SECRET ||
        "eaa11768d325279066b288c75095890e3af13a4ec0241f51e0276df0e61",
      CROSS_ALERT_SOUND,
      hasNotifySound,
      eas: {
        projectId: "a8648987-e813-42bd-ba75-f0317fde88c3",
      },
    },
  },
};
