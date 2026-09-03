// Mock of the resolver-cli JSON stdio protocol for tests.
// Reads a McpSource JSON on stdin; prints a ResolvedMcp JSON on stdout.

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  const rawMode = process.argv[process.argv.length - 1] ?? 'ok';
  const mode = ['ok', 'error', 'exit-fail', 'hang'].includes(rawMode) ? rawMode : 'ok';
  if (mode === 'hang') {
    // Never respond — used to exercise the spawn timeout. Keep the process
    // alive so it does not exit when stdin closes.
    setInterval(() => {}, 60_000);
    return;
  }
  let source = {};
  try {
    source = JSON.parse(input);
  } catch {
    // ignore
  }
  if (mode === 'error') {
    console.log(
      JSON.stringify({
        error: {
          type: 'NoDetectorMatched',
          message: 'Could not determine how to run this project.',
          hints: ['Supported runtimes: Node.js, Python, JVM.'],
        },
      }),
    );
    process.exit(1);
    return;
  }
  if (mode === 'exit-fail') {
    console.error('mock resolver crashed');
    process.exit(3);
    return;
  }
  const base = typeof source.path === 'string' ? source.path : null;
  console.log(
    JSON.stringify({
      command: 'node',
      args: ['dist/index.js'],
      environment: {},
      workingDirectory: base,
      requiredEnvironmentVariables: [{ name: 'GITHUB_TOKEN', required: true }],
      runtime: 'NODE',
      confidence: 0.9,
      evidence: ['mock evidence'],
      requiresPreparation: false,
      launchDescription: 'mock launch',
    }),
  );
});