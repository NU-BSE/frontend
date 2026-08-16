const path = require('path');

/**
 * react-native-tdlib needs its android platform spelled out here.
 *
 * The package ships its own react-native.config.js, but the CLI's newer schema
 * drops the whole `platforms` map from it — `npx react-native config` reported
 * `platforms.android: null`, which is the same as declaring no native module
 * at all. Restating it here survives the schema.
 *
 * WHAT THIS DOES NOT FIX: the Gradle build does not use the CLI's config. Expo
 * projects link through expo-modules-autolinking, and that resolver omits
 * react-native-tdlib entirely — with or without this file, with or without the
 * package's own config. So `TdLibModule` is still absent from the generated
 * PackageList and Telegram reports the module as missing at runtime. Linking
 * it needs a config plugin that adds the Gradle project and registers
 * TdLibPackage by hand, the way plugins/with-attestation-native-probes.js does.
 */
module.exports = {
  dependencies: {
    'react-native-tdlib': {
      root: path.resolve(__dirname, 'node_modules/react-native-tdlib'),
      platforms: {
        android: {
          sourceDir: path.resolve(__dirname, 'node_modules/react-native-tdlib/android'),
          packageImportPath: 'import com.reactnativetdlib.tdlibclient.TdLibPackage;',
          packageInstance: 'new TdLibPackage()',
        },
      },
    },
  },
};
