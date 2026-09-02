/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'transport/**/*.ts',
    'nodes/**/*.ts',
    'credentials/**/*.ts',
    '!**/*.test.ts',
    '!**/*.d.ts',
  ],
};
