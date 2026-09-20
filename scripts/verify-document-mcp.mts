import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';

import {
  DocumentError,
  registerDocumentTools,
  type DocumentApprovalRequest,
  type DocumentApprovalService,
  type DocumentEngine,
  type DocumentRef,
} from '@mobile-agent/content-engine';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok — ${message}`);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${key}:${stable(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

class TestApprovals implements DocumentApprovalService {
  private next = 0;
  private pending = new Map<string, string>();
  private approved = new Set<string>();

  async create(request: DocumentApprovalRequest) {
    const approvalId = `document-approval-${++this.next}`;
    this.pending.set(approvalId, stable(request));
    return { approvalId, preview: `${request.toolName} with synthetic test data` };
  }

  approve(approvalId: string): void {
    this.approved.add(approvalId);
  }

  async consume(approvalId: string, request: DocumentApprovalRequest): Promise<void> {
    if (!this.approved.has(approvalId)) throw new Error('Approval is not confirmed');
    if (this.pending.get(approvalId) !== stable(request)) throw new Error('Approval payload mismatch');
    this.pending.delete(approvalId);
    this.approved.delete(approvalId);
  }
}

async function main(): Promise<void> {
  console.log('document MCP tools:');
  const calls: string[] = [];
  const sample = { id: 'synthetic-1', source: 'local' as const, name: 'sample.md', format: 'md' as const };
  const engine: DocumentEngine = {
    async find(query) {
      calls.push(`find:${query.limit}`);
      return { documents: [sample], truncated: false };
    },
    async inspect(document) {
      calls.push(`inspect:${document.id}`);
      return {
        document,
        capabilities: {
          inspect: true, read: true, search: true, extract: true, create: true, update: true,
          preservesFormattingOnUpdate: true, tables: false, images: false, formulas: false,
          sheets: false, slides: false, targetedRead: true, streamingRead: false, localIndexing: true,
        },
        structure: { kind: 'synthetic' },
      };
    },
    async read(document, selector) {
      calls.push(`read:${document.id}:${selector?.kind ?? 'none'}`);
      return { document, chunks: [], truncated: false };
    },
    async search(document, query) {
      calls.push(`search:${document.id}:${query}`);
      return { document, hits: [] };
    },
    async extract<T>(document: DocumentRef) {
      calls.push(`extract:${document.id}`);
      return { document, value: { synthetic: true } as T };
    },
    async create(request) {
      calls.push(`create:${request.name}`);
      return { ...sample, name: request.name, format: request.format };
    },
    async update(document) {
      calls.push(`update:${document.id}`);
      return { document, validated: true };
    },
    async convert(document, format) {
      calls.push(`convert:${document.id}:${format}`);
      return { ...document, format };
    },
    async save(document) {
      calls.push(`save:${document.id}`);
      return document;
    },
  };

  const approvals = new TestApprovals();
  let modelRuntime: 'local' | 'cloud' = 'local';
  const server = new McpServer({ name: 'document-tools-test', version: '0.1.0' });
  registerDocumentTools(server, {
    engine,
    approvalService: approvals,
    get modelRuntime() { return modelRuntime; },
  });
  const client = new Client({ name: 'document-tools-test-client', version: '0.1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const tools = await client.listTools();
    const documentTools = tools.tools.filter((tool) => tool.name.startsWith('document.'));
    assert(documentTools.length === 9, 'all nine document tools register in the MCP runtime');
    assert(documentTools.filter((tool) => tool.annotations?.readOnlyHint).length === 5,
      'find/inspect/read/search/extract are marked read-only');

    const found = await client.callTool({ name: 'document.find', arguments: {} });
    assert((found.structuredContent as { status?: string })?.status === 'success',
      'read-only metadata lookup executes without approval');
    assert(calls.includes('find:20'), 'document.find applies the bounded default limit');

    await client.callTool({
      name: 'document.read',
      arguments: { document: sample, selector: { kind: 'heading', heading: 'Synthetic section' } },
    });
    assert(calls.includes('read:synthetic-1:heading'), 'targeted read routes to DocumentEngine.read');

    let invalidRejected = false;
    try {
      const invalid = await client.callTool({
        name: 'document.read',
        arguments: { document: sample, processingTarget: 'cloud' },
      });
      invalidRejected = invalid.isError === true;
    } catch {
      invalidRejected = true;
    }
    assert(invalidRejected, 'strict schemas reject undeclared cloud-processing arguments');

    const readsBeforeCloudAttempt = calls.filter((call) => call.startsWith('read:')).length;
    modelRuntime = 'cloud';
    const cloudRead = await client.callTool({
      name: 'document.read',
      arguments: { document: sample, selector: { kind: 'all' } },
    });
    assert(cloudRead.isError === true && JSON.stringify(cloudRead).includes('LOCAL_MODEL_REQUIRED'),
      'private document results are blocked from cloud models');
    assert(calls.filter((call) => call.startsWith('read:')).length === readsBeforeCloudAttempt,
      'privacy rejection happens before the document engine reads content');
    modelRuntime = 'local';

    const createArguments = { name: 'generated.md', format: 'md', source: 'generated', content: 'synthetic' };
    const pending = await client.callTool({ name: 'document.create', arguments: createArguments });
    const pendingBody = pending.structuredContent as { status?: string; approvalId?: string };
    assert(pendingBody.status === 'approval_required' && typeof pendingBody.approvalId === 'string',
      'mutations first return an approval request');
    assert(!calls.some((call) => call.startsWith('create:')), 'the engine is not called before approval');

    approvals.approve(pendingBody.approvalId);
    const created = await client.callTool({
      name: 'document.create',
      arguments: { ...createArguments, approvalId: pendingBody.approvalId },
    });
    assert((created.structuredContent as { status?: string })?.status === 'success',
      'the exact approved mutation executes once');
    assert(calls.includes('create:generated.md'), 'approved create routes to DocumentEngine.create');

    const updateArguments = {
      document: sample,
      patch: { operations: [{ op: 'replace_text', targetId: 'paragraph-1', text: 'approved text' }] },
    };
    const updatePending = await client.callTool({ name: 'document.update', arguments: updateArguments });
    const updateApproval = (updatePending.structuredContent as { approvalId?: string }).approvalId;
    assert(typeof updateApproval === 'string', 'document.update creates a payload-bound approval');
    approvals.approve(updateApproval);
    const tampered = await client.callTool({
      name: 'document.update',
      arguments: {
        ...updateArguments,
        patch: { operations: [{ op: 'delete', targetId: 'paragraph-1' }] },
        approvalId: updateApproval,
      },
    });
    assert(tampered.isError === true, 'an approval cannot authorize a different document patch');
    assert(!calls.includes('update:synthetic-1'), 'tampered approval is rejected before mutation');

    const updated = await client.callTool({
      name: 'document.update',
      arguments: { ...updateArguments, approvalId: updateApproval },
    });
    assert((updated.structuredContent as { status?: string }).status === 'success',
      'the exact approved patch reaches DocumentEngine.update');
    const replayed = await client.callTool({
      name: 'document.update',
      arguments: { ...updateArguments, approvalId: updateApproval },
    });
    assert(replayed.isError === true, 'a consumed document approval cannot be replayed');

    const privateMarker = 'PRIVATE_SYNTHETIC_MARKER';
    const privateEngine = engine as DocumentEngine & { inspect: DocumentEngine['inspect'] };
    privateEngine.inspect = async () => { throw new Error(privateMarker); };
    const normalized = await client.callTool({ name: 'document.inspect', arguments: { document: sample } });
    const serialized = JSON.stringify(normalized);
    assert(!serialized.includes(privateMarker), 'unexpected errors do not leak private document details');
    assert(serialized.includes('DOCUMENT_OPERATION_FAILED'), 'unexpected failures use a normalized code');

    privateEngine.inspect = async () => {
      throw new DocumentError('LOCATION_NOT_FOUND', 'Synthetic location was not found');
    };
    const actionable = await client.callTool({ name: 'document.inspect', arguments: { document: sample } });
    assert(JSON.stringify(actionable).includes('LOCATION_NOT_FOUND'),
      'safe document errors preserve their actionable machine code');
  } finally {
    await client.close();
    await server.close();
  }

  console.log('verify:document-mcp — all checks passed');
}

await main();
