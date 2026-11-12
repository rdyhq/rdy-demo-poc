import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.ts';
import { appLink } from '../src/app-link.ts';
import { emptyHome } from '../src/domain.ts';
import { handOff, isPhone } from '../src/public/handoff.js';
import { renderPage } from '../src/page.ts';

const now=Date.parse('2027-07-12T00:00:00Z');
const home={...emptyHome,displayName:'Mira Vale',intro:'Cozy strategy.',streamUrl:'https://www.twitch.tv/MiraVale'};
const page=async(appHandoff:boolean,streamUrl=home.streamUrl)=>String(renderPage({...home,streamUrl},{now,asset:()=>'',appHandoff}));

test('a Twitch channel link has the app link that Twitch documents',()=>{
  assert.equal(appLink('https://www.twitch.tv/MiraVale'),'twitch://stream/miravale');
  assert.equal(appLink('https://twitch.tv/nexzou_99'),'twitch://stream/nexzou_99');
});

test('a link with no documented app format has no app link',()=>{
  for(const link of ['','https://www.youtube.com/@miravale','https://kick.com/miravale','https://www.twitch.tv/videos/123','https://www.twitch.tv/directory']) {
    assert.equal(appLink(link),undefined);
  }
});

test('the watch action carries the app link only when the hand-off is released',async()=>{
  const released=await page(true);
  assert.match(released,/<a class="pg-watch" href="https:\/\/www\.twitch\.tv\/MiraVale" data-app-link="twitch:\/\/stream\/miravale">/);
  assert.match(released,/<script type="module" src="\/assets\/handoff\.js"><\/script>/);
  const held=await page(false);
  assert.match(held,/<a class="pg-watch" href="https:\/\/www\.twitch\.tv\/MiraVale">/);
  assert.doesNotMatch(held,/data-app-link|handoff\.js/);
  assert.doesNotMatch(await page(true,'https://kick.com/miravale'),/data-app-link|handoff\.js/);
});

test('only a phone hands off to the app',()=>{
  assert.ok(isPhone('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 390.0'));
  assert.ok(isPhone('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36'));
  assert.ok(!isPhone('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15'));
  assert.ok(!isPhone('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36'));
});

test('the web link opens when the app does not open',()=>{
  const link={web:'https://www.twitch.tv/MiraVale',app:'twitch://stream/miravale'};
  const visit=(appOpens:boolean)=>{
    const opened:string[]=[];
    let left=false,timer=()=>{};
    handOff(link,{left:()=>left,go:(url:string)=>{ opened.push(url); if(url===link.app) left=appOpens; },
      later:(run:()=>void)=>{ timer=run; }});
    timer();
    return opened;
  };
  assert.deepEqual(visit(true),[link.app]);
  assert.deepEqual(visit(false),[link.app,link.web]);
});

test('the hand-off script is a served asset',async()=>{
  const script=await createApp().request('/assets/handoff.js');
  assert.equal(script.status,200);
  assert.match(script.headers.get('content-type')!,/^application\/javascript/);
});
