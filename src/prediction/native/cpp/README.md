# Cold-user Google Play category predictor — C++17

This version keeps the same deployment contract as the Python prototype, but the trainer and predictor are implemented in **standard C++17**.

The important boundary is:

```text
OFFLINE
myket.csv + app -> category catalog
              |
              v
      C++ coefficient training
              |
              v
      category_models.json

DEPLOYMENT
category_models.json + NEW USER category timestamps
              |
              v
       frozen C++ inference
              |
              v
       predicted next time
```

The deployed predictor never loads Myket, never looks up a training user, and never refits a coefficient.

## Model

For every category `c`, including categories such as:

```text
Communication -> COMMUNICATION
Sports        -> SPORTS
Tools         -> TOOLS
```

the offline trainer derives a fixed ridge-regression model:

```text
log(1 + next_gap_seconds)
    = intercept[c]
    + beta[c,0] * log_last_gap
    + beta[c,1] * log_median_gap
    + ...
    + beta[c,9] * log_last_to_median_ratio
```

The complete runtime feature vector is:

1. `log_last_gap`
2. `log_median_gap`
3. `log_mean_gap`
4. `log_ewma_gap`
5. `log_recent3_median_gap`
6. `log_iqr_gap`
7. `gap_cv`
8. `log_history_count`
9. `log_elapsed_per_event`
10. `log_last_to_median_ratio`

At runtime these ten values are calculated only from the new user's timestamps in the requested category. They are **features**, not learned parameters.

All of the following are frozen offline in `category_models.json`:

- category intercept;
- ten category coefficients;
- selected ridge penalty;
- 1st/99th-percentile prediction bounds;
- global fallback coefficients;
- training support counts;
- held-out-user validation diagnostics.

## Why this C++ implementation is deployment-friendly

The C++ source has no NumPy, pandas, Python, Eigen, Boost, or third-party JSON dependency.

It contains:

- a small JSON reader/writer for this model bundle;
- CSV parsing;
- feature generation;
- 11x11 ridge linear-system solving;
- deterministic user-level validation splitting;
- ISO-8601 / Unix timestamp parsing;
- inference from the frozen coefficient bundle.

During fitting it accumulates regression sufficient statistics instead of storing an `N x 10` design matrix. It still keeps grouped event timestamps, validation examples, and gap samples needed for ordering, validation, and percentile clipping.

## Build

Linux / macOS with a C++17 compiler:

```bash
g++ -std=c++17 -O3 -DNDEBUG -Wall -Wextra -pedantic \
  cold_start_category_predictor.cpp \
  -o cold_start_category_predictor
```

Or with CMake:

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j
```

The executable requires no additional runtime library beyond the normal C++ standard library.

## Required input files for offline training

### Interaction file

`myket.csv` or another JODIE-style timestamped app-event CSV.

The trainer intentionally uses only:

```text
user_id, app_name/app_id/package, timestamp
```

Extra feature-tail columns are ignored.

### App category catalog

The second input maps a package ID to its category. For example:

```csv
app_id,genre_id
com.whatsapp,COMMUNICATION
com.google.android.apps.maps,TRAVEL_AND_LOCAL
com.example.sports,SPORTS
```

Recognized app-ID column names:

```text
app_id
app_name
package
package_name
```

Recognized category column names:

```text
primary_category
genre_id
genreId
category_id
category
category_en
```

Categories are normalized for model lookup. For example:

```text
Communication  -> COMMUNICATION
sports         -> SPORTS
Travel & Local -> TRAVEL_LOCAL
```

For Google Play deployment, prefer the Play `genreId` value so training and runtime category identifiers use the same vocabulary.

## Train all coefficients offline

```bash
./cold_start_category_predictor train \
  --input ./myket.csv \
  --catalog-csv ./app_catalog.csv \
  --output ./category_models.json
```

Optional controls:

```bash
./cold_start_category_predictor train \
  --input ./myket.csv \
  --catalog-csv ./app_catalog.csv \
  --output ./category_models.json \
  --min-history 3 \
  --max-history 50 \
  --min-category-samples 100
```

Defaults:

```text
min-history            = 3 timestamps
max-history            = 50 timestamps
min-category-samples   = 100 training examples
ridge candidates       = 0.01, 0.1, 1, 10, 100
validation users       = deterministic 1/5 user holdout
```

The C++ version uses stable FNV-1a hashing of `user_id` for the deterministic user holdout. The validation split is used only for choosing the ridge penalty and reporting diagnostics. After selection, the final category coefficients are fitted again from all offline samples.

## Deployable model artifact

The result is one JSON file:

```text
category_models.json
```

Conceptually:

```json
{
  "global_model": {
    "category": "__GLOBAL__",
    "intercept": 7.9,
    "coefficients": {
      "log_last_gap": 0.21,
      "log_median_gap": 0.34
    },
    "ridge_lambda": 1.0,
    "clip_gap_seconds": {
      "min": 60,
      "max": 172800
    }
  },
  "category_models": {
    "COMMUNICATION": {
      "intercept": 8.1,
      "coefficients": {
        "log_last_gap": 0.42,
        "log_median_gap": 0.31
      }
    },
    "SPORTS": {
      "intercept": 8.7,
      "coefficients": {}
    },
    "TOOLS": {
      "intercept": 9.0,
      "coefficients": {}
    }
  }
}
```

The numbers above are illustrative only. The real values are derived by the `train` command from the offline dataset.

`category_models.json` is the artifact to ship with the predictor. The training CSVs are not required in deployment.

## List available category models

```bash
./cold_start_category_predictor categories \
  --model ./category_models.json
```

Output format:

```text
COMMUNICATION    <training_samples>    <dataset_users>
SPORTS           <training_samples>    <dataset_users>
TOOLS            <training_samples>    <dataset_users>
```

If a category did not have enough offline examples to receive a dedicated model, prediction uses the frozen `__GLOBAL__` model. That fallback is also trained offline; it does not perform online fitting.

## Predict for a completely new user

The user does not need to exist in Myket.

### Unix timestamps

```bash
./cold_start_category_predictor predict \
  --model ./category_models.json \
  --category COMMUNICATION \
  --timestamp 1786900200 \
  --timestamp 1786904100 \
  --timestamp 1786911600 \
  --timestamp 1786920000 \
  --timezone Asia/Qyzylorda
```

### ISO-8601 timestamps

```bash
./cold_start_category_predictor predict \
  --model ./category_models.json \
  --category SPORTS \
  --timestamp '2026-08-17T08:00:00+05:00' \
  --timestamp '2026-08-17T13:20:00+05:00' \
  --timestamp '2026-08-18T07:45:00+05:00' \
  --timezone Asia/Qyzylorda
```

### Timestamp file

```bash
./cold_start_category_predictor predict \
  --model ./category_models.json \
  --category TOOLS \
  --timestamps-file ./user_tools_timestamps.csv \
  --timezone Asia/Qyzylorda
```

Only the first non-empty cell on each row of the timestamp file is used. Header cells such as `timestamp` or `time` are ignored.

At least **3 distinct timestamps** are required because the runtime feature vector requires at least two positive gaps.

## Prediction result

The command returns JSON containing fields such as:

```json
{
  "category_requested": "COMMUNICATION",
  "model_category": "COMMUNICATION",
  "used_global_fallback": false,
  "last_event_s": 1786920000,
  "predicted_gap_seconds": 4123.5,
  "predicted_event_s": 1786924123.5,
  "predicted_at_utc": "2026-08-...Z",
  "predicted_at_local": "2026-08-...+05:00"
}
```

The actual inference equation is:

```text
x = features(new_user_category_timestamps)

log_gap = category_intercept + dot(category_coefficients, x)

gap = exp(log_gap) - 1

gap = clamp(
    gap,
    offline_category_1st_percentile,
    offline_category_99th_percentile
)

predicted_timestamp = latest_user_timestamp + gap
```

Nothing in this sequence updates or derives a coefficient from the new user.

## Relative Myket timestamps vs. real app-open timestamps

The public Myket data provides relative interaction timestamps rather than recoverable wall-clock app-open times. This model therefore learns **durations between category interactions**.

Duration learning is origin-independent:

```text
next_gap = next_timestamp - previous_timestamp
```

So coefficients learned from relative timestamps can be applied to a new user's real Unix/ISO timestamps, and the predicted duration can be added to their latest real event.

However, Myket cannot teach the model a true preference such as:

```text
"this category is usually opened at 08:15 on weekdays"
```

because that requires offline training data containing genuine wall-clock app-open timestamps.

If you later train on Android UsageStats/app-open telemetry with absolute timestamps, the same cold-user architecture can be extended with offline-derived hour-of-day and day-of-week coefficients.

## Timezone behavior

`predicted_event_s` and `predicted_at_utc` are portable and should be the authoritative deployment values.

On POSIX systems, `--timezone Asia/Qyzylorda` is also used to format `predicted_at_local` through the host timezone database. The target OS/container therefore needs that IANA timezone installed.

On Windows, the current source intentionally keeps Unix/UTC prediction portable and may omit `predicted_at_local`. An Android application can normally convert the returned epoch timestamp to the device timezone in the Kotlin/Java UI layer.

## Recommended Android deployment split

For an Android product, a clean architecture is:

```text
Offline CI / workstation
    C++ train command
        -> category_models.json

Android app
    UsageStats / app-open collector
        -> category timestamp arrays
    package -> Google Play category mapping
        -> COMMUNICATION / SPORTS / TOOLS / ...
    C++ predictor core or equivalent native wrapper
        -> predicted Unix timestamp
    Kotlin/Java presentation layer
        -> device-local date/time
```

Do not ship:

```text
myket.csv
training user IDs
training event histories
```

Ship only the frozen category model bundle and the inference code.
