/**
 * Protocol-only fields of the MCP approval/execution handshake.
 *
 * These are internal transport state, never part of the model's contract: the
 * LLM must neither see them in tool schemas nor be able to provide them. Only
 * the deterministic app/UI layer may inject them (e.g. `approveConnectorTool`
 * -> `executeApprovedToolCall`).
 */
export const INTERNAL_TOOL_ARGUMENTS: ReadonlySet<string> = new Set([
  'approvalId',
]);
