import type { AgentMcpClient } from '@mobile-agent/mcp-client';

import { INTERNAL_TOOL_ARGUMENTS } from './internalToolFields';
import {
  AgentError,
  type AgentErrorCode,
  type AgentToolCall,
  type AgentToolResult,
  type ConnectionSummary,
} from './types';

const MAX_ERROR_CHARS = 600;

const DEV_LOG = typeof __DEV__ === 'boolean' && __DEV__;

/**
 * Maps sanitized MCP/tool error text onto the agent error model so the UI
 * (and the model) get actionable categories instead of raw strings.
 */
export function classifyToolError(message: string): AgentErrorCode {
  if (/connection "[^"]*" was not found/iu.test(message)) {
    return 'CONNECTION_NOT_FOUND';
  }
  /*
   * Before the connection-state rule, which is broader than it looks.
   *
   *   Connection "Xiaomi 2412DPC0AG" is missing required scopes:
   *   android.settings.write.
   *
   * matched `connection "…" is (?!connected)` and was reported as
   * CONNECTION_EXPIRED — a Telegram-shaped diagnosis ("sign in again") for a
   * device permission the user has simply never granted. Reconnecting would
   * have changed nothing; granting "Modify system settings" is the fix, and
   * PERMISSION_REQUIRED is the code that says so. The scope rule was already
   * here and could never fire, sitting one branch too late.
   */
  if (/missing required scopes/iu.test(message)) {
    return 'PERMISSION_REQUIRED';
  }
  if (/connection "[^"]*" is (?!connected)/iu.test(message)) {
    return 'CONNECTION_EXPIRED';
  }
  if (/approval/iu.test(message)) {
    return 'TOOL_VALIDATION_ERROR';
  }
  if (/rate ?limit|429/iu.test(message)) {
    return 'RATE_LIMITED';
  }
  if (/authoriz|auth required|not connected|sign[- ]?in/iu.test(message)) {
    return 'AUTH_REQUIRED';
  }
  return 'TOOL_EXECUTION_ERROR';
}

/**
 * Trims a long error from the middle, not the end.
 *
 * A validation error puts the fix at the end:
 *
 *   Invalid arguments for tool android.settings.open_app: target: Invalid
 *   option: expected one of "appDetails"|"appNotifications"|…
 *
 * Cutting the tail threw away the list of valid options and left the model
 * holding "target: Invalid option…(truncated)" — told it was wrong and not
 * what would be right, which is the one thing that could have produced a
 * correct retry. Keeping both ends costs nothing and preserves the answer
 * wherever the message happens to carry it.
 */
function sanitizeForModel(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length <= MAX_ERROR_CHARS) return trimmed;

  const ELLIPSIS = ' … ';
  const budget = MAX_ERROR_CHARS - ELLIPSIS.length;
  const head = Math.ceil(budget / 2);
  return (
    trimmed.slice(0, head) + ELLIPSIS + trimmed.slice(trimmed.length - (budget - head))
  );
}

/**
 * What the user would have to do about a missing scope.
 *
 * MCP reports the failure precisely and uselessly:
 *
 *   Connection "Xiaomi 2412DPC0AG" is missing required scopes:
 *   android.settings.write.
 *
 * That is true and names nothing a person can act on — the scope string
 * appears in no screen the user has ever seen. The remedy is app knowledge,
 * not protocol knowledge, so it is attached here rather than in the MCP
 * server, which serves connectors that know nothing of this app's screens.
 *
 * Only scopes with a real, nameable action belong here. A scope with no entry
 * is left to speak for itself rather than given invented advice.
 */
export interface ScopeRemedy {
  /** The `android.settings.open` screen that shows the switch. */
  screen: string;
  /** What the model should do and say. */
  advice: string;
}

export const SCOPE_REMEDIES: ReadonlyMap<string, ScopeRemedy> = new Map([
  [
    'android.settings.write',
    {
      screen: 'writeSettings',
      advice:
        'Creepy cannot change system settings until the user turns on ' +
        '"Allow modifying system settings" for it. Call ' +
        'android.settings.open with screen "writeSettings" to put that ' +
        'switch in front of them, then say in plain words that they need to ' +
        'turn it on. Do not retry the failed action until they confirm.',
    },
  ],
  [
    'android.overlay',
    {
      screen: 'overlay',
      advice:
        'Creepy cannot draw over other apps until the user turns on ' +
        '"Display over other apps" for it. Call android.settings.open with ' +
        'screen "overlay" to put that switch in front of them, then say in ' +
        'plain words that they need to turn it on. Do not retry until they ' +
        'confirm.',
    },
  ],
  [
    'android.usage.read',
    {
      screen: 'usageAccess',
      advice:
        'Creepy cannot read app usage history until the user allows "Usage ' +
        'access" for it. Call android.settings.open with screen "usageAccess" ' +
        'to put that switch in front of them, then say in plain words that ' +
        'they need to turn it on. Do not retry until they confirm.',
    },
  ],
  [
    'android.notifications.read',
    {
      screen: 'notificationListener',
      advice:
        'Creepy cannot read notifications until the user allows "Notification ' +
        'access" for it. Call android.settings.open with screen ' +
        '"notificationListener" to put that switch in front of them, then say ' +
        'in plain words that they need to turn it on. Do not retry until they ' +
        'confirm.',
    },
  ],
  [
    'android.notifications.reply',
    {
      screen: 'notificationListener',
      advice:
        'Creepy cannot reply through notifications until the user allows ' +
        '"Notification access" for it. Call android.settings.open with screen ' +
        '"notificationListener" to put that switch in front of them, then say ' +
        'in plain words that they need to turn it on. Do not retry until they ' +
        'confirm.',
    },
  ],
  [
    'android.media.read',
    {
      screen: 'notificationListener',
      advice:
        'Creepy cannot read what is playing until the user allows "Notification ' +
        'access" for it — Android exposes active media sessions only to ' +
        'notification listeners. Call android.settings.open with screen ' +
        '"notificationListener" to put that switch in front of them. Do not ' +
        'retry until they confirm.',
    },
  ],
  [
    'android.media.control',
    {
      screen: 'notificationListener',
      advice:
        'Creepy cannot control playback until the user allows "Notification ' +
        'access" for it — Android exposes media transport controls only to ' +
        'notification listeners. Call android.settings.open with screen ' +
        '"notificationListener" to put that switch in front of them. Do not ' +
        'retry until they confirm.',
    },
  ],
]);

/** Appends the remedy for whichever known scope the message names. */
function withScopeRemedy(message: string): string {
  for (const [scope, remedy] of SCOPE_REMEDIES) {
    if (message.includes(scope)) return `${message} ${remedy.advice}`;
  }
  return message;
}

interface StructuredToolContent {
  status?: string;
  approvalId?: string;
  preview?: unknown;
  data?: unknown;
  error?: string;
}

/**
 * Replaces a connectionId the model guessed with the one it can only have
 * meant.
 *
 * Every tool in a namespace is named for it — `android.assistant.open_settings`
 * — so "android" is the most available string in the prompt, and that is what
 * the local model sent. The account's actual id is `android-device`, and the
 * call came back CONNECTION_NOT_FOUND with the tool one character of copying
 * away from working.
 *
 * The id exists to choose *between* several accounts of one provider. That is
 * its entire job, and when a namespace has exactly one connected account there
 * is nothing to choose: the value is determined by the app's own state, and
 * asking a 2B to transcribe it adds a failure mode and no information. So a
 * value that matches no connection is corrected when — and only when — one
 * account serves that namespace.
 *
 * This is not the same thing as inventing a tool call. The call is the model's
 * own, well-formed and schema-validated; what is supplied is a fact the model
 * had no say in. Two or more accounts is a genuine ambiguity, and there the
 * error stands — guessing which of a user's two Google accounts to act on is
 * exactly the decision that must not be made for them.
 *
 * An absent connectionId is left absent: whether a tool takes one is the
 * schema's business, and `system.health` would reject the extra field.
 *
 * Resolution happens before execution rather than inside it, so the approval
 * sheet, the transcript the model reads back, and the call that finally runs
 * all describe the same action.
 */
export function resolveConnectionIds(
  calls: readonly AgentToolCall[],
  connections: readonly ConnectionSummary[],
): AgentToolCall[] {
  return calls.map((call) => {
    const given = call.args.connectionId;
    if (typeof given !== 'string' || given.length === 0) return call;
    if (connections.some((connection) => connection.id === given)) return call;

    const namespace = call.toolName.split('.')[0] ?? '';
    // The same match `toolsForConnections` uses: `telegram-user` serves
    // `telegram.*`.
    const serving = connections.filter(
      (connection) =>
        connection.provider === namespace ||
        connection.provider.startsWith(`${namespace}-`),
    );
    if (serving.length !== 1) return call;

    const resolved = serving[0]!.id;
    if (DEV_LOG) {
      console.log(
        `[tool] connectionId "${given}" is not a connection; using the only ` +
          `${namespace} account, "${resolved}"`,
      );
    }
    return { ...call, args: { ...call.args, connectionId: resolved } };
  });
}

/**
 * Removes protocol-only fields (`approvalId`, ...) from model-originated
 * arguments. The LLM is untrusted and must never be able to control the
 * approval state — even if it hallucinates a field, it is dropped here.
 */
export function sanitizeModelArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (INTERNAL_TOOL_ARGUMENTS.has(key)) {
      if (DEV_LOG) {
        console.log(`[approval] stripped model-supplied reserved argument: ${key}`);
      }
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * The single low-level MCP invocation: sends the exact arguments given and
 * normalizes every outcome into a structured `AgentToolResult`. Never strips
 * or injects protocol fields — callers decide what the arguments are.
 */
async function callMcpTool(
  mcp: AgentMcpClient,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<AgentToolResult> {
  if (signal?.aborted) {
    throw new AgentError('CANCELLED', 'The run was stopped');
  }

  let raw: Awaited<ReturnType<AgentMcpClient['callTool']>>;
  try {
    raw = await mcp.callTool({ name, arguments: args });
  } catch (error) {
    if (signal?.aborted) {
      throw new AgentError('CANCELLED', 'The run was stopped', error);
    }
    const message =
      error instanceof Error ? error.message : 'Tool execution failed';
    const isToolError =
      error instanceof Error && error.name === 'ToolExecutionError';
    const errorCode: AgentErrorCode = isToolError
      ? classifyToolError(message)
      : 'TOOL_EXECUTION_ERROR';
    if (DEV_LOG) {
      /*
       * The arguments too. Diagnosing "target: Invalid option" from a log that
       * named only the tool meant guessing what the model had actually sent;
       * the offending value is the whole story. Truncated, since an argument
       * can carry a whole message body.
       */
      console.error('[tool] call failed', {
        tool: name,
        errorCode,
        message,
        args: JSON.stringify(args).slice(0, 300),
      });
    }
    return {
      status: 'error',
      error: sanitizeForModel(
        errorCode === 'PERMISSION_REQUIRED' ? withScopeRemedy(message) : message,
      ),
      errorCode,
    };
  }

  if (signal?.aborted) {
    throw new AgentError('CANCELLED', 'The run was stopped');
  }

  const structured = (raw.structuredContent ?? undefined) as
    | StructuredToolContent
    | undefined;

  if (structured?.status === 'approval_required') {
    // The approval protocol requires a non-empty approvalId; without one the
    // UI has nothing to confirm. Reject the malformed response rather than
    // opening an approval sheet for an empty id.
    if (
      typeof structured.approvalId !== 'string' ||
      structured.approvalId.length === 0
    ) {
      return {
        status: 'error',
        error: 'Tool returned an invalid approval response.',
        errorCode: 'TOOL_VALIDATION_ERROR',
      };
    }
    return {
      status: 'approval_required',
      approvalId: structured.approvalId,
      approvalPreview: structured.preview,
    };
  }

  if (structured?.status === 'outcome_unknown') {
    return {
      status: 'outcome_unknown',
      error:
        typeof structured.error === 'string'
          ? structured.error
          : 'The action may have completed, but confirmation was not received.',
      errorCode: 'OUTCOME_UNKNOWN',
    };
  }

  return {
    status: 'success',
    data: structured && 'data' in structured ? structured.data : structured,
  };
}

/**
 * Executes one model-emitted tool call through MCP. This is the untrusted
 * path: any protocol-only field the model may have emitted (`approvalId`) is
 * stripped before the MCP server ever sees the arguments.
 */
export async function executeToolCall(
  mcp: AgentMcpClient,
  call: AgentToolCall,
  signal?: AbortSignal,
): Promise<AgentToolResult> {
  return callMcpTool(mcp, call.toolName, sanitizeModelArgs(call.args), signal);
}

/**
 * Re-invokes a gated tool with the trusted approval id after the user
 * confirmed. The model's original arguments are sanitized, then the real
 * `approvalId` is injected internally — the LLM never chooses it.
 */
export async function executeApprovedToolCall(
  mcp: AgentMcpClient,
  call: AgentToolCall,
  approvalId: string,
  signal?: AbortSignal,
): Promise<AgentToolResult> {
  const args = {
    ...sanitizeModelArgs(call.args),
    approvalId,
  };
  return callMcpTool(mcp, call.toolName, args, signal);
}
