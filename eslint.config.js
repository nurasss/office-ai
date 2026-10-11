import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/.turbo/**', 'node_modules/**'],
  },
  {
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            'Direct access to process.env is forbidden outside packages/shared/src/env.ts. Use env from @ai-company/shared instead.',
        },
      ],
    },
  },
  {
    files: ['packages/shared/src/env.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
)
