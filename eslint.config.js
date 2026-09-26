// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/public/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // Messages arrive as untyped JSON: coercing at the boundary is deliberate.
      '@typescript-eslint/no-unnecessary-type-conversion': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
  { files: ['**/*.js'], ...tseslint.configs.disableTypeChecked },
);
