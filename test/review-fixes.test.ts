import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.ts';
import { defaultAura } from '../src/aura.ts';
import { emptyHome } from '../src/domain.ts';
import { describeFailure } from '../src/failure.ts';
import { auraSummary, guardUnsaved } from '../src/public/editor-support.js';
import { renderHome } from '../src/views.ts';

const now=Date.parse('2027-07-12T00:00:00Z');

test('a Pro preview of an empty Pro draft renders the Home',async()=>{
  const page=String(await renderHome({...emptyHome,displayName:'Mira Vale',intro:'Cozy strategy.'},{now,asset:()=>'',preview:true,pro:{} as never}));
  assert.match(page,/Mira Vale/);
  assert.doesNotMatch(page,/Creator picks|FEATURED VIDEO/);
});

test('the compare dialog names each Aura setting',()=>{
  assert.equal(auraSummary({...defaultAura,accentSource:'custom',accent:'#5a3cf0',frame:'holo',liveSurge:false}),
    'Accent: custom #5a3cf0 · Font: grotesk · Shape: round · Frame: holo · Field: '+defaultAura.field+
    ' · Intensity: '+defaultAura.intensity+' · Live surge: off');
  assert.match(auraSummary(defaultAura),/^Accent: theme · /);
});

test('the browser asks before a page with unsaved values unloads',()=>{
  const page=new EventTarget();
  let unsaved=false;
  guardUnsaved(page,()=>unsaved);
  const leave=()=>{
    const event=new Event('beforeunload',{cancelable:true});
    page.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(leave(),false);
  unsaved=true;
  assert.equal(leave(),true);
});

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

test('the editor can load its support module',async()=>{
  const script=await createApp().request('/assets/editor-support.js');
  assert.equal(script.status,200);
  assert.match(await script.text(),/export function guardUnsaved/);
});
