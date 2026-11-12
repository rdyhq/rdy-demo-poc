import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createApp } from '../src/app.ts';
import { defaultAura } from '../src/aura.ts';
import { themeNames } from '../src/domain.ts';
import { newHome, normalizeHome, readHome, writeHome } from '../src/home-cards.ts';
import { contrast, toHex, toHsl } from '../src/public/contrast.js';
import { artPalette, nearestTheme, paletteCss, paletteReadable, skinPath, statusColors } from '../src/public/palette.js';
import { renderHome } from '../src/views.ts';

const id='00000000-0000-4000-8000-000000000001';
const cover='00000000-0000-4000-8000-000000000002';
const now=Date.parse('2027-07-16T17:00:00Z');
const base=readHome(newHome(id),id);
const content={...base,displayName:'NovaByte',intro:'Speedruns and bad puns',streamUrl:'https://twitch.tv/novabyte'};
const neon={base:'#12062b',second:'#2ee6f0'};
const neonAura={...defaultAura,accent:'#ff5fae',accentSource:'art' as const,palette:neon};
const view=(value:typeof content)=>String(renderHome(value,{now,asset:asset=>'/img/'+asset}));
const fieldError=(key:string)=>(error:unknown)=>Boolean((error as {fields?:Record<string,string>}).fields?.[key]);
const degrees=(color:string)=>toHsl([1,3,5].map(at=>parseInt(color.slice(at,at+2),16)/255))[0]*60;

// The pairs and minimums of RDY tb-NSFWH, as r-RKTA7 applies them to an art palette.
function assertReadable(palette:NonNullable<ReturnType<typeof artPalette>>,label:string) {
  for(const surface of [palette.page,palette.raised]) {
    for(const token of ['text','muted','accent','second'] as const) {
      assert.ok(contrast(palette[token],surface)>=4.5,`${label}: ${token} ${palette[token]} on ${surface}`);
    }
    assert.ok(contrast(palette.border,surface)>=3,`${label}: border ${palette.border} on ${surface}`);
    for(const status of Object.values(statusColors[palette.theme])) {
      assert.ok(contrast(status,palette.raised)>=4.5,`${label}: status ${status} on ${palette.raised}`);
    }
  }
  assert.ok(contrast(palette.on,palette.accent)>=4.5,`${label}: on ${palette.on} on accent ${palette.accent}`);
}

test('the nearest theme follows the lightness and the hue of the base colour',()=>{
  for(const [color,theme] of [
    ['#ffe9c9','Paper'],['#f2f2f2','Paper'],
    ['#2a0f08','Ember'],['#2b2408','Ember'],
    ['#07110c','Tide'],['#081a2b','Tide'],
    ['#12062b','Nebula'],['#2b0620','Nebula'],['#161616','Nebula'],
  ] as const) assert.equal(nearestTheme(color),theme,color);
});

test('a dark base colour gives a dark page in the hue of the base',()=>{
  const palette=artPalette({base:neon.base,second:neon.second,accent:'#ff5fae'})!;
  assert.equal(palette.scheme,'dark');
  assert.equal(palette.theme,'Nebula');
  assert.ok(Math.abs(degrees(palette.page)-degrees(neon.base))<3);
  assert.ok(contrast(palette.page,'#000000')<1.4);
  assert.equal(palette.accent,'#ff5fae');
  assert.equal(palette.second,'#2ee6f0');
  assert.equal(palette.glow,'#2ee6f0');
  assertReadable(palette,'neon');
});

test('the page keeps the lightness of the base colour inside the range of its scheme',()=>{
  const lightness=(color:string)=>toHsl([1,3,5].map(at=>parseInt(color.slice(at,at+2),16)/255))[2];
  // A near-black banner colour is the page colour itself.
  assert.equal(artPalette({base:'#07110c',second:null,accent:null})!.page,'#07110c');
  for(const [color,low,high] of [['#010302',.035,.09],['#3a0f6e',.035,.09],['#ffe9c9',.93,.965],['#ffffff',.93,.965]] as const) {
    const page=lightness(artPalette({base:color,second:null,accent:null})!.page);
    assert.ok(page>=low-.005&&page<=high+.005,color+' '+page);
  }
  const palette=artPalette({base:'#07110c',second:null,accent:null})!;
  assert.ok(lightness(palette.surface)>lightness(palette.page));
  assert.ok(lightness(palette.raised)>lightness(palette.surface));
});

test('a light base colour gives a light page with white text on the accent',()=>{
  const palette=artPalette({base:'#ffe9c9',second:'#5b3a5e',accent:'#e8697d'})!;
  assert.equal(palette.scheme,'light');
  assert.equal(palette.theme,'Paper');
  assert.equal(palette.on,'#ffffff');
  assert.ok(contrast(palette.page,'#ffffff')<1.25);
  // The rose of the art is too light for text on cream, so its lightness moves and its hue stays.
  assert.notEqual(palette.accent,'#e8697d');
  assert.ok(Math.abs(degrees(palette.accent)-degrees('#e8697d'))<3);
  assertReadable(palette,'cozy');
});

test('every base colour gives a readable palette',()=>{
  for(let hue=0;hue<6;hue+=.25) for(const saturation of [0,.25,.6,1]) for(const lightness of [.03,.1,.3,.5,.7,.9,.97]) {
    const color=toHex(hue,saturation,lightness);
    for(const [accent,second] of [[toHex((hue+3)%6,.9,.5),toHex((hue+1.5)%6,.9,.5)],[color,color],[null,null]]) {
      const palette=artPalette({base:color,accent,second});
      assert.ok(palette,color);
      assert.equal(palette.theme,nearestTheme(color));
      assertReadable(palette,color+' '+accent+' '+second);
    }
  }
});

test('a palette with no second colour uses the muted text colour there',()=>{
  const palette=artPalette({base:'#07110c',second:null,accent:'#39ff88'})!;
  assert.equal(palette.second,palette.muted);
  assert.equal(palette.glow,palette.accent);
});

test('a palette with no accent uses the accent of the nearest theme',()=>{
  const palette=artPalette({base:'#07110c',second:null,accent:null})!;
  assert.equal(palette.theme,'Tide');
  assert.equal(palette.accent,'#47dcc4');
});

test('a colour that is not a six-digit hex gives no palette',()=>{
  assert.equal(artPalette({base:'#12z',second:null,accent:null}),null);
  assert.equal(artPalette({base:'#12062b',second:'cyan',accent:null}),null);
  assert.equal(artPalette({base:'#12062b',second:null,accent:'#fff'}),null);
});

test('a palette with a pair below its minimum is not readable',()=>{
  const palette=artPalette({base:neon.base,second:neon.second,accent:'#ff5fae'})!;
  assert.ok(paletteReadable(palette));
  assert.ok(!paletteReadable({...palette,text:palette.page}));
  assert.ok(!paletteReadable({...palette,second:palette.raised}));
  assert.ok(!paletteReadable({...palette,border:palette.page}));
  assert.ok(!paletteReadable({...palette,on:palette.accent}));
});

test('the status colours are the error and success tokens of each theme',()=>{
  const css=readFileSync(new URL('../src/public/lobby.css',import.meta.url),'utf8');
  for(const theme of themeNames) {
    const block=css.match(new RegExp('\\[data-theme='+theme+'\\] \\{([^}]+)\\}'))![1];
    const token=(name:string)=>block.match(new RegExp('--'+name+':(#[0-9A-F]{6});'))![1].toLowerCase();
    assert.deepEqual(statusColors[theme],{error:token('error'),success:token('success')});
  }
});

test('the skin stylesheet sets every colour token on the root',()=>{
  const palette=artPalette({base:'#ffe9c9',second:'#5b3a5e',accent:'#e8697d'})!;
  const css=paletteCss(palette);
  assert.match(css,/^:root\{color-scheme:light;/);
  for(const [name,token] of [['page','page'],['raised-page','raisedPage'],['surface','surface'],['raised-surface','raised'],
    ['text','text'],['muted','muted'],['accent','accent'],['on','on'],['card-edge','cardEdge'],['border','border'],
    ['glow','glow'],['second','second']] as const) {
    assert.ok(css.includes(`--${name}:${palette[token]};`),name);
  }
  assert.doesNotMatch(css,/--error|--success/);
});

test('the skin path names the three source colours',()=>{
  assert.equal(skinPath({...neon},'#ff5fae'),'/assets/skin/1/12062b-2ee6f0-ff5fae.css');
  assert.equal(skinPath({base:'#07110c',second:null},null),'/assets/skin/1/07110c-0-0.css');
});

test('the server gives the skin stylesheet for valid colours only',async()=>{
  const app=createApp();
  const response=await app.request('/assets/skin/1/12062b-2ee6f0-ff5fae.css');
  assert.equal(response.status,200);
  assert.equal(response.headers.get('Content-Type'),'text/css; charset=utf-8');
  assert.equal(response.headers.get('Cache-Control'),'public, max-age=31536000, immutable');
  assert.equal(await response.text(),paletteCss(artPalette({base:neon.base,second:neon.second,accent:'#ff5fae'})!));
  assert.equal((await app.request('/assets/skin/1/07110c-0-0.css')).status,200);
  for(const path of ['/assets/skin/1/12062b-2ee6f0.css','/assets/skin/1/12062g-0-0.css','/assets/skin/2/12062b-0-0.css',
    '/assets/skin/1/12062B-0-0.css','/assets/skin/1/12062b-0-0']) {
    assert.equal((await app.request(path)).status,404,path);
  }
});

test('a draft keeps an art palette with its nearest theme',()=>{
  const saved=normalizeHome({...content,theme:'Nebula',aura:{...neonAura,palette:{base:'#12062B',second:'#2EE6F0'}}},base,now);
  assert.deepEqual(saved.aura.palette,neon);
  assert.deepEqual(readHome(writeHome(saved),id).aura.palette,neon);
  assert.deepEqual(readHome(newHome(id),id).aura.palette,null);
});

test('a draft refuses an art palette that is malformed or not on its nearest theme',()=>{
  for(const palette of [{base:'#12z',second:null},{base:neon.base},{base:neon.base,second:'cyan'},
    {...neon,page:'#000000'},'#12062b',[neon.base]]) {
    assert.throws(()=>normalizeHome({...content,theme:'Nebula',aura:{...neonAura,palette}},base,now),fieldError('aura-palette'));
  }
  assert.throws(()=>normalizeHome({...content,theme:'Ember',aura:neonAura},base,now),fieldError('aura-palette'));
});

test('the contrast guard checks an accent on the surfaces of the art palette',()=>{
  const cream={base:'#ffe9c9',second:null};
  // This yellow passes on the dark Nebula page and fails on a cream page.
  assert.ok(normalizeHome({...content,theme:'Nebula',aura:{...defaultAura,accent:'#ffd166',accentSource:'custom'}},base,now));
  assert.throws(()=>normalizeHome({...content,theme:'Paper',aura:{...defaultAura,accent:'#ffd166',accentSource:'art',palette:cream}},base,now),
    fieldError('aura-accent'));
  const rose=artPalette({base:cream.base,second:null,accent:'#e8697d'})!.accent;
  assert.equal(normalizeHome({...content,theme:'Paper',aura:{...defaultAura,accent:rose,accentSource:'art',palette:cream}},base,now).aura.accent,rose);
});

test('a theme change from an older editor leaves the art palette',()=>{
  const saved=normalizeHome({...content,theme:'Nebula',aura:neonAura},base,now);
  const {aura,...older}=saved;
  assert.deepEqual(normalizeHome({...older,theme:'Nebula'},saved,now).aura.palette,neon);
  const moved=normalizeHome({...older,theme:'Tide'},saved,now);
  assert.equal(moved.aura.palette,null);
  assert.equal(moved.theme,'Tide');
});

test('a home with an art palette links its skin stylesheet and shows the blurred banner',()=>{
  const page=view({...content,theme:'Nebula',coverId:cover,aura:neonAura});
  assert.match(page,/<link rel="stylesheet" href="\/assets\/lobby\.css[^"]*">\s*<link rel="stylesheet" href="\/assets\/skin\/1\/12062b-2ee6f0-ff5fae\.css">/);
  assert.match(page,/<html lang="en" data-theme="Nebula">/);
  assert.match(page,/<meta name="color-scheme" content="dark">/);
  assert.match(page,/<article class="creator card-home" data-aura-home data-art-palette /);
  assert.match(page,/<div class="art-backdrop" aria-hidden="true"><img src="\/img\/00000000-0000-4000-8000-000000000002" alt=""><\/div>/);
  const light=view({...content,theme:'Paper',coverId:cover,aura:{...defaultAura,palette:{base:'#ffe9c9',second:null}}});
  assert.match(light,/<meta name="color-scheme" content="light">/);
  assert.match(light,/href="\/assets\/skin\/1\/ffe9c9-0-0\.css"/);
});

test('the blurred banner needs a cover and an intensity above Off',()=>{
  assert.doesNotMatch(view({...content,theme:'Nebula',aura:neonAura}),/art-backdrop/);
  assert.doesNotMatch(view({...content,theme:'Nebula',coverId:cover,aura:{...neonAura,intensity:'off'}}),/art-backdrop/);
});

test('a home on a theme has no skin stylesheet and no blurred banner',()=>{
  const page=view({...content,coverId:cover});
  assert.doesNotMatch(page,/assets\/skin|art-backdrop|data-art-palette/);
});

test('the stylesheet paints labels with the second colour and keeps cards opaque',()=>{
  const css=readFileSync(new URL('../src/public/lobby.css',import.meta.url),'utf8');
  assert.match(css,/:root,\[data-theme=Nebula\] \{[^}]*--second:var\(--muted\)/);
  assert.match(css,/\[data-aura-home\] \.micro \{ color:var\(--second\); \}/);
  assert.match(css,/\[data-art-palette\] \.avatar \{[^}]*var\(--second\)/);
  assert.match(css,/\.art-backdrop \{[^}]*pointer-events:none/);
  assert.match(css,/\.art-backdrop img \{[^}]*filter:blur\(/);
  assert.doesNotMatch(css,/\[data-art-palette\] \.home-card \{[^}]*background/);
});
