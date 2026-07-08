// Flat ESLint config (ESLint 9 + eslint-config-expo).
//
// Enforcement is scoped in CI to the diveo/GSAV surface + utils + scripts.
// This config defines the rules + global ignores; the CI step passes the scoped paths.
const expoConfig = require("eslint-config-expo/flat");

// Node globals for build/CI scripts and root config files (CommonJS Node context).
const nodeGlobals = {
  require: "readonly",
  module: "writable",
  exports: "writable",
  __dirname: "readonly",
  __filename: "readonly",
  process: "readonly",
  console: "readonly",
  Buffer: "readonly",
};

module.exports = [
  ...expoConfig,
  {
    ignores: [
      "node_modules/**",
      "android/**",
      "ios/**",
      "dist/**",
      ".expo/**",
      "coverage/**",
      "public/**",
    ],
  },
  {
    // Node CommonJS scripts + root config files.
    files: ["scripts/**/*.js", "*.config.js", "metro.config.js"],
    languageOptions: { sourceType: "commonjs", globals: nodeGlobals },
  },
  {
    // Node ESM scripts (e.g. *.test.mjs).
    files: ["scripts/**/*.mjs"],
    languageOptions: { sourceType: "module", globals: nodeGlobals },
  },
];
