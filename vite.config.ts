import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages では https://109mei.github.io/baito-kara-shacho/ で開く
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/baito-kara-shacho/' : '/',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1200 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
}));
