import { Hono } from 'hono';

export const app = new Hono();

app.get('/healthz', (context) => {
  context.header('Cache-Control', 'no-store');
  return context.json({ status: 'ok' });
});
