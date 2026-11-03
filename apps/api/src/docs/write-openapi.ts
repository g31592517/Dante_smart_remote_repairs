/** Writes docs/openapi.json for offline use:  npm run openapi -w @dante/api */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDocument, operationCount } from './openapi.js';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../docs/openapi.json');
writeFileSync(out, JSON.stringify(buildOpenApiDocument(), null, 2) + '\n');
console.log(`Wrote ${operationCount} operations to ${out}`);
