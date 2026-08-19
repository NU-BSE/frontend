import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import type { ConnectorRegistry } from '@mobile-agent/connector-registry';
import type { ConnectorTool } from '@mobile-agent/connector-core';
import { ConnectorError } from '@mobile-agent/connector-core';
import type { PolicyEngine } from '@mobile-agent/policy-core';
import { DEFAULT_APPROVAL_POLICY } from '@mobile-agent/policy-core';
import type { ApprovalService } from '@mobile-agent/approval-core';
import { hashArgs } from '@mobile-agent/approval-core';

const DEV_LOG = typeof __DEV__ === 'boolean' && __DEV__;

const approvalIdField = z
  .string()
  .min(1)
  .optional()
  .describe(
    'ID of an approval the user has already confirmed. Omit on the first ' +
      'call: the tool will return status "approval_required" with an ID to ' +
      'present to the user, then be called again with that ID.',
  );

/**
 * Tools whose risk class can never require approval skip the extra field, so
 * read-only tools keep a clean schema.
 */
function mayRequireApproval(risk: string): boolean {
  return DEFAULT_APPROVAL_POLICY[risk as keyof typeof DEFAULT_APPROVAL_POLICY] !== 'never';
}

/**
 * Add `approvalId` to a connector's input schema without disturbing its own
 * fields.
 *
 * `.extend` exists only on ZodObject. Connectors that compose their schema —
 * Telegram builds every tool as `connId.and(z.object({...}))`, a
 * ZodIntersection — have no `.extend`, and the previous version silently
 * returned those unchanged. The field was then absent from the published
 * schema, so zod stripped `approvalId` before the handler ever saw it: the
 * call re-entered the "needs approval" branch and issued a *fresh* approval
 * every time. Confirming one did nothing, and the tool could never execute.
 *
 * Intersecting is the shape-agnostic equivalent of extending, so both forms
 * now accept the field.
 */
function withApprovalId(schema: unknown): unknown {
  const objectSchema = schema as { extend?: (shape: Record<string, unknown>) => unknown };
  if (typeof objectSchema?.extend === 'function') {
    return objectSchema.extend({ approvalId: approvalIdField });
  }
  return z.intersection(
    schema as z.ZodType,
    z.object({ approvalId: approvalIdField }),
  );
}

/**
 * The protocol envelope every connector tool result is wrapped in:
 *
 *   { status: "success", data: <domain output> }
 *   { status: "approval_required", approvalId, preview }
 *   { status: "outcome_unknown", error }
 *
 * The MCP SDK validates `structuredContent` against the *advertised*
 * `outputSchema`, so publishing the connector's domain `outputSchema` directly
 * makes the SDK reject the envelope with "Output validation error". This
 * builder wraps the domain schema into the envelope union so the advertised
 * schema and the actual `structuredContent` agree — without changing the
 * connector-level `outputSchema`, which stays the domain contract.
 */
function createMcpOutputSchema(
  tool: ConnectorTool,
  gated: boolean,
): z.ZodType | undefined {
  const domain = tool.outputSchema;
  if (!domain) return undefined;

  const success = z.object({
    status: z.literal('success'),
    data: domain as z.ZodType,
  });

  const outcomeUnknown = z.object({
    status: z.literal('outcome_unknown'),
    error: z.string(),
  });

  if (!gated) {
    return z.discriminatedUnion('status', [success, outcomeUnknown]);
  }

  const approvalRequired = z.object({
    status: z.literal('approval_required'),
    approvalId: z.string().min(1),
    preview: z.unknown().optional(),
  });

  return z.discriminatedUnion('status', [
    success,
    approvalRequired,
    outcomeUnknown,
  ]);
}

function errorResult(message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  };
}

/**
 * Recursively key-sorted canonical JSON so two schema objects with the same
 * shape compare equal regardless of property order.
 */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = stable(record[key]);
    }
    return out;
  }
  return value;
}

/**
 * A comparable signature for a tool definition. Two connectors accidentally
 * publishing the same MCP tool name with incompatible definitions (risk,
 * schema, scopes, capabilities) must fail closed rather than silently using
 * the first-registered schema/risk.
 */
function toolSignature(tool: ConnectorTool): string {
  return JSON.stringify(
    stable({
      title: tool.title,
      description: tool.description,
      risk: tool.risk,
      capabilities: [...tool.capabilities].sort(),
      requiredScopes: [...tool.requiredScopes].sort(),
      inputSchema: z.toJSONSchema(tool.inputSchema as z.ZodType),
      ...(tool.outputSchema
        ? { outputSchema: z.toJSONSchema(tool.outputSchema as z.ZodType) }
        : {}),
    }),
  );
}

export async function registerConnectorTools(
  server: McpServer,
  registry: ConnectorRegistry,
  policyEngine: PolicyEngine,
  approvalService: ApprovalService,
): Promise<void> {
  const items = await registry.listActiveTools();

  /*
   * The registry yields one entry per (connection, tool) pair, but MCP tool
   * names are global. Entries sharing a name are grouped and registered once;
   * the handler resolves the actual connection from `input.connectionId` at
   * execution time instead of capturing one connection here. That is what
   * lets one tool name serve many accounts — Google personal and Google work
   * are both addressable, selected by the connectionId argument.
   */
  const byName = new Map<string, typeof items>();

  for (const item of items) {
    const group = byName.get(item.tool.name);
    if (group) {
      group.push(item);
    } else {
      byName.set(item.tool.name, [item]);
    }
  }

  for (const [toolName, entries] of byName) {
    // The published schema comes from the first entry; entries from the same
    // connector always agree, and cross-connector name collisions are
    // resolved at execution time below.
    const primary = entries[0].tool;

    // Fail closed on conflicting duplicate definitions: MCP groups tools
    // globally by name, so an incompatible second definition must never be
    // silently shadowed by the first.
    const signature = toolSignature(primary);
    for (const entry of entries) {
      if (toolSignature(entry.tool) !== signature) {
        throw new Error(
          `Conflicting tool definitions for "${toolName}": connectors ` +
            `${entries.map((e) => e.connection.connectorId).join(', ')} ` +
            'published incompatible schemas/risk/scopes.',
        );
      }
    }

    const gated = mayRequireApproval(primary.risk);

    // registerTool overloads are narrow; cast the config to avoid type conflicts
    // with the generic ZodType from connector-core.
    server.registerTool(
      toolName,
      {
        title: primary.title,
        description: primary.description,
        inputSchema: (gated ? withApprovalId(primary.inputSchema) : primary.inputSchema) as any,
        outputSchema: createMcpOutputSchema(primary, gated) as any,
        annotations: {
          readOnlyHint: primary.risk === 'read',
          destructiveHint: primary.risk === 'destructive',
          idempotentHint: primary.risk === 'read',
          openWorldHint: true,
        },
      } as any,
      async (rawInput: Record<string, unknown>) => {
        /*
         * `approvalId` is protocol, not connector data. It is split off before
         * anything else sees the arguments, so the policy engine, the approval
         * hash and the connector all operate on the same payload the user was
         * shown — and the hash stays stable across the two calls.
         */
        const { approvalId, ...input } = rawInput as {
          approvalId?: string;
        } & Record<string, unknown>;

        const connectionId =
          typeof input.connectionId === 'string' && input.connectionId.length > 0
            ? input.connectionId
            : null;

        if (!connectionId) {
          return errorResult(
            'connectionId is required. Use the connection discovery context ' +
              'to pick an available connection.',
          );
        }

        const resolved = await registry.getConnection(connectionId);
        if (!resolved) {
          return errorResult(
            `Connection "${connectionId}" was not found. Only use connection ` +
              'ids from the connection discovery context.',
          );
        }

        const { connection } = resolved;

        if (connection.status !== 'connected') {
          return errorResult(
            `Connection "${connection.displayName}" is ${connection.status}. ` +
              'The user must reconnect it before this tool can run.',
          );
        }

        const entry = entries.find(
          (candidate) =>
            candidate.connection.connectorId === connection.connectorId,
        );
        if (!entry) {
          return errorResult(
            `Tool ${toolName} is not provided by connector ${connection.connectorId}.`,
          );
        }

        const tool = entry.tool;

        const missingScopes = tool.requiredScopes.filter(
          (scope) => !connection.scopes.includes(scope),
        );
        if (missingScopes.length > 0) {
          return errorResult(
            `Connection "${connection.displayName}" is missing required ` +
              `scopes: ${missingScopes.join(', ')}.`,
          );
        }

        const policy = await policyEngine.authorize({ connection, tool, input });

        if (!policy.allowed) {
          return errorResult(policy.reason ?? 'Action not allowed');
        }

        if (policy.requiresApproval) {
          if (!approvalId) {
            const approval = await approvalService.create({ connection, tool, input });
            if (DEV_LOG) {
              console.log(`[approval] created id=${approval.id} tool=${tool.name}`);
            }

            return {
              content: [{ type: 'text', text: 'User confirmation required' }],
              structuredContent: {
                status: 'approval_required',
                approvalId: approval.id,
                preview: approval.preview,
              },
            };
          }

          /*
           * Redeem the approval. `consume` enforces that it exists, that the
           * user actually approved it, that it has not been spent, and that
           * these arguments hash to the ones approved — so a tampered payload
           * fails here rather than reaching the connector.
           */
          try {
            if (DEV_LOG) {
              console.log(`[approval] consuming id=${approvalId} tool=${tool.name}`);
            }
            await approvalService.consume(approvalId, hashArgs(input));
            if (DEV_LOG) {
              console.log(`[approval] consumed id=${approvalId} tool=${tool.name}`);
            }
          } catch (error) {
            return errorResult(
              error instanceof Error ? error.message : 'Approval could not be used',
            );
          }
        }

        /*
         * Connector failures become structured tool errors the model can
         * reason about ("chat not found", "authorization expired", ...) —
         * never an unhandled throw that would take down the transport, and
         * never a stack trace or secret leaked into the message.
         */
        let output: unknown;
        try {
          output = await tool.execute(input, {
            taskId: policy.taskId,
            agentId: policy.agentId,
            connection,
            idempotencyKey: policy.idempotencyKey,
          });
        } catch (error) {
          if (DEV_LOG) {
            console.error('[tool] connector execution failed', {
              tool: toolName,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          // A side effect whose outcome is unknown (e.g. provider timeout
          // after submission) must not be surfaced as a plain failure, or the
          // model would retry it and risk duplicating the physical effect.
          if (
            error instanceof ConnectorError &&
            error.code === 'OUTCOME_UNKNOWN'
          ) {
            return {
              content: [{ type: 'text', text: error.message }],
              structuredContent: {
                status: 'outcome_unknown',
                error: error.message,
              },
            };
          }
          return errorResult(
            error instanceof Error ? error.message : 'Tool execution failed',
          );
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          structuredContent: {
            status: 'success',
            data: output,
          },
        };
      },
    );
  }
}
