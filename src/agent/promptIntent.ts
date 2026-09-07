/**
 * Telling an in-app navigation apart from an external intent.
 *
 * `MainActivity` is exported and owns the `creepyim://` scheme, so any app on
 * the device can start it with arbitrary parameters. The chat screen used to
 * auto-send whatever arrived in `?prompt=`, which made the app a free
 * inference oracle: a third-party app could run prompts against the local
 * model — and against the user's connected accounts and tool permissions —
 * without ever stealing a single weight.
 *
 * Stealing the model is the expensive attack. Borrowing it through a public
 * intent is the cheap one, and it is the one worth closing first.
 *
 * A prompt is therefore auto-sent only when it carries a token this process
 * issued. An external caller cannot guess it, so its text is offered to the
 * user in the composer instead of executed. Nothing is blocked — the user can
 * still send it — but the decision returns to them.
 */

/**
 * Random per-process, never persisted.
 *
 * Per-process is the point: a value written to storage could be read by a
 * backup extraction or by anything that later gains file access, and a
 * constant would only need to be found once, in a decompiled build. This one
 * is meaningless the moment the process dies.
 */
const SESSION_TOKEN = randomToken();

function randomToken(): string {
  // Not a secret against someone who already controls the process — that
  // attacker has the model itself. It only has to be unguessable from
  // *outside* the app, which is the boundary an intent crosses.
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Query-parameter name carrying the token. */
export const PROMPT_TOKEN_PARAM = 'k';

/** Appends the token to an in-app link that should auto-send its prompt. */
export function withInternalPromptToken(path: string): string {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}${PROMPT_TOKEN_PARAM}=${SESSION_TOKEN}`;
}

/**
 * Whether this prompt may be sent without the user pressing send.
 *
 * Compared in constant time out of habit rather than necessity: the token is
 * not persisted and a timing oracle over a process-local value is not a
 * realistic attack, but a comparison that leaks length is the kind of detail
 * that gets copied into somewhere it does matter.
 */
export function isInternalPrompt(token: string | undefined): boolean {
  if (!token || token.length !== SESSION_TOKEN.length) return false;
  let difference = 0;
  for (let i = 0; i < token.length; i += 1) {
    difference |= token.charCodeAt(i) ^ SESSION_TOKEN.charCodeAt(i);
  }
  return difference === 0;
}
