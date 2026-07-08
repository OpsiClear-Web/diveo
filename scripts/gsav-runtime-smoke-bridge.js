const {
  GSAV_NATIVE_BRIDGE_MIN_VERSION,
  GSAV_NATIVE_BRIDGE_VERSION,
} = require("@opsiclear/gsav-bridge");

function readFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isBridgeCompatible(web) {
  const webVersion = readFiniteNumber(web?.version);
  if (webVersion === undefined) return false;
  const webMinVersion = readFiniteNumber(web?.minVersion) ?? webVersion;
  return webVersion >= GSAV_NATIVE_BRIDGE_MIN_VERSION && GSAV_NATIVE_BRIDGE_VERSION >= webMinVersion;
}

function getBridgeReadySummaries(messages) {
  return messages
    .filter((message) => message?.type === "GSAV_BRIDGE_READY")
    .map((message) => ({
      version: readFiniteNumber(message.payload?.version) ?? null,
      minVersion: readFiniteNumber(message.payload?.minVersion) ?? null,
      commands: Array.isArray(message.payload?.commands) ? message.payload.commands : [],
      events: Array.isArray(message.payload?.events) ? message.payload.events : [],
    }));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertCompatibleBridgeReady(messages, routeName) {
  const summaries = getBridgeReadySummaries(messages);
  assert(summaries.length > 0, `${routeName} did not emit GSAV_BRIDGE_READY`);

  const incompatible = summaries.filter((summary) => !isBridgeCompatible(summary));
  assert(
    incompatible.length === 0,
    `${routeName} emitted incompatible GSAV_BRIDGE_READY: native bridge v${GSAV_NATIVE_BRIDGE_VERSION} accepts >=${GSAV_NATIVE_BRIDGE_MIN_VERSION}, web ${JSON.stringify(incompatible)}`,
  );

  return summaries;
}

module.exports = {
  GSAV_NATIVE_BRIDGE_MIN_VERSION,
  GSAV_NATIVE_BRIDGE_VERSION,
  assertCompatibleBridgeReady,
  getBridgeReadySummaries,
  isBridgeCompatible,
};
