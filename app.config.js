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
          sounds: ["./assets/sounds/cross_alert.wav"],
        },
      ],
    ],
    extra: {
      INDMONEY_API_KEY: env.INDMONEY_API_KEY || "",
    },
  },
};
