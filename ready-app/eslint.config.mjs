import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Vendored Emscripten output from @mediapipe/tasks-vision — not ours to lint.
    'public/**',
  ]),
  {
    rules: {
      // The MediaPipe landmarker ships no usable types. It is wrapped in one
      // place (lib/vision/pose-client.ts) and typed at that boundary.
      '@typescript-eslint/no-explicit-any': 'warn',
      // A leading underscore marks a parameter that exists to document a seam
      // (see lib/integrations) or a value deliberately dropped in a destructure.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
]);

export default eslintConfig;
