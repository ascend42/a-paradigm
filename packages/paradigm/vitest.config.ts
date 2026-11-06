import { configDefaults, defineConfig } from 'vitest/config';

const SERIAL = ['tests/hooks-timing.test.ts', 'src/commands/history/history-from-git.test.ts'];

const SHARED = {
  globals: true,
  // Scoped learning: PARADIGM_LEARNING_HOME → empty temp dir per test file.
  setupFiles: ['./vitest.setup.ts'],
};

const INCLUDE = [
  'src/**/*.test.ts',
  'tests/**/*.test.ts',
  // Warpline viewer's pure binding/state layer (React-free, node-env safe).
  'platform-ui/src/sections/warpline/**/*.test.ts',
  // Shared docs/Academy markdown renderer (React-free).
  'platform-ui/src/sections/docs/renderMarkdown.test.ts',
  // Brain section plain-language labels (React-free).
  'platform-ui/src/sections/brain/**/*.test.ts',
  // Sentinel incident triage copy and rules (React-free).
  'platform-ui/src/sections/sentinel/**/*.test.ts',
];

export default defineConfig({
  test: {
    // Wall-clock tests (hook pipe budgets) and the real-git history falsifiers
    // run in their own group, one file at a time, AFTER the parallel group, so
    // their time budgets are not starved by the rest of the suite. Projects
    // do not use `extends` (it would concatenate include arrays).
    projects: [
      { test: { ...SHARED, name: 'unit', include: INCLUDE, exclude: [...configDefaults.exclude, ...SERIAL], sequence: { groupOrder: 0 } } },
      { test: { ...SHARED, name: 'serial', include: SERIAL, fileParallelism: false, sequence: { groupOrder: 1 } } },
    ],
  },
});
