const fs = require('node:fs');
const path = require('node:path');
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require('@expo/config-plugins');

const PACKAGE_NAME = 'com.creepyim.smartcards';
const IMPORT_KOTLIN = `import ${PACKAGE_NAME}.SmartCardsPackage`;
const IMPORT_JAVA = `import ${PACKAGE_NAME}.SmartCardsPackage;`;
const RECEIVER = `${PACKAGE_NAME}.SmartCardReceiver`;

const SOURCE_ROOT = 'src/notifications/native';
const KOTLIN_FILES = [
  'SmartCard.kt',
  'SmartCardNotification.kt',
  'SmartCardReceiver.kt',
  'SmartCardsModule.kt',
  'SmartCardsPackage.kt',
];
const LAYOUTS = ['smart_card_compact.xml', 'smart_card_expanded.xml'];

/**
 * Notification cards: Kotlin sources, RemoteViews layouts, the manifest entries
 * and the package registration.
 *
 * A plugin rather than hand edits to android/, because android/ is generated
 * and never uploaded — EAS builds it from the template, so anything edited in
 * place exists only on the machine that edited it. That is exactly how TDLib
 * came to work locally and be missing from every store build.
 *
 * The sources live under native/kotlin/ rather than native/android/: the
 * unanchored `android/` rule in .gitignore matches any directory with that
 * name, and files under one are silently untracked and silently absent from
 * the build upload.
 */

function copySources(projectRoot, platformProjectRoot, appPackage) {
  const kotlinFrom = path.join(projectRoot, SOURCE_ROOT, 'kotlin/com/creepyim/smartcards');
  const missing = KOTLIN_FILES.filter(
    (file) => !fs.existsSync(path.join(kotlinFrom, file)),
  );
  if (missing.length > 0) {
    // Fatal, like attestation and unlike Google sign-in: a half-copied module
    // fails to compile, and a build that omits it silently ships an app whose
    // notification API rejects every call at runtime.
    throw new Error(
      `[with-smart-cards] Cannot build: ${missing.join(', ')} not found in ` +
        `${kotlinFrom}. Check that no ignore rule matches that path.`,
    );
  }

  const kotlinTo = path.join(
    platformProjectRoot,
    'app/src/main/java/com/creepyim/smartcards',
  );
  fs.mkdirSync(kotlinTo, { recursive: true });
  for (const file of KOTLIN_FILES) {
    /*
     * The RemoteViews layouts are compiled into the app module, so their ids
     * are in the app's R class. Its package is the application id, which is
     * configuration rather than something this module can hardcode, so the
     * import is stamped in on the way through.
     */
    const source = fs
      .readFileSync(path.join(kotlinFrom, file), 'utf8')
      .replace(/__APP_PACKAGE__/gu, appPackage);
    fs.writeFileSync(path.join(kotlinTo, file), source);
  }

  const layoutFrom = path.join(projectRoot, SOURCE_ROOT, 'res/layout');
  const layoutTo = path.join(platformProjectRoot, 'app/src/main/res/layout');
  fs.mkdirSync(layoutTo, { recursive: true });
  for (const file of LAYOUTS) {
    const source = path.join(layoutFrom, file);
    if (!fs.existsSync(source)) {
      throw new Error(`[with-smart-cards] Missing RemoteViews layout ${source}.`);
    }
    fs.copyFileSync(source, path.join(layoutTo, file));
  }
}

function withSmartCardSources(config) {
  return withDangerousMod(config, [
    'android',
    (modConfig) => {
      const appPackage = AndroidConfig.Package.getPackage(modConfig);
      if (!appPackage) {
        throw new Error('[with-smart-cards] android.package is not set, so the R import cannot be resolved.');
      }
      copySources(
        modConfig.modRequest.projectRoot,
        modConfig.modRequest.platformProjectRoot,
        appPackage,
      );
      return modConfig;
    },
  ]);
}

/**
 * POST_NOTIFICATIONS and the receiver.
 *
 * The permission is Android 13+ and is requested at runtime; declaring it is
 * only half the requirement. The receiver is `exported="false"` — nothing
 * outside the app has any business firing a card transition, and an exported
 * receiver would let any app advance the user's notification.
 */
function withSmartCardManifest(config) {
  return withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults;

    AndroidConfig.Permissions.ensurePermission(
      manifest,
      'android.permission.POST_NOTIFICATIONS',
    );

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    application.receiver = application.receiver ?? [];
    const already = application.receiver.some(
      (entry) => entry.$?.['android:name'] === RECEIVER,
    );
    if (!already) {
      application.receiver.push({
        $: {
          'android:name': RECEIVER,
          'android:exported': 'false',
        },
      });
    }
    return modConfig;
  });
}

function registerKotlin(contents) {
  let next = contents;
  if (!next.includes(IMPORT_KOTLIN)) {
    next = next.replace(/^(package\s+[^\n]+\n)/mu, `$1\n${IMPORT_KOTLIN}\n`);
  }
  if (!next.includes('add(SmartCardsPackage())')) {
    const applyPattern = /PackageList\(this\)\.packages\.apply\s*\{/u;
    if (!applyPattern.test(next)) {
      throw new Error('[with-smart-cards] Could not register SmartCardsPackage in Kotlin MainApplication.');
    }
    next = next.replace(
      applyPattern,
      (match) => `${match}\n          add(SmartCardsPackage())`,
    );
  }
  return next;
}

function registerJava(contents) {
  let next = contents;
  if (!next.includes(IMPORT_JAVA)) {
    next = next.replace(/^(package\s+[^;]+;\n)/mu, `$1\n${IMPORT_JAVA}\n`);
  }
  if (!next.includes('packages.add(new SmartCardsPackage())')) {
    const marker = 'List<ReactPackage> packages = new PackageList(this).getPackages();';
    if (!next.includes(marker)) {
      throw new Error('[with-smart-cards] Could not register SmartCardsPackage in Java MainApplication.');
    }
    next = next.replace(marker, `${marker}\n      packages.add(new SmartCardsPackage());`);
  }
  return next;
}

function withSmartCardRegistration(config) {
  return withMainApplication(config, (modConfig) => {
    modConfig.modResults.contents =
      modConfig.modResults.language === 'java'
        ? registerJava(modConfig.modResults.contents)
        : registerKotlin(modConfig.modResults.contents);
    return modConfig;
  });
}

module.exports = function withSmartCards(config) {
  return withSmartCardRegistration(
    withSmartCardManifest(withSmartCardSources(config)),
  );
};
