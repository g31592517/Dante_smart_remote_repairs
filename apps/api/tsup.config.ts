import { defineConfig } from 'tsup';

// Bundles the API (and the workspace @dante/shared source) into dist/. npm dependencies stay external.
export default defineConfig({
  entry: { server: 'src/server.ts', 'db-cli': 'src/db/cli.ts' },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  sourcemap: true,
  clean: true,
  noExternal: ['@dante/shared'],
});
