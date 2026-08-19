/**
 * Attachment pipeline tests: policy, the AgentRuntime capability gate and the
 * remote transport serialization. No device, no network — the remote model's
 * fetch is mocked so the exact POST body can be inspected.
 *
 * Run: npm run verify:attachments
 */
import { AgentRuntime } from '../src/agent/AgentRuntime.js';
import { createRemoteAgentModel } from '../src/agent/models/remoteAgentModel.js';
import type { AgentModel, AgentModelResult } from '../src/agent/types.js';
import type { ChatAttachment } from '../src/agent/types.js';
import {
  attachmentValidationError,
  classifyAttachmentKind,
  formatFileSize,
  isUnsafeAttachment,
  MAX_ATTACHMENT_SIZE_BYTES,
} from '../src/files/attachmentPolicy.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok — ${message}`);
}

function assertEq<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, `${message} (expected ${String(expected)}, got ${String(actual)})`);
}

function attachment(overrides: Partial<ChatAttachment> = {}): ChatAttachment {
  return {
    id: 'a1',
    name: 'report.pdf',
    mimeType: 'application/pdf',
    size: 2451023,
    kind: 'document',
    uri: 'file:///tmp/report.pdf',
    ...overrides,
  };
}

async function main(): Promise<void> {
  // --- policy --------------------------------------------------------------
  console.log('attachment policy classifies by MIME type:');
  {
    assertEq(classifyAttachmentKind('image/png'), 'image', 'png → image');
    assertEq(classifyAttachmentKind('application/pdf'), 'document', 'pdf → document');
    assertEq(classifyAttachmentKind('text/plain'), 'document', 'txt → document');
    assertEq(classifyAttachmentKind('audio/mpeg'), 'audio', 'audio → audio');
    assertEq(classifyAttachmentKind('video/mp4'), 'video', 'video → video');
    assertEq(classifyAttachmentKind('application/zip'), 'other', 'zip → other');
  }

  console.log('attachment policy blocks executables, allows documents:');
  {
    assert(isUnsafeAttachment('virus.exe', 'application/octet-stream'), 'exe is blocked');
    assert(isUnsafeAttachment('app.apk', 'application/vnd.android.package-archive'), 'apk is blocked');
    assert(isUnsafeAttachment('run.sh', 'text/plain'), 'shell script is blocked');
    assert(!isUnsafeAttachment('notes.txt', 'text/plain'), 'txt is allowed');
    assert(!isUnsafeAttachment('report.pdf', 'application/pdf'), 'pdf is allowed');
  }

  console.log('attachment policy enforces the size limit:');
  {
    const reason = attachmentValidationError('big.pdf', 'application/pdf', MAX_ATTACHMENT_SIZE_BYTES + 1);
    assert(reason !== null && reason.includes('larger than'), 'oversized file is rejected');
    assertEq(attachmentValidationError('ok.pdf', 'application/pdf', 1000), null, 'small file passes');
    assertEq(formatFileSize(2451023), '2.3 MB', 'formats bytes as MB');
  }

  // --- capability gate -----------------------------------------------------
  console.log('a text-only model never silently drops attachments:');
  {
    let modelRan = false;
    const textOnlyModel: AgentModel = {
      id: 'text-only',
      capabilities: { textGeneration: true, toolCalling: false, structuredOutput: false },
      async run(): Promise<AgentModelResult> {
        modelRan = true;
        return { kind: 'final', text: 'should not run' };
      },
    };

    let failed = false;
    const runtime = new AgentRuntime({
      model: textOnlyModel,
      connections: [],
      approveApproval: async () => {},
      onState: (state) => {
        if (state.type === 'failed') failed = true;
      },
    });

    await runtime.sendMessage(
      { text: 'Summarize this', attachments: [attachment()] },
      't-1',
    );

    const messages = runtime.getMessages();
    const user = messages.find((m) => m.role === 'user');
    const assistant = messages.find((m) => m.role === 'assistant');

    assertEq(modelRan, false, 'the model is never called');
    assert(user !== undefined, 'the user message is kept');
    assert(
      user?.role === 'user' && user.attachments?.length === 1,
      'the attachment is not dropped',
    );
    assert(
      assistant !== undefined && assistant.content.includes('cannot open attachments'),
      'a clear error is surfaced',
    );
    assert(failed, 'the run is marked failed');
  }

  console.log('a file-capable model receives attachments normally:');
  {
    let sawAttachments = false;
    const fileModel: AgentModel = {
      id: 'file-capable',
      capabilities: {
        textGeneration: true,
        toolCalling: true,
        structuredOutput: true,
        fileInput: true,
      },
      async run(input): Promise<AgentModelResult> {
        const last = [...input.messages].reverse().find((m) => m.role === 'user');
        sawAttachments =
          last?.role === 'user' && (last.attachments?.length ?? 0) === 1;
        return { kind: 'final', text: 'done' };
      },
    };

    const runtime = new AgentRuntime({
      model: fileModel,
      connections: [],
      approveApproval: async () => {},
    });

    await runtime.sendMessage({ text: '', attachments: [attachment()] }, 't-2');
    assert(sawAttachments, 'the model receives the attachment');
  }

  // --- remote serialization ------------------------------------------------
  console.log('remote transport sends only server-readable references:');
  {
    const bodies: unknown[] = [];
    const original = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = async (
      _url: string | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(
        JSON.stringify({
          requestedModelTier: 'fast',
          effectiveModelTier: 'fast',
          routingReason: 'requested',
          usage: null,
          result: { kind: 'final', text: 'ok' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    try {
      const model = createRemoteAgentModel({
        baseUrl: 'http://test-backend',
        getAccessToken: async () => 'token-123',
      });

      await model.run({
        runId: 'run-1',
        messages: [
          {
            id: 'msg_1',
            role: 'user',
            content: 'Summarize',
            attachments: [
              attachment({ id: 'a1', remoteId: 'file_xxx', uri: 'file:///local/a.pdf' }),
              attachment({ id: 'a2', name: 'no-upload.pdf', remoteId: undefined, uri: 'content://local/b.pdf' }),
            ],
          },
        ],
        tools: [],
        connections: [],
      });
    } finally {
      (globalThis as Record<string, unknown>).fetch = original;
    }

    const body = bodies[0] as {
      messages: Array<{ attachments?: unknown[] }>;
    };
    const sent = JSON.stringify(body);
    const userMessage = body.messages[0]!;

    assert(!sent.includes('file://'), 'no file:// URI reaches the backend');
    assert(!sent.includes('content://'), 'no content:// URI reaches the backend');
    assert(!sent.includes('uri'), 'no local uri field reaches the backend');
    assert(!sent.includes('remoteUrl'), 'no remoteUrl field reaches the backend');

    assert(
      Array.isArray(userMessage.attachments) && userMessage.attachments.length === 1,
      'only the uploaded attachment is serialized',
    );
    const a = (userMessage.attachments as Array<Record<string, unknown>>)[0]!;
    assertEq(a.id, 'file_xxx', 'the backend file id is used, not the local id');
    assertEq(a.name, 'report.pdf', 'name is preserved');
    assertEq(a.kind, 'document', 'kind is preserved');
  }

  console.log('verify:attachments — all checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
