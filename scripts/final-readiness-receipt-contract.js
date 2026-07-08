const FINAL_READINESS_RECEIPT_BOOTSTRAP_ENV = "FINAL_READINESS_RECEIPT_BOOTSTRAP";

const FINAL_RECEIPT_EXPECTED_STEP_LABELS = [
  "Documentation drift audit",
  "Final readiness focused tests",
  "External evidence inventory replay",
  "Device packet reconciliation",
  "Strict handoff receipt replay",
  "Stack architecture receipt replay",
  "Protected master ref refresh",
  "Protected candidate ancestry proof",
  "Last-mile GitHub release-state evidence",
  "Last-mile publish-hash variable guard",
  "Final release readiness",
];

const FINAL_FOCUSED_TESTS = [
  "scripts/verify-release-readiness.test.mjs",
  "scripts/verify-doc-drift.test.mjs",
  "scripts/verify-external-evidence-inventory.test.mjs",
  "scripts/device-evidence-packet.test.mjs",
  "scripts/verify-handoff-receipts.test.mjs",
  "scripts/stack-architecture-receipt.test.mjs",
];

module.exports = {
  FINAL_FOCUSED_TESTS,
  FINAL_READINESS_RECEIPT_BOOTSTRAP_ENV,
  FINAL_RECEIPT_EXPECTED_STEP_LABELS,
};
