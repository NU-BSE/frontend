import type {
  AgentToolResult,
} from '../types';

export type RoutingFailureKind =
  | 'planner'
  | 'infrastructure'
  | 'auth'
  | 'permission'
  | 'user'
  | 'unknown';

export function classifyRoutingFailure(
  result: AgentToolResult,
): RoutingFailureKind {
  if (result.status === 'user_denied') {
    return 'user';
  }

  if (result.status !== 'error') {
    return 'unknown';
  }

  switch (result.errorCode) {
    case 'TOOL_VALIDATION_ERROR':
    case 'CONNECTION_NOT_FOUND':
      return 'planner';

    case 'NETWORK_ERROR':
    case 'RATE_LIMITED':
    case 'TOOL_EXECUTION_ERROR':
      return 'infrastructure';

    case 'AUTH_REQUIRED':
    case 'CONNECTION_EXPIRED':
      return 'auth';

    case 'PERMISSION_REQUIRED':
      return 'permission';

    case 'USER_DENIED':
      return 'user';

    default:
      return 'unknown';
  }
}