import { defineConfig, mergeConfig } from 'vite';
import base from '../../../vite.config';

// Keeps Vite from watching proof files and a browser profile. node_modules stays ignored.
export default mergeConfig(base, defineConfig({
  server: { watch: { ignored: ['**/.git/**', '**/node_modules/**', '**/.cursor/**'] } },
}));
