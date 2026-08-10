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

export async function registerConnectorTools(
  server: McpServer,
  registry: ConnectorRegistry,
  policyEngine: PolicyEngine,
  approvalService: ApprovalService,
): Promise<void> {
  const items = await registry.listActiveTools();

  /*
   * The registry yields one entry per (connection, tool) pair, but MCP tool
   * names are global — registering the same name twice throws and would take
   * the whole runtime down at startup. Today no two active connections share a
   * connector id, so this never fires; it exists so that the day a user
   * connects two Google accounts, the second one degrades to "not separately
   * addressable" instead of crashing the app on launch.
   *
   * Making both reachable is a schema change, not a guard: the handler would
   * have to resolve the connection from `connectionId` in the arguments rather
   * than capturing one here.
   */
  const registered = new Set<string>();

  for (const { connection, tool } of items) {
    if (registered.has(tool.name)) continue;
    registered.add(tool.name);

    const gated = mayRequireApproval(tool.risk);

    // registerTool overloads are narrow; cast the config to avoid type conflicts
    // with the generic ZodType from connector-core.
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: (gated ? withApprovalId(tool.inputSchema) : tool.inputSchema) as any,
        outputSchema: tool.outputSchema as any,
        annotations: {
          readOnlyHint: tool.risk === 'read',
          destructiveHint: tool.risk === 'destructive',
          idempotentHint: tool.risk === 'read',
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

        const policy = await policyEngine.authorize({ connection, tool, input });

        if (!policy.allowed) {
          return {
            isError: true,
            content: [{ type: 'text', text: policy.reason ?? 'Action not allowed' }],
          };
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
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: error instanceof Error ? error.message : 'Approval could not be used',
                },
              ],
            };
          }
        }

        const output = await tool.execute(input, {
          taskId: policy.taskId,
          agentId: policy.agentId,
          connection,
          idempotencyKey: policy.idempotencyKey,
        });

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
