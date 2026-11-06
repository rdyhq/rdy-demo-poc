import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createApp } from '../src/app.ts';

test('LINB identity and canonical public URL',async()=>{
  const app=createApp({origin:'https://linb.io'});
  const home=await app.request('https://linb.io/');
  assert.equal(home.status,200);
  const text=await home.text();
  assert.match(text,/<title>Link in bio for streamers · LINB<\/title>/);
  assert.match(text,/<link rel="canonical" href="https:\/\/linb.io\/"/);
  assert.match(text,/One link.*All your.*worlds/s);
  assert.match((await app.request('/assets/linb.svg')).headers.get('content-type')!,/^image\/svg\+xml/);
});

test('alternate domains forward only public reads to the fixed canonical host',async()=>{
  const app=createApp({origin:'https://linb.io',redirectOrigins:['https://l1nb.io','https://old.example']});
  const redirected=await app.request('https://l1nb.io/?token=secret&source=chat');
  assert.equal(redirected.status,308);
  assert.equal(redirected.headers.get('location'),'https://linb.io/#');
  assert.equal((await app.request('https://old.example/',{method:'HEAD'})).status,308);
  for(const url of ['https://l1nb.io/verify','https://l1nb.io/editor','https://elsewhere.example/',
    'https://l1nb.io//elsewhere.example/','https://l1nb.io/%76erify','https://l1nb.io/h/%2feditor']) {
    assert.equal((await app.request(url)).status,404);
  }
  assert.equal((await app.request('https://l1nb.io/',{method:'POST'})).status,404);
});
