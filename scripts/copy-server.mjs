import { cpSync, copyFileSync, writeFileSync } from 'fs';

// Copy API handlers and server entry into dist/ for cloud deployment
cpSync('api', 'dist/api', { recursive: true });
copyFileSync('src-tauri/sidecar/local-api-server.mjs', 'dist/local-api-server.mjs');
copyFileSync('start-api-server.mjs', 'dist/start-api-server.mjs');

// Create minimal package.json so Node.js treats .js files as ES modules
writeFileSync('dist/package.json', JSON.stringify({ type: 'module' }, null, 2));

console.log('Server files copied to dist/');
