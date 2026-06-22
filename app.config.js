// Dynamic Expo config. Its one job beyond app.json: make Android cleartext (plain HTTP)
// traffic depend on the build environment, so a production build can never ship pointing
// at a localhost/dev HTTP origin.
const base = require("./app.json");

function isProductionEnv(env = process.env) {
  return (
    env.EXPO_PUBLIC_APP_ENV === "production" ||
    env.EAS_BUILD_PROFILE === "production" ||
    env.NODE_ENV === "production"
  );
}

/**
 * Merge app.json with environment-driven overrides. The load-bearing rule:
 *   production  -> android.usesCleartextTraffic = false   (HTTPS only; no localhost)
 *   dev/preview -> keep app.json's value (allows http://127.0.0.1 for local GSAV preview)
 * This is the in-config half of the "no localhost APK in production" guarantee; the other
 * half is release.yml's artifact check + getConfiguredGsavWebUrl's production guard.
 */
function resolveExpoConfig(env = process.env, incomingConfig = {}) {
  const production = isProductionEnv(env);
  const baseExpo = base.expo ?? {};
  const incomingAndroid = incomingConfig.android ?? {};
  const baseAndroid = baseExpo.android ?? {};

  return {
    ...baseExpo,
    ...incomingConfig,
    android: {
      ...baseAndroid,
      ...incomingAndroid,
      usesCleartextTraffic: production ? false : baseAndroid.usesCleartextTraffic === true
    }
  };
}

module.exports = ({ config } = {}) => resolveExpoConfig(process.env, config ?? {});
module.exports.resolveExpoConfig = resolveExpoConfig;
module.exports.isProductionEnv = isProductionEnv;
