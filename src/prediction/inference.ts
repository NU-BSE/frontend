/**
 * On-device inference for the cold-start category predictor.
 *
 * The model is trained offline by the C++ in native/cpp and frozen into a JSON
 * bundle. Inference is a ten-feature dot product with clipping, so it runs
 * here rather than through JNI: shipping a native library, a JNI bridge and a
 * second build path to compute `intercept + Σ βᵢxᵢ` would cost far more than
 * it saves, and it would put the prediction behind an async boundary that the
 * notification scheduler does not want.
 *
 * The C++ remains the reference. `verify:logic` runs the compiled binary and
 * this port over identical inputs and asserts the predicted gaps agree, so a
 * change to either that alters behaviour fails the build rather than quietly
 * making the two disagree.
 */

/** Matches kEwmaAlpha in cold_start_category_predictor.cpp. */
const EWMA_ALPHA = 0.35;

/** Order is load-bearing: it must match kFeatureNames and the coefficients. */
export const FEATURE_NAMES = [
  'log_last_gap',
  'log_median_gap',
  'log_mean_gap',
  'log_ewma_gap',
  'log_recent3_median_gap',
  'log_iqr_gap',
  'gap_cv',
  'log_history_count',
  'log_elapsed_per_event',
  'log_last_to_median_ratio',
] as const;

/**
 * A frozen model, exactly as the trainer writes it.
 *
 * Coefficients are keyed by feature name rather than positional, and the clip
 * bounds are nested — both taken from the emitted bundle rather than assumed.
 * Reading them by name also means a reordering of FEATURE_NAMES cannot
 * silently pair a coefficient with the wrong feature.
 */
export interface FrozenModel {
  category: string;
  intercept: number;
  coefficients: Record<string, number>;
  clip_gap_seconds: { min: number; max: number };
  training_samples?: number;
  dataset_users?: number;
  ridge_lambda?: number;
  validation_median_ae_seconds?: number;
}

export interface ModelBundle {
  category_models: Record<string, FrozenModel>;
  global_model: FrozenModel;
  maximum_history_events_used: number;
}

export interface Prediction {
  category: string;
  usedGlobalFallback: boolean;
  /** Seconds from the last event to the predicted next one. */
  gapSeconds: number;
  /** Unix seconds. */
  predictedAt: number;
  features: number[];
}

export class NotEnoughHistory extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotEnoughHistory';
  }
}

/** Linear interpolation between order statistics, as in the C++ quantile(). */
function quantile(values: number[], q: number): number {
  if (values.length === 0) throw new NotEnoughHistory('quantile of empty vector');
  const v = [...values].sort((a, b) => a - b);
  if (v.length === 1) return v[0]!;
  const idx = q * (v.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const w = idx - lo;
  return v[lo]! * (1 - w) + v[hi]! * w;
}

const median = (values: number[]): number => quantile(values, 0.5);

/** Normalization must match normalize_category() in the C++. */
export function normalizeCategory(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]+/gu, '_');
}

/**
 * The ten runtime features, from this user's timestamps alone.
 *
 * Nothing here is learned. `timestamps` must be sorted, unique and in seconds.
 */
export function historyFeatures(timestamps: number[]): number[] {
  if (timestamps.length < 3) {
    throw new NotEnoughHistory('At least 3 category timestamps are required');
  }

  const gaps: number[] = [];
  for (let i = 1; i < timestamps.length; i += 1) {
    const gap = timestamps[i]! - timestamps[i - 1]!;
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length < 2) {
    throw new NotEnoughHistory('At least 2 positive category gaps are required');
  }

  const last = gaps[gaps.length - 1]!;
  const med = median(gaps);
  const mean = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;

  let ewma = gaps[0]!;
  for (let i = 1; i < gaps.length; i += 1) {
    ewma = EWMA_ALPHA * gaps[i]! + (1 - EWMA_ALPHA) * ewma;
  }

  const recent3 = gaps.slice(Math.max(gaps.length - 3, 0));
  const recent3Median = median(recent3);
  const iqr = quantile(gaps, 0.75) - quantile(gaps, 0.25);

  // Sample variance (n-1), matching the C++.
  const variance =
    gaps.reduce((sum, g) => sum + (g - mean) * (g - mean), 0) / (gaps.length - 1);
  const cv = Math.min(10, Math.sqrt(Math.max(0, variance)) / Math.max(mean, 1e-9));

  const historyCount = timestamps.length;
  const elapsedPerEvent =
    (timestamps[historyCount - 1]! - timestamps[0]!) / Math.max(historyCount - 1, 1);
  const lastToMedian = last / Math.max(med, 1e-9);

  return [
    Math.log1p(last),
    Math.log1p(med),
    Math.log1p(mean),
    Math.log1p(ewma),
    Math.log1p(recent3Median),
    Math.log1p(iqr),
    cv,
    Math.log1p(historyCount),
    Math.log1p(Math.max(elapsedPerEvent, 0)),
    Math.log(Math.max(lastToMedian, 1e-9)),
  ];
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/**
 * Predict when this category will next be used.
 *
 * A category the bundle has never seen falls back to the global model rather
 * than refusing: an unknown category is a normal condition for a cold user,
 * and the global coefficients are fitted for exactly that case.
 */
export function predict(
  bundle: ModelBundle,
  categoryRaw: string,
  timestamps: number[],
): Prediction {
  const category = normalizeCategory(categoryRaw);
  const specific = bundle.category_models[category];
  const model = specific ?? bundle.global_model;

  const maxHistory = bundle.maximum_history_events_used;
  const used =
    timestamps.length > maxHistory ? timestamps.slice(timestamps.length - maxHistory) : timestamps;

  const features = historyFeatures(used);
  let logGap = model.intercept;
  FEATURE_NAMES.forEach((name, index) => {
    logGap += (model.coefficients[name] ?? 0) * features[index]!;
  });

  // expm1 of a clamped log, then clipped to the training percentiles — both
  // steps are in the C++ and both matter: the first stops an extreme feature
  // producing Infinity, the second keeps the answer inside observed reality.
  let gap = Math.expm1(clamp(logGap, -20, 40));
  gap = clamp(gap, model.clip_gap_seconds.min, model.clip_gap_seconds.max);

  const last = used[used.length - 1]!;
  return {
    category,
    usedGlobalFallback: specific === undefined,
    gapSeconds: gap,
    predictedAt: last + gap,
    features,
  };
}
