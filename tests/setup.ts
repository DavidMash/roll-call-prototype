import { createServer } from 'vite';

// Keep Vite in the runner process so closing it does not require Windows taskkill.
export default async function setup() {
  const server = await createServer({ server: { host: '127.0.0.1', port: 5174, strictPort: true } });
  await server.listen();
  return async () => { await server.close(); };
}
