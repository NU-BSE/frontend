/**
 * Messages for HTTP failures the API did not describe itself.
 *
 * Deliberately free of imports: the verification scripts run this in Node,
 * and anything reaching for `react-native` here would drag the whole runtime
 * into a bundle that only needs a string.
 */

/**
 * A message for a failure the API did not describe itself.
 *
 * The backend answers errors as JSON with a `message`, so this is for the
 * responses that never reached it: a proxy or load balancer refusing on its
 * behalf. Those bodies are plain text, `response.json()` throws, and the old
 * fallback was `response.statusText` — which React Native leaves empty. The
 * result was an ApiError with an empty message, a screen that set its error
 * state to "" and rendered nothing, and a Continue button that appeared to do
 * nothing at all while the backend was down.
 *
 * The status code is always included, so a report can never be "it just does
 * not work".
 */
export function describeHttpFailure(
  status: number,
  statusText: string | undefined,
  origin: string,
): string {
  if (status === 502 || status === 503 || status === 504) {
    return (
      `The server at ${origin} is not responding (HTTP ${status}). ` +
      'It may be down or restarting — try again shortly.'
    );
  }
  if (status >= 500) {
    return `The server at ${origin} failed (HTTP ${status}).`;
  }
  if (statusText) return `${statusText} (HTTP ${status})`;
  return `Request failed (HTTP ${status}).`;
}
