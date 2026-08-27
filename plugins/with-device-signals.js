const fs = require('node:fs');
const path = require('node:path');
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require('@expo/config-plugins');

/**
 * Phase 4 device signals: usage history, the notification shade, media control.
 *
 * One plugin for three modules because they are not independent. Media control
 * reads sessions through MediaSessionManager, which requires the
 * notification-listener component to exist and be granted — so shipping the
 * media module without the listener would produce a capability that silently
 * returns nothing.
 */

const MODULES = [
  {
    package: 'com.creepyim.usage',
    reactPackage: 'UsagePackage',
    sourceRoot: 'src/usage/native/kotlin/com/creepyim/usage',
    target: 'app/src/main/java/com/creepyim/usage',
    files: ['UsageStatsModule.kt', 'UsagePackage.kt'],
  },
  {
    package: 'com.creepyim.notifications',
    reactPackage: 'NotificationReaderPackage',
    sourceRoot: 'src/notifications/reader/native/kotlin/com/creepyim/notifications',
    target: 'app/src/main/java/com/creepyim/notifications',
    files: [
      'NotificationReaderService.kt',
      'NotificationReaderModule.kt',
      'NotificationReaderPackage.kt',
    ],
  },
  {
    package: 'com.creepyim.media',
    reactPackage: 'MediaPackage',
    sourceRoot: 'src/media/native/kotlin/com/creepyim/media',
    target: 'app/src/main/java/com/creepyim/media',
    files: ['MediaControlModule.kt', 'MediaPackage.kt'],
  },
];

const LISTENER = 'com.creepyim.notifications.NotificationReaderService';

function withSources(config) {
  return withDangerousMod(config, [
    'android',
    (modConfig) => {
      const { projectRoot, platformProjectRoot } = modConfig.modRequest;
      for (const module of MODULES) {
        const from = path.join(projectRoot, module.sourceRoot);
        const missing = module.files.filter(
          (file) => !fs.existsSync(path.join(from, file)),
        );
        if (missing.length > 0) {
          throw new Error(
            `[with-device-signals] Cannot build: ${missing.join(', ')} not found in ${from}.`,
          );
        }
        const to = path.join(platformProjectRoot, module.target);
        fs.mkdirSync(to, { recursive: true });
        for (const file of module.files) {
          fs.copyFileSync(path.join(from, file), path.join(to, file));
        }
      }
      return modConfig;
    },
  ]);
}

/**
 * PACKAGE_USAGE_STATS, and the listener service.
 *
 * PACKAGE_USAGE_STATS is signature-level: declaring it does not grant it, and
 * it cannot be requested with a dialog. It must still be declared or the
 * system will not offer the app on the usage-access screen at all — the
 * declaration is what makes the app appear in that list.
 *
 * The listener is exported and guarded by BIND_NOTIFICATION_LISTENER_SERVICE.
 * Without the guard any app could bind it; without `exported` the platform
 * cannot, and the app never appears in the notification-access list.
 */
function withManifest(config) {
  return withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults;

    AndroidConfig.Permissions.ensurePermission(
      manifest,
      'android.permission.PACKAGE_USAGE_STATS',
    );
    // Needed to read media metadata from another app's session.
    AndroidConfig.Permissions.ensurePermission(
      manifest,
      'android.permission.MEDIA_CONTENT_CONTROL',
    );

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    application.service = application.service ?? [];
    const already = application.service.some(
      (service) => service.$?.['android:name'] === LISTENER,
    );
    if (!already) {
      application.service.push({
        $: {
          'android:name': LISTENER,
          'android:permission': 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [
              {
                $: {
                  'android:name': 'android.service.notification.NotificationListenerService',
                },
              },
            ],
          },
        ],
      });
    }

    return modConfig;
  });
}

function registerKotlin(contents) {
  let next = contents;
  for (const module of MODULES) {
    const importLine = `import ${module.package}.${module.reactPackage}`;
    if (!next.includes(importLine)) {
      next = next.replace(/^(package\s+[^\n]+\n)/mu, `$1\n${importLine}\n`);
    }
    const add = `add(${module.reactPackage}())`;
    if (!next.includes(add)) {
      const applyPattern = /PackageList\(this\)\.packages\.apply\s*\{/u;
      if (!applyPattern.test(next)) {
        throw new Error(
          `[with-device-signals] Could not register ${module.reactPackage} in MainApplication.`,
        );
      }
      next = next.replace(applyPattern, (match) => `${match}\n          ${add}`);
    }
  }
  return next;
}

function registerJava(contents) {
  let next = contents;
  const marker = 'List<ReactPackage> packages = new PackageList(this).getPackages();';
  for (const module of MODULES) {
    const importLine = `import ${module.package}.${module.reactPackage};`;
    if (!next.includes(importLine)) {
      next = next.replace(/^(package\s+[^;]+;\n)/mu, `$1\n${importLine}\n`);
    }
    const add = `packages.add(new ${module.reactPackage}());`;
    if (!next.includes(add)) {
      if (!next.includes(marker)) {
        throw new Error(
          `[with-device-signals] Could not register ${module.reactPackage} in MainApplication.`,
        );
      }
      next = next.replace(marker, `${marker}\n      ${add}`);
    }
  }
  return next;
}

function withRegistration(config) {
  return withMainApplication(config, (modConfig) => {
    modConfig.modResults.contents =
      modConfig.modResults.language === 'java'
        ? registerJava(modConfig.modResults.contents)
        : registerKotlin(modConfig.modResults.contents);
    return modConfig;
  });
}

module.exports = function withDeviceSignals(config) {
  return withRegistration(withManifest(withSources(config)));
};
