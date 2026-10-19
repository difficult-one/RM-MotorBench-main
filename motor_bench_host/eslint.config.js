import js from '@eslint/js';
import ts from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
export default [
  { ignores: ['dist/**','node_modules/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs['flat/essential'],
  { files: ['frontend/**/*.vue'], languageOptions: { parserOptions: { parser: ts.parser, extraFileExtensions: ['.vue'] } } },
  { languageOptions: { globals: Object.fromEntries(['process','Buffer','URL','HTMLElement','HTMLInputElement','Blob','HTMLCanvasElement','ResizeObserver','Event','devicePixelRatio','performance','structuredClone','queueMicrotask','document','console','setTimeout','clearTimeout','setInterval','clearInterval','WebSocket','Storage','location','localStorage','globalThis'].map(name => [name,'readonly'])) },
    rules: { '@typescript-eslint/no-explicit-any': 'off', 'vue/multi-word-component-names': 'off', '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
];
