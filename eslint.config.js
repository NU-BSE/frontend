// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      "dist/*",

      /*
       * Mirrors the `exclude` in tsconfig.json, which already keeps this tree
       * out of the typechecked program.
       *
       * `src/attestation/**` is a dormant subsystem: nothing in `app/` or the
       * rest of `src/` imports it except `client/deviceAssessment` (which
       * resolves cleanly and only touches react-native and the native probe
       * module). The rest depends on a `config/attestation.config` that was
       * never committed, plus Node server packages — express, pg, redis,
       * google-auth-library, @simplewebauthn/server — that have no place in an
       * Expo app's dependency tree. Linting it produced 45 unresolved-import
       * errors that no amount of application code could fix.
       *
       * Reviving the subsystem means restoring that config file and installing
       * its dependencies; drop this entry at the same time so the code comes
       * back under both the linter and the typechecker.
       */
      "src/attestation/**",
    ],
  }
]);
