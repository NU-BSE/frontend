/**
 * Verifies that no tracked file is excluded by .gitignore.
 *
 * The risk this guards: EAS uploads the project through the ignore rules, not
 * through git. A file can therefore be committed, present in `git status`, and
 * type-check locally, while never reaching the builder at all. The build then
 * fails to resolve a module that resolves fine on every developer machine.
 *
 * This has bitten the repository three times — the TDLib linking, the
 * creepy-android-settings module, and src/connections/android/ — because the
 * `android/` and `ios/` rules are unanchored on purpose and match any
 * directory with those names, including ones holding real source. Each new
 * such directory has to be re-included by name in .gitignore, and nothing
 * except this check notices when one is missed. Run: npm run verify:ignored
 */
import { execFileSync } from 'node:child_process';

function git(args: string[], input?: string): string {
  return execFileSync('git', args, {
    input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function main(): void {
  const tracked = git(['ls-files', '-z']);

  /*
   * --no-index is load-bearing: without it check-ignore skips anything in the
   * index, which is every path being tested here, and the check silently
   * passes. That is the same shape of bug the check exists to catch.
   */
  let ignored: string[];
  try {
    ignored = git(
      ['check-ignore', '--stdin', '-z', '--no-index'],
      tracked,
    )
      .split('\0')
      .filter(Boolean);
  } catch (error) {
    // Exit status 1 means nothing matched, which is the healthy case.
    const status = (error as { status?: number }).status;
    if (status === 1) ignored = [];
    else throw error;
  }

  if (ignored.length > 0) {
    console.error(
      `\nFAIL: ${ignored.length} tracked file(s) are excluded by .gitignore and\n` +
        'will be missing from the build upload:\n',
    );
    for (const file of ignored) {
      const rule = git(['check-ignore', '-v', '--no-index', file]).trim();
      console.error(`  ${file}\n      matched by ${rule.split('\t')[0]}`);
    }
    console.error(
      '\nAdd a negation to .gitignore (see the android/ and ios/ block), or\n' +
        'move the source out from under the matching directory name.\n',
    );
    process.exit(1);
  }

  console.log(`  ok — no tracked file is excluded (${tracked.split('\0').filter(Boolean).length} checked)`);
  console.log('\nignored sources verified.');
}

main();
