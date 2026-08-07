// Lets `import Icon from '@/assets/icons/foo.svg'` return a React component.
// The Figma exports were rewritten to fill="currentColor", so a `color` prop
// tints them — which is what the active/inactive nav states need.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.transformer.babelTransformerPath = require.resolve(
  'react-native-svg-transformer/expo',
);
config.resolver.assetExts = config.resolver.assetExts.filter(
  (ext) => ext !== 'svg',
);
config.resolver.sourceExts = [...config.resolver.sourceExts, 'svg'];

// The MCP SDK ships separate shims behind package-export conditions. Metro
// only applies `browser` to the web platform by default, so on Android/iOS it
// falls through to the Node shim, which imports `node:process` and breaks the
// Hermes bundle. Force the browser condition on native so the SDK resolves its
// browser/RN-safe shim (no Node builtins).
config.resolver.unstable_conditionsByPlatform = {
  ...(config.resolver.unstable_conditionsByPlatform ?? {}),
  android: ['browser'],
  ios: ['browser'],
};

module.exports = config;
