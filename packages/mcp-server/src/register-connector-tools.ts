import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import type { ConnectorRegistry } from '@mobile-agent/connector-registry';
import type { PolicyEngine } from '@mobile-agent/policy-core';
import { DEFAULT_APPROVAL_POLICY } from '@mobile-agent/policy-core';
import type { ApprovalService } from '@mobile-agent/approval-core';
import { hashArgs } from '@mobile-agent/approval-core';

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

function errorResult(message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  };
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
    const gated = mayRequireApproval(primary.risk);

    // registerTool overloads are narrow; cast the config to avoid type conflicts
    // with the generic ZodType from connector-core.
    server.registerTool(
      toolName,
      {
        title: primary.title,
        description: primary.description,
        inputSchema: (gated ? withApprovalId(primary.inputSchema) : primary.inputSchema) as any,
        outputSchema: primary.outputSchema as any,
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
            await approvalService.consume(approvalId, hashArgs(input));
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
