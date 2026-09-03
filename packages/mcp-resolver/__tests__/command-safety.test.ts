import path from 'node:path';

import {
  isValidArgs,
  isValidCommand,
  validateResolved,
} from '../src/commandSafety';

describe('commandSafety', () => {
  it('rejects shell metacharacters in commands', () => {
    expect(isValidCommand("sh -c 'x'")).toBe(false);
    expect(isValidCommand('npx;rm')).toBe(false);
    expect(isValidCommand('a && b')).toBe(false);
    expect(isValidCommand('$(x)')).toBe(false);
    expect(isValidCommand('`ls`')).toBe(false);
    expect(isValidCommand('x > out')).toBe(false);
  });

  it('accepts plain executable names and absolute paths', () => {
    expect(isValidCommand('node')).toBe(true);
    expect(isValidCommand('npx')).toBe(true);
    expect(isValidCommand('uv')).toBe(true);
    expect(isValidCommand('/usr/bin/python')).toBe(true);
    expect(isValidCommand('./gradlew')).toBe(true);
  });

  it('rejects traversal and relative paths without ./', () => {
    expect(isValidCommand('../evil')).toBe(false);
    expect(isValidCommand('dist/bin.js')).toBe(false);
  });

  it('rejects unsafe args but allows spaces inside a single arg', () => {
    expect(isValidArgs(['a;b'])).toBe(false);
    expect(isValidArgs(['dist/my server.js', '-y', '@org/pkg'])).toBe(true);
    expect(isValidArgs(['ok'])).toBe(true);
  });

  it('validateResolved throws on an unsafe command', () => {
    expect(() =>
      validateResolved({ command: 'sh -c rm', args: [], workingDirectory: null }),
    ).toThrow(/Invalid command/);
    expect(() =>
      validateResolved({
        command: 'node',
        args: ['dist/index.js'],
        workingDirectory: '/tmp/x',
      }),
    ).not.toThrow();
  });
});