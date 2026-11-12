import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/app.ts';
import { defaultAura } from '../src/aura.ts';
import { emptyHome, themeNames } from '../src/domain.ts';
import { newHome, normalizeHome, readHome, writeHome } from '../src/home-cards.ts';
import { liveState } from '../src/live-state.ts';
import { accentPalettes, accentPasses, adjustAccent, contrast } from '../src/public/contrast.js';
import { renderHome } from '../src/views.ts';

const id='00000000-0000-4000-8000-000000000001';
const now=Date.parse('2027-07-16T17:00:00Z');
const base=readHome(newHome(id),id);
const content={...base,displayName:'Mira',intro:'Late night routes',streamUrl:'https://twitch.tv/mira',
  links:[{label:'Creator archive',url:'https://example.test/archive'}],
  sessions:[{id,title:'Surface route practice',local:'2027-07-17T19:00',zone:'UTC',offset:'+00:00',instant:'2027-07-17T19:00:00Z'}]};
const view=(value=content,state?:Awaited<ReturnType<typeof liveState>>)=>String(renderHome(value,{now,asset:()=>'',liveState:state}));
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
  const css=readFileSync(new URL('../src/public/lobby.css',import.meta.url),'utf8');
  for(const theme of themeNames) {
    const block=css.match(new RegExp('\\[data-theme='+theme+'\\] \\{([^}]+)\\}'))![1];
    const tokens=Object.fromEntries(Array.from(block.matchAll(/--([a-z-]+):(#[0-9A-F]{6});/g),
      ([,name,color])=>[name,color]));
    for(const surface of ['page','surface','raised-surface']) {
      assert.ok(contrast(tokens.border,tokens[surface])>=3.2,theme+' '+surface);
      for(const key of ['text','muted','accent','error','success']) {
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

test('only a verified live state adds live cues and the fixture requires both dev flags',async()=>{
  const off={live:false,verified:false};
  for(const env of [{},{LOBBY_DEV_DIR:'/tmp/dev'},{LOBBY_DEMO:'1'},{LOBBY_DEV_DIR:'/tmp/dev',LOBBY_DEMO:'0'}]) {
    assert.deepEqual(await liveState(id,'1',env),off);
  }
  const dev={LOBBY_DEV_DIR:'/tmp/dev',LOBBY_DEMO:'1'};
  assert.deepEqual(await liveState(id,undefined,dev),off);
  assert.doesNotMatch(view(content,off),/ON AIR|data-live-surge|data-viewer-count/);
  assert.doesNotMatch(view(content,{live:true,verified:false,viewers:99}),/ON AIR|data-live-surge|data-viewer-count/);
  const fixture=await liveState(id,'1',dev);
  assert.match(view(content,fixture),/data-live-surge[^>]*>.*ON AIR.*data-viewer-count="1284".*Watch live/s);
  assert.doesNotMatch(view({...content,streamUrl:''},fixture),/ON AIR|data-live-surge/);
  const subdued=view({...content,aura:{...content.aura,liveSurge:false}},fixture);
  assert.match(subdued,/ON AIR.*Watch live/s);
  assert.doesNotMatch(subdued,/data-live-surge|class="aura-sweep"/);
  assert.equal((subdued.match(/ON AIR/g)??[]).length,1);
});

test('offline Spotlight keeps its stream destination and falls back in order',()=>{
  const render=(offlineLead:'next'|'clip'|'link',offlineLink:string|null,sessions=content.sessions)=>{
    const next={...content,sessions,layout:{...content.layout,spotlight:{...content.layout.spotlight,offlineLead,offlineLink}}};
    return view(normalizeHome(next,content,now)).split('data-card="spotlight"')[1].split('</section>')[0];
  };
  const url=content.links[0].url;
  assert.match(render('next',null),/NEXT STREAM.*Surface route practice.*href="https:\/\/twitch.tv\/mira"/s);
  assert.match(render('link',url),/FEATURED LINK.*Creator archive.*href="https:\/\/twitch.tv\/mira"/s);
  assert.match(render('link','https://example.test/removed'),/NEXT STREAM/);
  assert.match(render('clip',null),/NEXT STREAM/);
  for(const lead of ['next','link','clip'] as const) {
    assert.match(render(lead,null,[]),/SPOTLIGHT.*href="https:\/\/twitch.tv\/mira"/s);
  }
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
  assert.equal((await app.request('/assets/aura.js')).status,200);
  // Only the old editor loaded the contrast module in the browser. The editor of the fresh start has no script.
  assert.equal((await app.request('/assets/contrast.js')).status,404);
  assert.equal((await app.request('/assets/editor.js')).status,404);
});
