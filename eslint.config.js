// ESLint v9 flat config (root: src/ — Node.js / TypeScript)
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      // 프로젝트 컨벤션
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn', // 점진 도입
      '@typescript-eslint/no-non-null-assertion': 'off', // 명시적 ! 사용 허용
    },
  },
  {
    ignores: ['dist', 'node_modules', 'client', 'supabase', 'scripts'],
  },
];
