import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleFrom } from '../src/handles.ts';

test('a handle is the verified login in lowercase',()=>{
  assert.equal(handleFrom('MiraVale'),'miravale');
  assert.equal(handleFrom('nexzou_99'),'nexzou_99');
});

test('a login that is not 3 to 25 letters, digits or underscores gives no handle',()=>{
  for(const login of ['ab','a'.repeat(26),'mira vale','mira-vale','mira.vale','míra','',null,undefined,42]) {
    assert.equal(handleFrom(login),null);
  }
});

test('a login that an application route needs gives no handle',()=>{
  for(const login of ['editor','Account','ops','sign-in','api','assets','verify','logout','healthz','demo','auth','pricing','help']) {
    assert.equal(handleFrom(login),null);
  }
});
