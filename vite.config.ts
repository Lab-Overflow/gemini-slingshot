import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const rawBase = env.VITE_APP_BASE || '/';
    const normalizedBase = rawBase.startsWith('/') ? rawBase : `/${rawBase}`;
    const base = normalizedBase.endsWith('/') ? normalizedBase : `${normalizedBase}/`;

    return {
      base,
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
