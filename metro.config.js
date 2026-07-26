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

module.exports = config;
