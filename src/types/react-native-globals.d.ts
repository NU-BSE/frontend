/**
 * `global` for dependencies that assume a Node-style global object.
 *
 * `react-native-iap` ships its TypeScript source alongside its declarations,
 * so importing it pulls that source into the program, and it references
 * `global` without declaring it. Declaring the one symbol is narrower than
 * adding `@types/node` to `compilerOptions.types`, which would expose Node's
 * entire global surface to React Native code that cannot use it.
 *
 * `var` is required: an ambient global declaration needs a function-scoped
 * binding, and `let`/`const` are block-scoped so they create no global.
 */
// eslint-disable-next-line no-var
declare var global: typeof globalThis;
