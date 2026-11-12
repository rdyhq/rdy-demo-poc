import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/app.ts';
import { defaultAura } from '../src/aura.ts';
import { emptyHome, themeNames } from '../src/domain.ts';
import { newHome, normalizeHome, readHome, writeHome } from '../src/home-cards.ts';
import { renderPage } from '../src/page.ts';
import { accentPalettes, accentPasses, adjustAccent, contrast } from '../src/public/contrast.js';

const id='00000000-0000-4000-8000-000000000001';
const now=Date.parse('2027-07-16T17:00:00Z');
const base=readHome(newHome(id),id);
const content={...base,displayName:'Mira',intro:'Late night routes',streamUrl:'https://twitch.tv/mira',
  links:[{label:'Creator archive',url:'https://example.test/archive'}],
  sessions:[{id,title:'Surface route practice',local:'2027-07-17T19:00',zone:'UTC',offset:'+00:00',instant:'2027-07-17T19:00:00Z'}]};
const view=(value:Parameters<typeof renderPage>[0])=>String(renderPage(value,{now,asset:()=>''}));
const fieldError=(key:string)=>(error:unknown)=>Boolean((error as {fields?:Record<string,string>}).fields?.[key]);

test('contrast guard checks page, raised surface, and on-accent text for all themes',()=>{
  for(const theme of themeNames) {
    const palette=accentPalettes[theme];
    assert.ok(accentPasses(palette.accent,palette),theme);
    assert.equal(adjustAccent(palette.accent,palette),palette.accent);
    const failing=theme==='Paper'?'#f6e9d9':'#161224';
    assert.ok(!accentPasses(failing,palette));
    const adjusted=adjustAccent(failing,palette);
    assert.notEqual(adjusted,failing);
    assert.ok(accentPasses(adjusted,palette),theme);
    assert.throws(()=>normalizeHome({...content,theme,aura:{...defaultAura,accent:failing,accentSource:'custom'}},base,now),
      fieldError('aura-accent'));
  }
  const impossible={page:'#202020',raised:'#252525',on:'#000000',accent:'#999999'};
  assert.equal(adjustAccent('#f4f1ec',impossible),'#f4f1ec');
  // The dark-theme direction cannot find a color readable on both white and black here.
  const conflicting={...impossible,raised:'#ffffff'};
  assert.equal(adjustAccent('#ffffff',conflicting),conflicting.accent);
  assert.equal(adjustAccent('#12z',accentPalettes.Nebula),accentPalettes.Nebula.accent);
});

test('control and text tokens meet contrast on the rendered surfaces',()=>{
  // The themes of the page keep the colours of RDY tb-6BCAQ.
  const css=readFileSync(new URL('../src/public/page.css',import.meta.url),'utf8');
  for(const theme of themeNames) {
    const block=css.match(new RegExp('\\[data-theme='+theme+'\\] \\{([^}]+)\\}'))![1];
    const tokens=Object.fromEntries(Array.from(block.matchAll(/--([a-z-]+):(#[0-9A-F]{6});/g),
      ([,name,color])=>[name,color]));
    for(const surface of ['page','surface','raised-surface']) {
      assert.ok(contrast(tokens.border,tokens[surface])>=3.2,theme+' '+surface);
      for(const key of ['text','muted','accent']) {
        assert.ok(contrast(tokens[key],tokens[surface])>=4.5,theme+' '+surface+' '+key);
      }
    }
    const palette=accentPalettes[theme];
    assert.deepEqual(palette,{
      page:tokens.page.toLowerCase(),raised:tokens['raised-surface'].toLowerCase(),
      on:tokens.on.toLowerCase(),accent:tokens.accent.toLowerCase(),
    });
  }
});

test('legacy theme names map only on read for both saved versions',()=>{
  for(const [old,theme] of [['Midnight','Nebula'],['Hearth','Ember'],['Grove','Tide']] as const) {
    for(const value of [{...emptyHome,theme:old},{...newHome(id),skin:old}]) {
      const snapshot=structuredClone(value);
      const current=readHome(value,id);
      assert.equal(current.theme,theme);
      assert.match(view(current),new RegExp('data-theme="'+theme+'"'));
      assert.deepEqual(value,snapshot);
    }
    assert.throws(()=>normalizeHome({...content,theme:old},base,now),fieldError('theme'));
  }
});

test('Aura is additive to v2 and validates every supplied setting',()=>{
  const {aura,...legacy}=newHome(id);
  assert.deepEqual(readHome(legacy,id).aura,defaultAura);
  const custom={...aura!,frame:'holo' as const};
  const {aura:ignored,...rest}=readHome({...legacy,aura:custom},id);
  const {aura:defaults,...prior}=readHome(legacy,id);
  assert.deepEqual(rest,prior);
  assert.deepEqual(ignored,custom);
  for(const [value,key] of [
    [{sound:true},'aura'], [{font:'future'},'aura-font'], [{accent:'#abc',accentSource:'custom'},'aura-accent'],
    [{accent:null,accentSource:'custom'},'aura-accent'], [{liveSurge:1},'aura-liveSurge'],
  ] as const) {
    assert.throws(()=>normalizeHome({...content,aura:value},base,now),fieldError(key));
  }
  const stored={...base,aura:custom};
  const {aura:omitted,...payload}=content;
  assert.deepEqual(normalizeHome(payload,stored,now).aura,custom);
});

test('the choice to hide the clips is stored only when the clips are off',()=>{
  assert.equal(base.layout.clipsHidden,false);
  assert.ok(!('clipsHidden' in newHome(id)));
  const off=normalizeHome({...content,layout:{...content.layout,clipsHidden:true}},base,now);
  assert.equal(off.layout.clipsHidden,true);
  assert.equal(writeHome(off).clipsHidden,true);
  assert.equal(readHome(writeHome(off),id).layout.clipsHidden,true);
  // An older editor sends no value. The choice stays.
  const {clipsHidden,...older}=off.layout;
  assert.equal(normalizeHome({...content,layout:older},off,now).layout.clipsHidden,true);
  assert.equal(normalizeHome({...content,layout:{...off.layout,clipsHidden:false}},off,now).layout.clipsHidden,false);
  assert.throws(()=>normalizeHome({...content,layout:{...content.layout,clipsHidden:'yes'}},base,now),fieldError('layout'));
});

test('Aura assets use the fixed allowlist and strict CSP',async()=>{
  const app=createApp();
  const policy=(await app.request('/')).headers.get('content-security-policy');
  assert.match(policy!,/\bfont-src 'self'/);
  assert.doesNotMatch(policy!,/unsafe-inline/);
  const font=await app.request('/assets/fonts/inter-latin.woff2');
  assert.equal(font.headers.get('content-type'),'font/woff2');
  assert.match(font.headers.get('cache-control')!,/max-age=31536000/);
  assert.equal(Buffer.from(await font.arrayBuffer()).subarray(0,4).toString(),'wOF2');
  assert.equal((await app.request('/assets/fonts/inter-OFL.txt')).status,404);
  // The old page, its stylesheet and its scripts are removed (RDY D-2TSPY).
  for(const file of ['aura.js','contrast.js','editor.js','lobby.css','card-layout.js','preview.js','player.js']) {
    assert.equal((await app.request('/assets/'+file)).status,404,file);
  }
  assert.equal((await app.request('/assets/handoff.js')).status,200);
});
