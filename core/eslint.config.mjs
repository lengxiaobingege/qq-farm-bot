import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'app',
    typescript: true,
    stylistic: false,
    yaml: false,
    jsonc: false,
    markdown: false,
    formatters: false,
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
    rules: {
      'no-console': 'off',
      'no-use-before-define': 'off',
      // 以下规则与本项目现状系统性冲突，统一关闭：
      // - @ts-nocheck 用于 protobuf 生成代码/TSDK 动态结构密集区，是有意的渐进 strict 过渡
      // - ts/no-use-before-define：基础版已关，此处补齐 ts 版保持一致
      // - unused-vars 系列：项目为 CommonJS，大量 require 解构含预留/占位项，误报远多于真问题
      'ts/ban-ts-comment': 'off',
      'ts/no-use-before-define': 'off',
      'unused-imports/no-unused-vars': 'off',
      'no-unused-vars': 'off',
      'perfectionist/sort-imports': 'off',
      'ts/consistent-type-definitions': 'off',
      'ts/consistent-type-imports': 'off',
      'ts/no-explicit-any': 'off',
      'ts/no-require-imports': 'off',
      'node/prefer-global/buffer': 'off',
      'node/prefer-global/process': 'off',
      'unicorn/prefer-module': 'off',
      'unicorn/prefer-node-protocol': 'off',
    },
  },
)
