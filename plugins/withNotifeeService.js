// Local Expo config plugin that declares the Android foreground-service
// capability needed by @notifee/react-native. Kept as source (not from the
// notifee package's bundled ESM) so it can be loaded reliably across Node
// versions, and so web builds don't try to resolve the native plugin.

const { withAndroidManifest } = require("@expo/config-plugins");

module.exports = function withNotifeeService(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) return config;

    // Ensure the service array exists
    if (!application.service) {
      application.service = [];
    }

    const services = application.service;
    const isPresent = services.some(
      (s) => s.$ && s.$["android:name"] === "app.notifee.core.ForegroundService"
    );

    if (!isPresent) {
      services.push({
        $: {
          "android:name": "app.notifee.core.ForegroundService",
          "android:foregroundServiceType": "dataSync",
          "android:stopWithTask": "true",
        },
      });
    }

    return config;
  });
};
