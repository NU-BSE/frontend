import * as z from 'zod/v4';

import type { DocumentEngine, DocumentFindQuery } from '../contracts/engine';
import type { DocumentRef } from '../contracts/document-ref';
import type { DocumentSelector } from '../contracts/selectors';
import { DocumentError } from '../contracts/errors';
import { classifyDocument } from '../privacy/data-classification';
import type { ModelRuntime } from '../privacy/model-context';
import { isPromptAllowed, routeModel } from '../privacy/model-context';
import { PrivacyError } from '../privacy/privacy-errors';
import type { DocumentToolName } from './tool-names';

const sources = [
  'google_drive', 'google_sheets', 'google_docs', 'google_slides', 'local',
  'telegram', 'onedrive', 'dropbox', 'generated',
] as const;

const formats = [
  'xlsx', 'xls', 'csv', 'google_sheet', 'docx', 'google_doc', 'pdf', 'pptx',
  'google_slides', 'txt', 'md', 'html', 'json', 'image', 'unknown',
] as const;

const documentRefSchema = z.object({
  id: z.string().trim().min(1).max(500),
  source: z.enum(sources),
  sourceId: z.string().trim().min(1).max(1_000).optional(),
  name: z.string().trim().min(1).max(500),
  mimeType: z.string().trim().min(1).max(200).optional(),
  format: z.enum(formats).optional(),
  revision: z.string().trim().min(1).max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

const selectorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('spreadsheet'),
    sheet: z.string().trim().min(1).max(500).optional(),
    range: z.string().trim().min(1).max(100).optional(),
    rows: z.object({
      from: z.number().int().nonnegative().optional(),
      to: z.number().int().nonnegative().optional(),
    }).strict().optional(),
  }).strict(),
  z.object({ kind: z.literal('pages'), pages: z.array(z.number().int().positive()).min(1).max(500) }).strict(),
  z.object({ kind: z.literal('heading'), heading: z.string().trim().min(1).max(1_000) }).strict(),
  z.object({ kind: z.literal('paragraph'), paragraphId: z.string().trim().min(1).max(500) }).strict(),
  z.object({
    kind: z.literal('slides'),
    slides: z.array(z.number().int().positive()).min(1).max(500),
    shapeId: z.string().trim().min(1).max(500).optional(),
  }).strict(),
  z.object({ kind: z.literal('cursor'), cursor: z.string().min(1).max(4_000) }).strict(),
  z.object({ kind: z.literal('all') }).strict(),
]);

const patchOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set_cell'), sheet: z.string().min(1), cell: z.string().min(1), value: z.unknown() }).strict(),
  z.object({
    op: z.literal('set_range'), sheet: z.string().min(1), range: z.string().min(1),
    values: z.array(z.array(z.unknown())).min(1),
  }).strict(),
  z.object({ op: z.literal('replace_text'), targetId: z.string().min(1), text: z.string() }).strict(),
  z.object({ op: z.literal('insert_after'), targetId: z.string().min(1), content: z.unknown() }).strict(),
  z.object({ op: z.literal('delete'), targetId: z.string().min(1) }).strict(),
  z.object({ op: z.literal('add_sheet'), name: z.string().trim().min(1).max(500) }).strict(),
  z.object({ op: z.literal('rename_sheet'), from: z.string().min(1), to: z.string().min(1) }).strict(),
  z.object({
    op: z.literal('replace_slide_text'), slide: z.number().int().positive(),
    shapeId: z.string().min(1), text: z.string(),
  }).strict(),
]);

const documentPatchSchema = z.object({
  operations: z.array(patchOperationSchema).min(1).max(1_000),
  expectedRevision: z.string().min(1).max(500).optional(),
}).strict();

const approvalIdSchema = z.string().min(1).max(500).optional().describe(
  'One-time approval ID returned by the first call',
);

const outputSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('success'), data: z.unknown() }),
  z.object({ status: z.literal('approval_required'), approvalId: z.string(), preview: z.string() }),
  z.object({
    status: z.literal('error'),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);

type ToolResult = {
  isError?: boolean;
  content: { type: 'text'; text: string }[];
  structuredContent: Record<string, unknown>;
};

export interface DocumentMcpServer {
  registerTool(
    name: string,
    config: {
      description: string;
      inputSchema: z.ZodType;
      outputSchema: z.ZodType;
      annotations: {
        readOnlyHint: boolean;
        destructiveHint: boolean;
        idempotentHint: boolean;
        openWorldHint: false;
      };
    },
    handler: (input: any) => Promise<ToolResult>,
  ): unknown;
}

export interface DocumentApprovalRequest {
  toolName: Extract<DocumentToolName,
    'document.create' | 'document.update' | 'document.convert' | 'document.save'>;
  input: Readonly<Record<string, unknown>>;
}

/** The app owns user interaction; this boundary never auto-approves work. */
export interface DocumentApprovalService {
  create(request: DocumentApprovalRequest): Promise<{ approvalId: string; preview: string }>;
  consume(approvalId: string, request: DocumentApprovalRequest): Promise<void>;
}

export interface DocumentToolSet {
  readonly engine: DocumentEngine;
  readonly approvalService: DocumentApprovalService;
  /** Runtime of the model that will receive MCP results. */
  readonly modelRuntime: ModelRuntime;
}

function success(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: 'Document operation completed locally' }],
    structuredContent: { status: 'success', data },
  };
}

function failure(error: unknown): ToolResult {
  const normalized = error instanceof DocumentError || error instanceof PrivacyError
    ? { code: error.code, message: error.message }
    : error instanceof z.ZodError
      ? { code: 'INVALID_ARGUMENT', message: z.prettifyError(error) }
      : { code: 'DOCUMENT_OPERATION_FAILED', message: 'The local document operation failed' };
  return {
    isError: true,
    content: [{ type: 'text', text: normalized.message }],
    structuredContent: { status: 'error', error: normalized },
  };
}

function assertModelAccess(toolSet: DocumentToolSet, document?: DocumentRef): void {
  if (!document) {
    if (toolSet.modelRuntime !== 'local') {
      throw new PrivacyError(
        'LOCAL_MODEL_REQUIRED',
        'Document discovery requires the local model because results may contain private metadata',
      );
    }
    return;
  }

  const classification = classifyDocument(document);
  if (!isPromptAllowed(classification)) {
    throw new PrivacyError('CREDENTIAL_IN_PROMPT', 'Credential content cannot be exposed to a model');
  }
  if (routeModel(classification) === 'local' && toolSet.modelRuntime !== 'local') {
    throw new PrivacyError(
      'LOCAL_MODEL_REQUIRED',
      'This document is private and can only be handled by the local model',
    );
  }
}

function approvalRequired(approvalId: string, preview: string): ToolResult {
  return {
    content: [{ type: 'text', text: 'User confirmation required' }],
    structuredContent: { status: 'approval_required', approvalId, preview },
  };
}

function annotations(readOnly: boolean, destructive = false) {
  return {
    readOnlyHint: readOnly,
    destructiveHint: destructive,
    idempotentHint: readOnly,
    openWorldHint: false as const,
  };
}

function registerReadTool<T extends z.ZodType>(
  server: DocumentMcpServer,
  name: DocumentToolName,
  description: string,
  inputSchema: T,
  execute: (input: z.output<T>) => Promise<unknown>,
): void {
  server.registerTool(
    name,
    { description, inputSchema, outputSchema, annotations: annotations(true) },
    async (rawInput) => {
      try {
        return success(await execute(inputSchema.parse(rawInput)));
      } catch (error) {
        return failure(error);
      }
    },
  );
}

function registerMutationTool<T extends z.ZodType>(
  server: DocumentMcpServer,
  toolSet: DocumentToolSet,
  name: DocumentApprovalRequest['toolName'],
  description: string,
  baseSchema: T,
  execute: (input: any) => Promise<unknown>,
  authorize: (input: any) => void,
  destructive = false,
): void {
  const inputSchema = (baseSchema as unknown as z.ZodObject).extend({
    approvalId: approvalIdSchema,
  });
  server.registerTool(
    name,
    { description, inputSchema, outputSchema, annotations: annotations(false, destructive) },
    async (rawInput) => {
      try {
        const parsed = inputSchema.parse(rawInput) as Record<string, unknown> & { approvalId?: string };
        const { approvalId, ...input } = parsed;
        authorize(input);
        const request = { toolName: name, input } as DocumentApprovalRequest;
        if (!approvalId) {
          const pending = await toolSet.approvalService.create(request);
          return approvalRequired(pending.approvalId, pending.preview);
        }
        await toolSet.approvalService.consume(approvalId, request);
        return success(await execute(input));
      } catch (error) {
        return failure(error);
      }
    },
  );
}

/**
 * Registers the format-neutral document API on the in-process MCP server.
 * Schemas are strict, calls only reach the injected local-first engine, and
 * this layer never logs document arguments, results, or errors.
 */
export function registerDocumentTools(server: DocumentMcpServer, toolSet: DocumentToolSet): void {
  registerReadTool(server, 'document.find',
    'Find documents by local metadata without inspecting their contents',
    z.object({
      name: z.string().trim().min(1).max(500).optional(),
      source: z.enum(sources).optional(),
      format: z.enum(formats).optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }).strict(),
    (input) => {
      assertModelAccess(toolSet);
      return toolSet.engine.find(input as DocumentFindQuery);
    });

  registerReadTool(server, 'document.inspect',
    'Inspect document structure and capabilities locally; does not return full content',
    z.object({ document: documentRefSchema }).strict(),
    ({ document }) => {
      assertModelAccess(toolSet, document as DocumentRef);
      return toolSet.engine.inspect(document as DocumentRef);
    });

  registerReadTool(server, 'document.read',
    'Read a bounded document selection using on-device processing',
    z.object({ document: documentRefSchema, selector: selectorSchema.optional() }).strict(),
    ({ document, selector }) => {
      assertModelAccess(toolSet, document as DocumentRef);
      return toolSet.engine.read(
        document as DocumentRef,
        selector as DocumentSelector | undefined,
      );
    });

  registerReadTool(server, 'document.search', 'Search within one document locally',
    z.object({ document: documentRefSchema, query: z.string().trim().min(1).max(2_000) }).strict(),
    ({ document, query }) => {
      assertModelAccess(toolSet, document as DocumentRef);
      return toolSet.engine.search(document as DocumentRef, query);
    });

  registerReadTool(server, 'document.extract',
    'Extract structured data locally from a bounded document selection',
    z.object({
      document: documentRefSchema,
      schema: z.record(z.string(), z.unknown()),
      selector: selectorSchema.optional(),
    }).strict(),
    ({ document, schema, selector }) => {
      assertModelAccess(toolSet, document as DocumentRef);
      return toolSet.engine.extract(
        document as DocumentRef,
        schema,
        selector as DocumentSelector | undefined,
      );
    });

  registerMutationTool(server, toolSet, 'document.create',
    'Create a document locally after explicit user approval',
    z.object({
      name: z.string().trim().min(1).max(500),
      format: z.enum(formats).refine((format) => format !== 'unknown', 'A concrete format is required'),
      source: z.enum(sources).optional(),
      content: z.unknown().optional(),
    }).strict(),
    (input) => toolSet.engine.create(input),
    () => assertModelAccess(toolSet));

  registerMutationTool(server, toolSet, 'document.update',
    'Apply a targeted document patch locally after explicit user approval',
    z.object({ document: documentRefSchema, patch: documentPatchSchema }).strict(),
    ({ document, patch }) => toolSet.engine.update(document, patch),
    ({ document }) => assertModelAccess(toolSet, document), true);

  registerMutationTool(server, toolSet, 'document.convert',
    'Convert a document locally after explicit user approval',
    z.object({
      document: documentRefSchema,
      format: z.enum(formats).refine((format) => format !== 'unknown', 'A concrete format is required'),
    }).strict(),
    ({ document, format }) => toolSet.engine.convert(document, format),
    ({ document }) => assertModelAccess(toolSet, document));

  registerMutationTool(server, toolSet, 'document.save',
    'Persist a document through its configured source after explicit user approval',
    z.object({ document: documentRefSchema }).strict(),
    ({ document }) => toolSet.engine.save(document),
    ({ document }) => assertModelAccess(toolSet, document), true);
}
