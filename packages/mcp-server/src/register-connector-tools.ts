import { McpServer } from '@modelcontextprotocol/server';

import type { ConnectorRegistry } from '@mobile-agent/connector-registry';
import type { PolicyEngine } from '@mobile-agent/policy-core';
import type { ApprovalService } from '@mobile-agent/approval-core';

export async function registerConnectorTools(
  server: McpServer,
  registry: ConnectorRegistry,
  policyEngine: PolicyEngine,
  approvalService: ApprovalService,
): Promise<void> {
  const items = await registry.listActiveTools();

  for (const { connection, tool } of items) {
    // registerTool overloads are narrow; cast the config to avoid type conflicts
    // with the generic ZodType from connector-core.
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema as any,
        outputSchema: tool.outputSchema as any,
        annotations: {
          readOnlyHint: tool.risk === 'read',
          destructiveHint: tool.risk === 'destructive',
          idempotentHint: tool.risk === 'read',
          openWorldHint: true,
        },
      } as any,
      async (input: Record<string, unknown>) => {
        const policy = await policyEngine.authorize({
          connection,
          tool,
          input,
        });

        if (!policy.allowed) {
          return {
            isError: true,
            content: [{ type: 'text', text: policy.reason ?? 'Action not allowed' }],
          };
        }

        if (policy.requiresApproval) {
          const approval = await approvalService.create({
            connection,
            tool,
            input,
          });

          return {
            content: [
              {
                type: 'text',
                text: 'User confirmation required',
              },
            ],
            structuredContent: {
              status: 'approval_required',
              approvalId: approval.id,
              preview: approval.preview,
            },
          };
        }

        const output = await tool.execute(input, {
          taskId: policy.taskId,
          agentId: policy.agentId,
          connection,
          idempotencyKey: policy.idempotencyKey,
        });

        return {
          content: [
            { type: 'text', text: JSON.stringify(output) },
          ],
          structuredContent: {
            status: 'success',
            data: output,
          },
        };
      },
    );
  }
}
