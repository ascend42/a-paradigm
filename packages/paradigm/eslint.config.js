import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    // Flag console.* usage in CLI command files — use cli-output.ts helpers instead
    files: ['src/commands/**/*.ts', 'src/commands/**/*.js'],
    rules: {
      'no-console': 'warn',
    },
  },
];
