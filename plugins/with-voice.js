const fs = require('node:fs');
const path = require('node:path');
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require('@expo/config-plugins');

const PACKAGE_NAME = 'com.creepyim.voice';
const IMPORT_KOTLIN = `import ${PACKAGE_NAME}.VoicePackage`;
const IMPORT_JAVA = `import ${PACKAGE_NAME}.VoicePackage;`;

const SOURCE_ROOT = 'src/voice/native';
const KOTLIN_FILES = [
  'SpeechRecognitionModule.kt',
  'TextToSpeechModule.kt',
  'VoicePackage.kt',
];

/**
 * Speech recognition and text-to-speech.
 *
 * A plugin rather than hand edits to android/, for the reason the rest of this
 * repo learned the hard way — android/ is generated and filtered out of the
 * build upload, so edits there exist only on the machine that made them.
 */

function copySources(projectRoot, platformProjectRoot) {
  const from = path.join(projectRoot, SOURCE_ROOT, 'kotlin/com/creepyim/voice');
  const missing = KOTLIN_FILES.filter((file) => !fs.existsSync(path.join(from, file)));
  if (missing.length > 0) {
    throw new Error(`[with-voice] Cannot build: ${missing.join(', ')} not found in ${from}.`);
  }
  const to = path.join(platformProjectRoot, 'app/src/main/java/com/creepyim/voice');
  fs.mkdirSync(to, { recursive: true });
  for (const file of KOTLIN_FILES) {
    fs.copyFileSync(path.join(from, file), path.join(to, file));
  }
}

function withVoiceSources(config) {
  return withDangerousMod(config, [
    'android',
    (modConfig) => {
      copySources(
        modConfig.modRequest.projectRoot,
        modConfig.modRequest.platformProjectRoot,
      );
      return modConfig;
    },
  ]);
}

/**
 * Adds a `<queries><intent><action …>` entry if it is not already present.
 *
 * Takes the root element (`modResults.manifest`), not the document wrapper
 * (`modResults`). Attaching to the wrapper writes the block after
 * `</manifest>`, where the `android:` prefix is unbound — the manifest merger
 * then fails with a bare "Error parsing AndroidManifest.xml" that names
 * neither the element nor the plugin that added it.
 */
function ensureQueryAction(root, action) {
  root.queries = root.queries ?? [];
  if (root.queries.length === 0) root.queries.push({});
  const queries = root.queries[0];
  queries.intent = queries.intent ?? [];
  const already = queries.intent.some((intent) =>
    (intent.action ?? []).some((entry) => entry.$?.['android:name'] === action),
  );
  if (!already) {
    queries.intent.push({ action: [{ $: { 'android:name': action } }] });
  }
}

/**
 * RECORD_AUDIO, plus the package-visibility queries.
 *
 * The `<queries>` entries are the part that is easy to miss and impossible to
 * diagnose from the app: since Android 11 a package cannot see services it has
 * not declared an interest in, so without these
 * SpeechRecognizer.isRecognitionAvailable() returns false and the TTS engine
 * list comes back empty — on a device where both plainly work. It presents as
 * "this phone has no speech support" rather than as a missing declaration.
 */
function withVoiceManifest(config) {
  return withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults;

    AndroidConfig.Permissions.ensurePermission(manifest, 'android.permission.RECORD_AUDIO');

    ensureQueryAction(manifest.manifest, 'android.speech.RecognitionService');
    ensureQueryAction(manifest.manifest, 'android.intent.action.TTS_SERVICE');

    return modConfig;
  });
}

function registerKotlin(contents) {
  let next = contents;
  if (!next.includes(IMPORT_KOTLIN)) {
    next = next.replace(/^(package\s+[^\n]+\n)/mu, `$1\n${IMPORT_KOTLIN}\n`);
  }
  if (!next.includes('add(VoicePackage())')) {
    const applyPattern = /PackageList\(this\)\.packages\.apply\s*\{/u;
    if (!applyPattern.test(next)) {
      throw new Error('[with-voice] Could not register VoicePackage in Kotlin MainApplication.');
    }
    next = next.replace(applyPattern, (match) => `${match}\n          add(VoicePackage())`);
  }
  return next;
}

function registerJava(contents) {
  let next = contents;
  if (!next.includes(IMPORT_JAVA)) {
    next = next.replace(/^(package\s+[^;]+;\n)/mu, `$1\n${IMPORT_JAVA}\n`);
  }
  if (!next.includes('packages.add(new VoicePackage())')) {
    const marker = 'List<ReactPackage> packages = new PackageList(this).getPackages();';
    if (!next.includes(marker)) {
      throw new Error('[with-voice] Could not register VoicePackage in Java MainApplication.');
    }
    next = next.replace(marker, `${marker}\n      packages.add(new VoicePackage());`);
  }
  return next;
}

function withVoiceRegistration(config) {
  return withMainApplication(config, (modConfig) => {
    modConfig.modResults.contents =
      modConfig.modResults.language === 'java'
        ? registerJava(modConfig.modResults.contents)
        : registerKotlin(modConfig.modResults.contents);
    return modConfig;
  });
}

module.exports = function withVoice(config) {
  return withVoiceRegistration(withVoiceManifest(withVoiceSources(config)));
};
