import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.ts';
import { describeFailure } from '../src/failure.ts';

const now=Date.parse('2027-07-12T00:00:00Z');

test('a failure is logged with its kind and place, without its message',()=>{
  const failure=Object.assign(new Error('duplicate key value: (mailbox)=(mira@example.test)'),{code:'23505'});
  const line=describeFailure(failure);
  assert.match(line,/^Error 23505 at .*review-fixes\.test\.ts:\d+/);
  assert.doesNotMatch(line,/mira@example\.test|duplicate key/);
  assert.equal(describeFailure('a string'),'string');
  assert.equal(describeFailure(null),'null');
});

test('an unknown failure writes the redacted line to the log',async()=>{
  const lines:unknown[][]=[];
  const original=console.error;
  console.error=(...parts:unknown[])=>{ lines.push(parts); };
  let response:Response;
  try {
    const app=createApp();
    app.get('/explode/now',()=>{ throw Object.assign(new TypeError('secret detail'),{code:'E_TEST'}); });
    response=await app.request('/explode/now');
  } finally { console.error=original; }
  assert.equal(response.status,503);
  assert.equal(lines.length,1);
  const line=lines[0].join(' ');
  assert.match(line,/^LINB request failed [0-9a-f-]{36} TypeError E_TEST at /);
  assert.doesNotMatch(line,/secret detail/);
  assert.doesNotMatch(await response.text(),/secret detail|TypeError/);
});
