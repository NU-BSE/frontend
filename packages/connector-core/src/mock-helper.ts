import * as z from 'zod/v4';
import type {
  ConnectionRecord,
  ConnectorId,
  ConnectorTool,
  ToolRisk,
} from './types';

/**
 * Development/test-only helpers. Production runtime code must never call
 * these: connections in production come from real auth flows and live in the
 * ConnectionStore.
 */
export function mockConn(
  connectorId: ConnectorId,
  displayName: string,
): ConnectionRecord {
  return {
    id: `${connectorId}-default`,
    connectorId,
    displayName,
    status: 'connected',
    scopes: [],
    capabilities: [`${connectorId}.read`, `${connectorId}.write`],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function t(
  name: string,
  title: string,
  description: string,
  risk: ToolRisk,
  schema: z.ZodType<any>,
  mockResult: unknown,
): ConnectorTool {
  return {
    name,
    title,
    description,
    inputSchema: schema,
    risk,
    capabilities: [],
    requiredScopes: [],
    implementationStatus: 'development_mock',
    execute: async () => mockResult,
  };
}

export const str = z.string().min(1);
export const opt = z.string().optional();
export const connId = z.object({ connectionId: str });
export const dt = z.string().datetime({ offset: true });
