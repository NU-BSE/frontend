module.exports = {
  preset: 'jest-expo',
  rootDir: '.',
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: 'coverage',
  moduleNameMapper: {
    // `pkce-challenge` ships an `exports` map without a `default` condition,
    // which jest's React Native resolver cannot match when the MCP SDK's CJS
    // build requires it. Pin it to the Node CJS build for tests.
    '^pkce-challenge$':
      '<rootDir>/../../node_modules/pkce-challenge/dist/index.node.cjs',
  },
};