const fs = require('node:fs');
const path = require('node:path');
const {
  withMainApplication,
  withAppBuildGradle,
} = require('@expo/config-plugins');

const PACKAGE_NAME = 'com.creepyim.googleauth';
const IMPORT_KOTLIN = `import ${PACKAGE_NAME}.GoogleAuthorizationPackage`;
const IMPORT_JAVA = `import ${PACKAGE_NAME}.GoogleAuthorizationPackage;`;

/*
 * A floor set by the module, not a preference. This plugin pinned 21.3.0
 * before the native half existed, and that version is missing three APIs it
 * uses: `ClearTokenRequest` and `RevokeAccessRequest` (clearToken/revoke)
 * arrived in 21.4.0, and `AuthorizationRequest.Prompt` (the SELECT_ACCOUNT
 * prompt) only in 21.6.0. Downgrading breaks disconnect, sign-out, or account
 * switching rather than failing loudly, so verify against the AAR before
 * moving this.
 */
const GMS_AUTH_DEPENDENCY =
  'com.google.android.gms:play-services-auth:21.6.0';

const SOURCE_FILES = [
  'GoogleAuthorizationModule.kt',
  'GoogleAuthorizationPackage.kt',
];

/**
 * Copy the native sources, reporting honestly when they are absent.
 *
 * Returns false — rather than throwing — when the Kotlin is missing, so a
 * prebuild is not made impossible by it. This plugin shipped before its native
 * half was written, and it copied unconditionally: prebuild aborted with an
 * ENOENT *after* clearing android/, leaving no native project at all. A
 * missing optional module should cost that module, not the build.
 *
 * The source path deliberately avoids a directory segment named `android`,
 * which .gitignore excludes everywhere. Hand-written sources under such a path
 * can never be committed, and `git status` does not list them, so the gap is
 * invisible until a fresh clone fails to build.
 *
 * Skipping is visible, not silent: the warning below names the missing path,
 * and at runtime `authorizeGoogle()` reports "no native authorization bridge"
 * rather than pretending sign-in works.
 */
function copyNativeSources(projectRoot, platformProjectRoot) {
  const sourceRoot = path.join(
    projectRoot,
    'src/connections/google/native/kotlin/com/creepyim/googleauth',
  );

  const missing = SOURCE_FILES.filter(
    (file) => !fs.existsSync(path.join(sourceRoot, file)),
  );
  if (missing.length > 0) {
    console.warn(
      `[with-google-authorization] Skipping the native Google authorization ` +
        `module: ${missing.join(', ')} not found in ${sourceRoot}. Google ` +
        `sign-in will report that no native bridge is available. Write those ` +
        `two files to include the module in builds.`,
    );
    return false;
  }
  const targetRoot = path.join(
    platformProjectRoot,
    'app/src/main/java/com/creepyim/googleauth',
  );
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const file of SOURCE_FILES) {
    fs.copyFileSync(path.join(sourceRoot, file), path.join(targetRoot, file));
  }
  return true;
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
    const copied = copyNativeSources(
      modConfig.modRequest.projectRoot,
      modConfig.modRequest.platformProjectRoot,
    );
    // Registering a package whose class was not copied would fail to compile,
    // which is a worse failure than not registering it.
    if (!copied) return modConfig;
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
