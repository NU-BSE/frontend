const fs = require('node:fs');
const path = require('node:path');
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require('@expo/config-plugins');

const PACKAGE_NAME = 'com.creepyim.assistant';
const IMPORT_KOTLIN = `import ${PACKAGE_NAME}.AssistantPackage`;
const IMPORT_JAVA = `import ${PACKAGE_NAME}.AssistantPackage;`;

const SOURCE_ROOT = 'src/assistant/native';
const KOTLIN_FILES = [
  'AssistantVoiceService.kt',
  'AssistantSessionService.kt',
  'AssistantSession.kt',
  'AssistantRecognitionService.kt',
  'AssistantRoleModule.kt',
  'AssistantPackage.kt',
  'ScreenContext.kt',
];
const XML_FILES = ['voice_interaction_service.xml', 'recognition_service.xml'];

/**
 * The Android assistant role: services, manifest entries, package registration.
 *
 * A plugin rather than hand edits, for the reason the rest of this repo learned
 * the hard way — android/ is generated and is filtered out of the build upload,
 * so anything edited there exists only on the machine that edited it.
 *
 * Sources live under native/kotlin/ and native/res/, never native/android/:
 * the unanchored `android/` rule in .gitignore matches any directory with that
 * name, and scripts/verify-ignored-sources.mts fails the build if a tracked
 * file ever lands somewhere it would be dropped.
 */

function copySources(projectRoot, platformProjectRoot) {
  const kotlinFrom = path.join(projectRoot, SOURCE_ROOT, 'kotlin/com/creepyim/assistant');
  const missing = KOTLIN_FILES.filter(
    (file) => !fs.existsSync(path.join(kotlinFrom, file)),
  );
  if (missing.length > 0) {
    // Fatal: a half-copied assistant compiles into a build that claims the
    // role and then cannot service it.
    throw new Error(
      `[with-assistant] Cannot build: ${missing.join(', ')} not found in ${kotlinFrom}.`,
    );
  }

  const kotlinTo = path.join(
    platformProjectRoot,
    'app/src/main/java/com/creepyim/assistant',
  );
  fs.mkdirSync(kotlinTo, { recursive: true });
  for (const file of KOTLIN_FILES) {
    fs.copyFileSync(path.join(kotlinFrom, file), path.join(kotlinTo, file));
  }

  /*
   * The xml names the session and recognition services by fully-qualified
   * component. Both live in this module's own fixed package rather than under
   * the configurable application id, so it is copied verbatim — an earlier
   * attempt to substitute an app-package placeholder here produced a doubled
   * `.assistant.assistant.` segment, which the manifest merger accepts and
   * which then fails only at runtime, as an assistant that never appears in
   * the system picker.
   */
  const xmlFrom = path.join(projectRoot, SOURCE_ROOT, 'res/xml');
  const xmlTo = path.join(platformProjectRoot, 'app/src/main/res/xml');
  fs.mkdirSync(xmlTo, { recursive: true });
  for (const file of XML_FILES) {
    const source = path.join(xmlFrom, file);
    if (!fs.existsSync(source)) {
      throw new Error(`[with-assistant] Missing ${source}.`);
    }
    fs.copyFileSync(source, path.join(xmlTo, file));
  }
}

function withAssistantSources(config) {
  return withDangerousMod(config, [
    'android',
    (modConfig) => {
      const appPackage = AndroidConfig.Package.getPackage(modConfig);
      if (!appPackage) {
        throw new Error('[with-assistant] android.package is not set.');
      }
      // appPackage is not interpolated anywhere, but its absence still means
      // a misconfigured project, so the check stays.
      void appPackage;
      copySources(
        modConfig.modRequest.projectRoot,
        modConfig.modRequest.platformProjectRoot,
      );
      return modConfig;
    },
  ]);
}

function ensureService(application, entry) {
  application.service = application.service ?? [];
  const already = application.service.some(
    (service) => service.$?.['android:name'] === entry.$['android:name'],
  );
  if (!already) application.service.push(entry);
}

/**
 * Declares the three services the assistant role needs.
 *
 * All are exported and permission-guarded: the platform binds them from
 * outside the app, so an unexported service is simply never bound and the app
 * silently fails to appear in the assistant picker. The BIND_* permissions are
 * what stop anything other than the system from binding them.
 */
function withAssistantManifest(config) {
  return withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults;
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);

    ensureService(application, {
      $: {
        'android:name': `${PACKAGE_NAME}.AssistantVoiceService`,
        'android:permission': 'android.permission.BIND_VOICE_INTERACTION',
        'android:exported': 'true',
      },
      'intent-filter': [
        { action: [{ $: { 'android:name': 'android.service.voice.VoiceInteractionService' } }] },
      ],
      'meta-data': [
        {
          $: {
            'android:name': 'android.voice_interaction',
            'android:resource': '@xml/voice_interaction_service',
          },
        },
      ],
    });

    ensureService(application, {
      $: {
        'android:name': `${PACKAGE_NAME}.AssistantSessionService`,
        'android:permission': 'android.permission.BIND_VOICE_INTERACTION',
        'android:exported': 'true',
      },
    });

    /*
     * The recogniser carries no BIND_VOICE_INTERACTION guard: that permission
     * is held by the voice-interaction system, not by the speech framework
     * that binds a RecognitionService, so requiring it would stop the
     * component being bound at all. It is exported because the framework
     * binds it from outside the app, and safe to export because it recognises
     * nothing — every callback reports ERROR_CLIENT.
     */
    ensureService(application, {
      $: {
        'android:name': `${PACKAGE_NAME}.AssistantRecognitionService`,
        'android:exported': 'true',
      },
      'intent-filter': [
        { action: [{ $: { 'android:name': 'android.speech.RecognitionService' } }] },
      ],
      'meta-data': [
        {
          $: {
            'android:name': 'android.speech',
            'android:resource': '@xml/recognition_service',
          },
        },
      ],
    });

    return modConfig;
  });
}

function registerKotlin(contents) {
  let next = contents;
  if (!next.includes(IMPORT_KOTLIN)) {
    next = next.replace(/^(package\s+[^\n]+\n)/mu, `$1\n${IMPORT_KOTLIN}\n`);
  }
  if (!next.includes('add(AssistantPackage())')) {
    const applyPattern = /PackageList\(this\)\.packages\.apply\s*\{/u;
    if (!applyPattern.test(next)) {
      throw new Error('[with-assistant] Could not register AssistantPackage in Kotlin MainApplication.');
    }
    next = next.replace(applyPattern, (match) => `${match}\n          add(AssistantPackage())`);
  }
  return next;
}

function registerJava(contents) {
  let next = contents;
  if (!next.includes(IMPORT_JAVA)) {
    next = next.replace(/^(package\s+[^;]+;\n)/mu, `$1\n${IMPORT_JAVA}\n`);
  }
  if (!next.includes('packages.add(new AssistantPackage())')) {
    const marker = 'List<ReactPackage> packages = new PackageList(this).getPackages();';
    if (!next.includes(marker)) {
      throw new Error('[with-assistant] Could not register AssistantPackage in Java MainApplication.');
    }
    next = next.replace(marker, `${marker}\n      packages.add(new AssistantPackage());`);
  }
  return next;
}

function withAssistantRegistration(config) {
  return withMainApplication(config, (modConfig) => {
    modConfig.modResults.contents =
      modConfig.modResults.language === 'java'
        ? registerJava(modConfig.modResults.contents)
        : registerKotlin(modConfig.modResults.contents);
    return modConfig;
  });
}

module.exports = function withAssistant(config) {
  return withAssistantRegistration(
    withAssistantManifest(withAssistantSources(config)),
  );
};
