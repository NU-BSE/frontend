const {
  withAppBuildGradle,
  withMainApplication,
  withSettingsGradle,
} = require('@expo/config-plugins');

const PROJECT = ':react-native-tdlib';
const PROJECT_DIR = '../node_modules/react-native-tdlib/android';
const IMPORT_KOTLIN = 'import com.reactnativetdlib.tdlibclient.TdLibPackage';
const IMPORT_JAVA = 'import com.reactnativetdlib.tdlibclient.TdLibPackage;';

/**
 * Link react-native-tdlib by hand, because autolinking will not.
 *
 * expo-modules-autolinking omits the package entirely — it appears in neither
 * `expo-modules-autolinking react-native-config` nor the generated
 * PackageList.java, with or without a project-level react-native.config.js,
 * and with or without the package's own (which the CLI schema rejects, leaving
 * `platforms.android: null`). So the Gradle project, the dependency and the
 * package registration are all added here.
 *
 * This existed already — as hand edits to android/settings.gradle,
 * android/app/build.gradle and MainApplication.kt. Those work locally, where
 * prebuild reads and re-modifies the files that are already there, and vanish
 * on EAS, where android/ is not uploaded and is generated from the template on
 * every build. Hence a debug APK with working Telegram and a store build
 * reporting "TdLibModule not linked".
 *
 * Everything below is idempotent: prebuild runs mods against whatever state
 * the directory is in, including a directory this plugin has already edited.
 */

function withTdlibSettingsGradle(config) {
  return withSettingsGradle(config, (modConfig) => {
    const contents = modConfig.modResults.contents;
    if (contents.includes(`include '${PROJECT}'`)) return modConfig;

    modConfig.modResults.contents =
      `${contents.trimEnd()}\n\n` +
      `include '${PROJECT}'\n` +
      `project('${PROJECT}').projectDir =\n` +
      `    new File(rootProject.projectDir, '${PROJECT_DIR}')\n`;
    return modConfig;
  });
}

function withTdlibAppBuildGradle(config) {
  return withAppBuildGradle(config, (modConfig) => {
    const contents = modConfig.modResults.contents;
    const dependency = `implementation project('${PROJECT}')`;
    if (contents.includes(dependency) || contents.includes(`implementation project(":react-native-tdlib")`)) {
      return modConfig;
    }

    // Anchor on the react-android dependency that is always present rather
    // than on `dependencies {`, which also matches the buildscript block.
    const anchor = 'implementation("com.facebook.react:react-android")';
    if (!contents.includes(anchor)) {
      throw new Error(
        '[with-tdlib] Could not find the react-android dependency in ' +
          'app/build.gradle, so the TDLib project was not added. Telegram ' +
          'would build without its native module.',
      );
    }

    modConfig.modResults.contents = contents.replace(
      anchor,
      `${anchor}\n    ${dependency}`,
    );
    return modConfig;
  });
}

function registerKotlin(contents) {
  let next = contents;
  if (!next.includes(IMPORT_KOTLIN)) {
    next = next.replace(/^(package\s+[^\n]+\n)/mu, `$1\n${IMPORT_KOTLIN}\n`);
  }
  if (!next.includes('add(TdLibPackage())')) {
    const applyPattern = /PackageList\(this\)\.packages\.apply\s*\{/u;
    if (!applyPattern.test(next)) {
      throw new Error('[with-tdlib] Could not register TdLibPackage in Kotlin MainApplication.');
    }
    next = next.replace(
      applyPattern,
      (match) => `${match}\n          add(TdLibPackage())`,
    );
  }
  return next;
}

function registerJava(contents) {
  let next = contents;
  if (!next.includes(IMPORT_JAVA)) {
    next = next.replace(/^(package\s+[^;]+;\n)/mu, `$1\n${IMPORT_JAVA}\n`);
  }
  if (!next.includes('packages.add(new TdLibPackage())')) {
    const marker = 'List<ReactPackage> packages = new PackageList(this).getPackages();';
    if (!next.includes(marker)) {
      throw new Error('[with-tdlib] Could not register TdLibPackage in Java MainApplication.');
    }
    next = next.replace(marker, `${marker}\n      packages.add(new TdLibPackage());`);
  }
  return next;
}

function withTdlibMainApplication(config) {
  return withMainApplication(config, (modConfig) => {
    modConfig.modResults.contents =
      modConfig.modResults.language === 'java'
        ? registerJava(modConfig.modResults.contents)
        : registerKotlin(modConfig.modResults.contents);
    return modConfig;
  });
}

module.exports = function withTdlib(config) {
  return withTdlibMainApplication(
    withTdlibAppBuildGradle(withTdlibSettingsGradle(config)),
  );
};
