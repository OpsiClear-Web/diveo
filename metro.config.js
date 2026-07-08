const path = require('path');
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);

// Ensure shims directory is watched by Metro
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, 'shims')];

const originalResolveRequest = config.resolver.resolveRequest;

const WEB_SHIMS = {
  '@sentry/react-native':                   'shims/sentry-react-native.web.tsx',
  'expo-intent-launcher':                   'shims/expo-intent-launcher.web.ts',
  'expo-file-system':                       'shims/expo-file-system.web.ts',
  'expo-file-system/legacy':                'shims/expo-file-system.web.ts',
};

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_SHIMS[moduleName]) {
    return {
      filePath: path.resolve(__dirname, WEB_SHIMS[moduleName]),
      type: 'sourceFile',
    };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
