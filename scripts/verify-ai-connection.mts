/**
 * Verifies the custom connection against a real ChatClient.
 *
 * The risk this guards: a hand-built AG-UI event stream can be *plausible*
 * and still leave the client stuck loading or drop the assistant message.
 * Only a real ChatClient can settle that. Run: npm run verify:ai
 */
import { ChatClient } from '@tanstack/ai-client';
import type { StreamChunk, UIMessage } from '@tanstack/ai/client';

import { engineConnection } from '../src/ai/engineConnection.js';
import { createStubEngine } from '../src/ai/engines/stubEngine.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok — ${message}`);
}

function textOf(message: UIMessage): string {
  return message.parts
    .filter((p) => p.type === 'text')
    .map((p) => (p as { content: string }).content)
    .join('');
}

async function main() {
  const seen: StreamChunk[] = [];
  let failure: Error | null = null;

  const client = new ChatClient({
    connection: engineConnection(createStubEngine(), {
      systemPrompt: 'test-system-prompt',
    }),
    onChunk: (chunk) => seen.push(chunk),
    onError: (error) => {
      failure = error;
    },
  });

  await client.sendMessage('who else is reading this');

  console.log('\nassertions:');
  assert(!failure, 'no error surfaced on the client');
  assert(!client.getIsLoading(), 'loading state resolved');

  const messages = client.getMessages();
  assert(messages.length >= 2, 'user and assistant messages present');

  const assistant = messages.find((m) => m.role === 'assistant');
  assert(assistant, 'assistant message exists');

  const text = textOf(assistant!);
  assert(text.length > 0, `assistant text accumulated (${text.length} chars)`);
  assert(
    !text.includes('test-system-prompt'),
    'system prompt did not leak into the reply',
  );

  // StreamChunk's public type currently omits lifecycle event names even though
  // the connection emits and the client consumes them at runtime. Normalize to
  // strings here because this verification checks observed wire events.
  const types = seen.map((chunk) => String(chunk.type));
  assert(types.includes('RUN_STARTED'), 'RUN_STARTED emitted');
  assert(
    types.filter((type) => type === 'TEXT_MESSAGE_CONTENT').length > 1,
    'response streamed as multiple deltas, not one blob',
  );
  assert(types.includes('RUN_FINISHED'), 'RUN_FINISHED emitted');
  assert(!types.includes('RUN_ERROR'), 'no RUN_ERROR in a healthy run');

  console.log(`\nassistant said: "${text}"`);
  console.log('\nconnection verified.');
}

main().catch((err) => {
  console.error('\n', err);
  process.exit(1);
});
