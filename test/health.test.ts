import assert from 'node:assert/strict';
import { test } from 'node:test';
import { app } from '../src/app.ts';

test('liveness returns only a non-cacheable status', async () => {
  const response = await app.request('/healthz');

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { status: 'ok' });
});
