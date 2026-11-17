import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.data/**', 'docs/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // 재현 불가능한 난수를 막는다 (§17.2). 모든 랜덤은 game-engine의 SeededRng를 사용한다.
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'SeededRng(game-engine/rng)를 사용하세요.' },
      ],
      'no-restricted-globals': ['error', { name: 'eval', message: '선언형 조건만 허용합니다.' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
