import { createLocalApiServer } from './local-api-server.mjs';

try {
  const app = await createLocalApiServer();
  await app.start();
} catch (error) {
  console.error('[local-api] startup failed', error);
  process.exit(1);
}
