import type { DocumentEngine } from '../contracts/engine';
import type { DocumentToolName } from './tool-names';

/**
 * Future MCP registration boundary. No tools are registered by this scaffold.
 */
export interface DocumentToolSet {
  readonly engine: DocumentEngine;
  readonly names: readonly DocumentToolName[];
}
