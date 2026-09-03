import {
  mergeEnvironment,
} from '../src/environment';
import type { ResolvedMcp } from '../src/types';

function makeResolved(required: Array<{ name: string; required?: boolean }>): ResolvedMcp {
  return {
    command: 'node',
    args: [],
    environment: {},
    workingDirectory: null,
    requiredEnvironmentVariables: required.map((item) => ({
      name: item.name,
      required: item.required ?? true,
    })),
    runtime: 'NODE',
    confidence: 0.9,
    evidence: [],
    requiresPreparation: false,
    launchDescription: null,
  };
}

describe('environment', () => {
  it('reports missing required variables', () => {
    const resolved = makeResolved([{ name: 'GITHUB_TOKEN' }]);
    const { environment, missing } = mergeEnvironment(resolved, {}, {});

    expect(missing.map((item) => item.name)).toEqual(['GITHUB_TOKEN']);
    expect(environment).toEqual({});
  });

  it('satisfies required variables from caller values', () => {
    const resolved = makeResolved([{ name: 'GITHUB_TOKEN' }]);
    const { environment, missing } = mergeEnvironment(
      resolved,
      { GITHUB_TOKEN: 'secret' },
      { PATH: '/usr/bin' },
    );

    expect(missing).toHaveLength(0);
    expect(environment).toEqual({ PATH: '/usr/bin', GITHUB_TOKEN: 'secret' });
  });

  it('ignores optional variables when absent', () => {
    const resolved = makeResolved([{ name: 'DEBUG', required: false }]);
    const { missing } = mergeEnvironment(resolved, {}, {});

    expect(missing).toHaveLength(0);
  });

  it('drops invalid environment keys', () => {
    const resolved = makeResolved([]);
    const { environment } = mergeEnvironment(resolved, { 'bad\0key': 'x', GOOD: 'y' }, {});

    expect(environment.GOOD).toBe('y');
    expect('bad\0key' in environment).toBe(false);
  });
});