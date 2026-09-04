/**
 * Whether the agent may act right now.
 *
 * The agent sends the user out of the app on purpose — `open_settings` is a
 * successful tool call whose entire effect is that Android's Settings comes to
 * the front. Everything the agent does next happens behind a screen the user is
 * reading, and the transcript of one such run reads:
 *
 *     android.assistant.request_role — done
 *     android.assistant.open_settings — done
 *     android.assistant.get_status — done
 *     Checking agent health — done
 *     android.assistant.open_settings — cancelled by you
 *     Checking agent health — done      (×3)
 *
 * It asked whether the role had been granted before the user had reached the
 * screen, read "no", and spent the rest of its step budget re-asking. The
 * approval sheet for the second `open_settings` was queued invisibly and the
 * user cancelled it on return.
 *
 * Two things are wrong there and only one is prompt-shaped. Polling a device
 * state while the user is mid-way through changing it is a question with no
 * true answer yet: whatever it reads is stale the moment it reads it. So the
 * loop holds instead — no planning, no tool calls, no approval sheets — until
 * the app is back in front of the user.
 *
 * Kept out of AgentRuntime and injected because the runtime is exercised in
 * Node, where `react-native` is external and `AppState` does not exist.
 */
export interface ForegroundGate {
  isActive(): boolean;
  /**
   * Resolves once the app is in the foreground — immediately when it already
   * is. Rejects nothing: cancellation is the caller's `signal` to check.
   */
  waitUntilActive(signal?: AbortSignal): Promise<void>;
}

/** A gate that never holds, for remote runs and for Node. */
export const alwaysActive: ForegroundGate = {
  isActive: () => true,
  waitUntilActive: () => Promise.resolve(),
};

/*
 * The AppState implementation lives in `appStateForegroundGate.ts`, not here.
 * This module is imported by AgentRuntime, which is exercised in Node with
 * `react-native` marked external — a value import of `AppState` at this level
 * would drag the whole native module into a verification bundle that cannot
 * load it.
 */
