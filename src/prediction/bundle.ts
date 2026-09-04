import type { ModelBundle } from './inference';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const bundle = require('./fixtures/category_models.sample.json') as ModelBundle;

/**
 * The frozen predictor weights shipped with the app.
 *
 * This is currently the *sample* bundle — the same one the verification script
 * checks against the C++ reference. It is a real trained model and produces
 * real predictions, but it was not trained on this product's users, so its
 * timing will be generic until a production bundle replaces it. Swapping the
 * file is the whole change; nothing else reads the weights.
 *
 * Bundled rather than fetched: a prediction that needs the network is useless
 * on the cold start it exists to serve.
 */
export function loadModelBundle(): ModelBundle | null {
  // Guarded because a malformed or truncated bundle should disable the
  // feature, not crash the app at import time.
  if (!bundle || typeof bundle !== 'object' || !bundle.category_models) return null;
  return bundle;
}
