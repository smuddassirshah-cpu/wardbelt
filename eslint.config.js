// Decision notes: ESLint 10 no longer ships @eslint/js, so the core rule set is listed
// explicitly rather than pulling a transitive package. eslint-plugin-preact is unmaintained
// (last release 2022), so the security floor is enforced with no-restricted-syntax selectors
// instead: no dangerouslySetInnerHTML, no innerHTML/outerHTML/insertAdjacentHTML, no eval,
// no em-dash characters in source. Do not weaken these; CLAUDE.md forbids it.
import tseslint from 'typescript-eslint';

const coreRules = {
  'no-empty': ['error', { allowEmptyCatch: false }],
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-console': 'error',
  'no-debugger': 'error',
  'no-var': 'error',
  'prefer-const': 'error',
  eqeqeq: ['error', 'always'],
  'no-unreachable': 'error',
  'no-unused-expressions': 'off',
  'no-warning-comments': ['error', { terms: ['todo', 'fixme', 'xxx'], location: 'anywhere' }],
  'no-restricted-syntax': [
    'error',
    {
      selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
      message: 'dangerouslySetInnerHTML is forbidden (PLAN.md section 7).',
    },
    {
      selector: 'Property[key.name="dangerouslySetInnerHTML"]',
      message: 'dangerouslySetInnerHTML is forbidden (PLAN.md section 7).',
    },
    {
      selector: 'MemberExpression[property.name=/^(innerHTML|outerHTML|insertAdjacentHTML)$/]',
      message: 'HTML string injection is forbidden (PLAN.md section 7).',
    },
    {
      selector: 'MemberExpression[property.name="write"][object.name="document"]',
      message: 'document.write is forbidden.',
    },
    {
      selector: 'Literal[value=/\\u2014/]',
      message: 'No em-dashes anywhere (CLAUDE.md coding standard).',
    },
    {
      selector: 'TemplateElement[value.raw=/\\u2014/]',
      message: 'No em-dashes anywhere (CLAUDE.md coding standard).',
    },
    {
      selector: 'JSXText[value=/\\u2014/]',
      message: 'No em-dashes anywhere (CLAUDE.md coding standard).',
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'dev-dist/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...coreRules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unused-expressions': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: false, allowNullish: false, allowAny: false },
      ],
    },
  },
  {
    files: ['src/sw.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: './tsconfig.sw.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: coreRules,
  },
);
