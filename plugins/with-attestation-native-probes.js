const fs = require('node:fs');
const path = require('node:path');
const { withMainApplication } = require('@expo/config-plugins');

const PACKAGE_NAME = 'com.attestation.nativeprobes';
const IMPORT_KOTLIN = `import ${PACKAGE_NAME}.AttestationNativeProbesPackage`;
const IMPORT_JAVA = `import ${PACKAGE_NAME}.AttestationNativeProbesPackage;`;

const SOURCE_FILES = [
  'AttestationNativeProbesModule.kt',
  'AttestationNativeProbesPackage.kt',
];

/**
 * Copy the native sources into the generated project.
 *
 * The source path deliberately contains no directory segment named `android`.
 * .gitignore excludes `android/` unanchored — correctly, since every directory
 * with that name is generated output — but EAS Build filters its upload with
 * those same rules, and it does so by path, not by whether git tracks the
 * file. These two files were committed and present locally, and still never
 * reached the build worker: prebuild there died on an ENOENT for a file that
 * exists in the repository, which is about as misleading as a build error
 * gets. Keeping hand-written Kotlin out from under `android/` is what makes it
 * survive the trip.
 *
 * Unlike the Google authorization module, a missing source here is fatal
 * rather than skippable. Google sign-in degrades to a visible "no native
 * bridge" message, but attestation degrades to silence: the device assessment
 * reports "unavailable" and a release ships with its hardware integrity checks
 * quietly absent. A security control must not disappear because a file did.
 */
function copyNativeSources(projectRoot, platformProjectRoot) {
  const sourceRoot = path.join(
    projectRoot,
    'src/attestation/native/kotlin/com/attestation/nativeprobes',
  );

  const missing = SOURCE_FILES.filter(
    (file) => !fs.existsSync(path.join(sourceRoot, file)),
  );
  if (missing.length > 0) {
    throw new Error(
      `[with-attestation-native-probes] Cannot build: ${missing.join(', ')} ` +
        `not found in ${sourceRoot}.\n` +
        'These files are committed, so on a build worker this means they were ' +
        'excluded from the upload — check that no .gitignore or .easignore ' +
        'rule matches the path above. Attestation is a security control and ' +
        'is not built without it.',
    );
  }

  const targetRoot = path.join(
    platformProjectRoot,
    'app/src/main/java/com/attestation/nativeprobes',
  );
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const file of SOURCE_FILES) {
    fs.copyFileSync(path.join(sourceRoot, file), path.join(targetRoot, file));
  }
}

function registerKotlin(contents) {
  let next = contents;
  if (!next.includes(IMPORT_KOTLIN)) {
    next = next.replace(/^(package\s+[^\n]+\n)/m, `$1\n${IMPORT_KOTLIN}\n`);
  }
  if (!next.includes('add(AttestationNativeProbesPackage())')) {
    const applyPattern = /PackageList\(this\)\.packages\.apply\s*\{/;
    if (!applyPattern.test(next)) {
      throw new Error(
        'Could not register AttestationNativeProbesPackage in Kotlin MainApplication.',
      );
    }
    next = next.replace(
      applyPattern,
      (match) => `${match}\n          add(AttestationNativeProbesPackage())`,
    );
  }
  return next;
}

function registerJava(contents) {
  let next = contents;
  if (!next.includes(IMPORT_JAVA)) {
    next = next.replace(/^(package\s+[^;]+;\n)/m, `$1\n${IMPORT_JAVA}\n`);
  }
  if (!next.includes('packages.add(new AttestationNativeProbesPackage())')) {
    const marker =
      'List<ReactPackage> packages = new PackageList(this).getPackages();';
    if (!next.includes(marker)) {
      throw new Error(
        'Could not register AttestationNativeProbesPackage in Java MainApplication.',
      );
    }
    next = next.replace(
      marker,
      `${marker}\n      packages.add(new AttestationNativeProbesPackage());`,
    );
  }
  return next;
}

module.exports = function withAttestationNativeProbes(config) {
  return withMainApplication(config, async (modConfig) => {
    copyNativeSources(
      modConfig.modRequest.projectRoot,
      modConfig.modRequest.platformProjectRoot,
    );
    modConfig.modResults.contents =
      modConfig.modResults.language === 'java'
        ? registerJava(modConfig.modResults.contents)
        : registerKotlin(modConfig.modResults.contents);
    return modConfig;
  });
};
