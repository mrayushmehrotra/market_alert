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

// Prefer real environment variables (set by EAS secrets during cloud builds),
// falling back to the local .env file for local development.
function readSecret(key) {
  return process.env[key] || env[key] || "";
}

// EAS sets this during cloud builds. Restrict ABIs for internal (APK)
// preview builds to shrink them; keep all ABIs for the store AAB so Play
// can serve per-device slices.
const easProfile = process.env.EAS_BUILD_PROFILE || "";
const isPreview = easProfile === "preview";

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
      [
        "expo-build-properties",
        {
          android: {
            enableMinifyInReleaseBuilds: true,
            enableShrinkResourcesInReleaseBuilds: true,
            // Fix Android packaging bug (expo#27085) + compress native libs.
            // Significantly shrinks the APK/AAB.
            useLegacyPackaging: true,
            // arm64-only for internal APK builds; full ABI set for store AAB
            // (the app config is evaluated per profile by EAS).
            buildArchs: isPreview
              ? ["arm64-v8a"]
              : ["armeabi-v7a", "arm64-v8a", "x86", "x86_64"],
          },
        },
      ],
    ],
    extra: {
      INDMONEY_API_KEY: readSecret("INDMONEY_API_KEY"),
      COINDCX_API_KEY: readSecret("COINDCX_API_KEY"),
      COINDCX_API_SECRET: readSecret("COINDCX_API_SECRET"),
      CROSS_ALERT_SOUND,
      hasNotifySound,
      eas: {
        projectId: "a8648987-e813-42bd-ba75-f0317fde88c3",
      },
    },
  },
};
