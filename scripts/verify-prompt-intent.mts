/**
 * The app must not be usable as a free inference oracle.
 *
 * MainActivity is exported and owns the creepyim:// scheme, so any installed
 * app can start the chat screen with parameters of its choosing. The screen
 * used to auto-send whatever arrived in `?prompt=`, which handed any caller
 * the local model, the user's connected accounts and their tool permissions —
 * without stealing a single weight. Borrowing the model through a public
 * intent is far cheaper than extracting it, so it is the first thing closed.
 *
 * Run: npm run verify:prompt-intent
 */
import {
  PROMPT_TOKEN_PARAM,
  isInternalPrompt,
  withInternalPromptToken,
} from '../src/agent/promptIntent.js';

let failures = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    console.log(`  ok — ${message}`);
  } else {
    console.error(`  FAIL — ${message}`);
    failures += 1;
  }
}

function tokenOf(link: string): string | undefined {
  const match = new RegExp(`[?&]${PROMPT_TOKEN_PARAM}=([^&]*)`).exec(link);
  return match?.[1];
}

console.log('in-app links auto-send:');
{
  const link = withInternalPromptToken('/chat?scenario=settings&prompt=hello');
  assert(isInternalPrompt(tokenOf(link)), 'a link this process built is trusted');
  assert(link.includes('prompt=hello'), 'the prompt survives the rewrite');
  assert(
    withInternalPromptToken('/chat').includes('?'),
    'a link with no query still gets the token',
  );
}

console.log('\neverything else is only offered:');
{
  // What an external app can actually construct.
  assert(!isInternalPrompt(undefined), 'a link with no token is not trusted');
  assert(!isInternalPrompt(''), 'an empty token is not trusted');
  assert(!isInternalPrompt('0'.repeat(32)), 'a guessed 32-hex token is not trusted');
  assert(!isInternalPrompt('true'), 'a truthy string is not trusted');
  assert(
    !isInternalPrompt(tokenOf(withInternalPromptToken('/chat')) + 'a'),
    'a token with anything appended is not trusted',
  );
  assert(
    !isInternalPrompt(tokenOf(withInternalPromptToken('/chat'))!.slice(0, -1)),
    'a truncated token is not trusted',
  );
}

console.log('\nthe token is not a constant:');
{
  /*
   * The value must not be predictable from a decompiled build. It cannot be
   * compared across processes from here, but it can be shown to be neither
   * empty nor a fixed literal, and to be long enough that guessing is not a
   * strategy.
   */
  const token = tokenOf(withInternalPromptToken('/chat'))!;
  assert(token.length === 32, `the token is 128 bits of hex (${token.length} chars)`);
  assert(/^[0-9a-f]+$/u.test(token), 'the token is hex');
  assert(new Set(token).size > 4, 'the token is not a repeated character');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nprompt intent verified.');
