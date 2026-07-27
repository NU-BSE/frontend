const fs = require('node:fs');
const path = require('node:path');
const { withMainApplication } = require('@expo/config-plugins');

const PACKAGE_NAME = 'com.attestation.nativeprobes';
const IMPORT_KOTLIN = `import ${PACKAGE_NAME}.AttestationNativeProbesPackage`;
const IMPORT_JAVA = `import ${PACKAGE_NAME}.AttestationNativeProbesPackage;`;

function copyNativeSources(projectRoot, platformProjectRoot) {
  const sourceRoot = path.join(
    projectRoot,
    'src/attestation/native/android/src/main/java/com/attestation/nativeprobes',
  );
  const targetRoot = path.join(
    platformProjectRoot,
    'app/src/main/java/com/attestation/nativeprobes',
  );
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const file of [
    'AttestationNativeProbesModule.kt',
    'AttestationNativeProbesPackage.kt',
  ]) {
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
