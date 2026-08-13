const fs = require('node:fs');
const path = require('node:path');
const {
  withMainApplication,
  withAppBuildGradle,
} = require('@expo/config-plugins');

const PACKAGE_NAME = 'com.creepyim.googleauth';
const IMPORT_KOTLIN = `import ${PACKAGE_NAME}.GoogleAuthorizationPackage`;
const IMPORT_JAVA = `import ${PACKAGE_NAME}.GoogleAuthorizationPackage;`;

const GMS_AUTH_DEPENDENCY =
  'com.google.android.gms:play-services-auth:21.3.0';

function copyNativeSources(projectRoot, platformProjectRoot) {
  const sourceRoot = path.join(
    projectRoot,
    'src/connections/google/native/android/src/main/java/com/creepyim/googleauth',
  );
  const targetRoot = path.join(
    platformProjectRoot,
    'app/src/main/java/com/creepyim/googleauth',
  );
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const file of [
    'GoogleAuthorizationModule.kt',
    'GoogleAuthorizationPackage.kt',
  ]) {
    fs.copyFileSync(path.join(sourceRoot, file), path.join(targetRoot, file));
  }
}

function registerKotlin(contents) {
  let next = contents;
  if (!next.includes(IMPORT_KOTLIN)) {
    next = next.replace(/^(package\s+[^\n]+\n)/m, `$1\n${IMPORT_KOTLIN}\n`);
  }
  if (!next.includes('add(GoogleAuthorizationPackage())')) {
    const applyPattern = /PackageList\(this\)\.packages\.apply\s*\{/;
    if (!applyPattern.test(next)) {
      throw new Error(
        'Could not register GoogleAuthorizationPackage in Kotlin MainApplication.',
      );
    }
    next = next.replace(
      applyPattern,
      (match) => `${match}\n          add(GoogleAuthorizationPackage())`,
    );
  }
  return next;
}

function registerJava(contents) {
  let next = contents;
  if (!next.includes(IMPORT_JAVA)) {
    next = next.replace(/^(package\s+[^;]+;\n)/m, `$1\n${IMPORT_JAVA}\n`);
  }
  if (!next.includes('packages.add(new GoogleAuthorizationPackage())')) {
    const marker =
      'List<ReactPackage> packages = new PackageList(this).getPackages();';
    if (!next.includes(marker)) {
      throw new Error(
        'Could not register GoogleAuthorizationPackage in Java MainApplication.',
      );
    }
    next = next.replace(
      marker,
      `${marker}\n      packages.add(new GoogleAuthorizationPackage());`,
    );
  }
  return next;
}

function addGmsAuthDependency(gradleContents) {
  if (gradleContents.includes('play-services-auth')) {
    return gradleContents;
  }
  // Insert into the dependencies {} block.
  return gradleContents.replace(
    /(dependencies\s*\{\s*\n)/,
    `$1    implementation '${GMS_AUTH_DEPENDENCY}'\n`,
  );
}

module.exports = function withGoogleAuthorization(config) {
  config = withMainApplication(config, (modConfig) => {
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

  config = withAppBuildGradle(config, (modConfig) => {
    modConfig.modResults.contents = addGmsAuthDependency(
      modConfig.modResults.contents,
    );
    return modConfig;
  });

  return config;
};
