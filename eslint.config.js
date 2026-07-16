import { defineConfig } from 'eslint/config';
import sektek from '@sektek/eslint-plugin';

export default defineConfig([
  { ignores: ['node_modules/', 'dist/'] },
  sektek.configs.typescript,
  {
    rules: {},
  },
]);
