import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.ts';
import { matchColours, suggestSkin } from '../src/public/art-match.js';
import { accentPalettes, accentPasses } from '../src/public/contrast.js';
import { applySkin, auraSummary, chooseTheme, restoreSkin } from '../src/public/editor-support.js';
import { artPalette, guardSurfaces } from '../src/public/palette.js';
import { defaultAura } from '../src/aura.ts';
import { newHome, normalizeHome, readHome } from '../src/home-cards.ts';
import { editorPage } from '../src/views.ts';

const size=48*48;
// Paint flat areas of colour into a 48 by 48 image. The part that is left stays transparent.
function paint(areas:[string,number][]) {
  const pixels=new Uint8ClampedArray(size*4);
  let at=0;
  for(const [color,share] of areas) {
    const channels=[1,3,5].map(start=>parseInt(color.slice(start,start+2),16));
    for(let count=Math.round(share*size);count>0;count--,at++) pixels.set([...channels,255],at*4);
  }
  return pixels;
}
const night=()=>({banner:paint([['#07110c',.87],['#39ff88',.1],['#ffb020',.03]]),avatar:paint([['#0b1a12',.86],['#39ff88',.1],['#ffb020',.04]])});

test('the base colour is the most common colour of the banner',()=>{
  const banner=paint([['#190838',.5],['#3b0f6a',.3],['#ff3d9a',.2]]);
  assert.equal(matchColours({banner,avatar:paint([['#ffffff',1]])})!.base,'#190838');
});

test('the avatar gives the base colour when the page has no banner',()=>{
  assert.equal(matchColours({banner:null,avatar:paint([['#ffe1bd',.7],['#e8697d',.3]])})!.base,'#ffe1bd');
  assert.equal(matchColours({banner:null,avatar:null}),null);
  assert.equal(matchColours({banner:paint([]),avatar:null}),null);
});

test('the accent is the strongest vivid colour, not the one with the largest area',()=>{
  // The purple covers more of the art. The pink is more saturated, so it is stronger.
  const colours=matchColours({banner:paint([['#050505',.5],['#3b0f6a',.3],['#ff3d9a',.12]]),avatar:null})!;
  assert.equal(colours.accent,'#ff3d9a');
});

test('the accent stands apart from a coloured base colour',()=>{
  const purple=matchColours({banner:paint([['#3b0f6a',.6],['#5a1a9e',.25],['#ff3d9a',.1]]),avatar:null})!;
  assert.equal(purple.base,'#3b0f6a');
  assert.equal(purple.accent,'#ff3d9a');
  // A near-black base has almost no colour, so it excludes no hue.
  const black=matchColours({banner:paint([['#07110c',.8],['#39ff88',.15]]),avatar:null})!;
  assert.equal(black.accent,'#39ff88');
});

test('the second colour is the next strongest vivid colour, 45 degrees or more from the accent',()=>{
  assert.equal(matchColours(night())!.second,'#ffb020');
  // This teal is in the next hue bin, 15 degrees from the green.
  const near=matchColours({banner:paint([['#07110c',.8],['#39ff88',.12],['#2fe6c0',.05]]),avatar:null})!;
  assert.equal(near.accent,'#39ff88');
  assert.equal(near.second,null);
  // The second colour stands apart from a coloured base colour too.
  const neon=matchColours({banner:paint([['#3b0f6a',.6],['#ff3d9a',.2],['#7a2cff',.1],['#2ee6f0',.04]]),avatar:null})!;
  assert.equal(neon.second,'#2ee6f0');
});

test('a colour on less than half a percent of the art is noise',()=>{
  const speck=matchColours({banner:paint([['#07110c',.95],['#39ff88',.04],['#ffb020',.003]]),avatar:null})!;
  assert.equal(speck.accent,'#39ff88');
  assert.equal(speck.second,null);
  assert.equal(matchColours({banner:paint([['#07110c',.997],['#39ff88',.003]]),avatar:null})!.accent,null);
});

test('art with no vivid colour has no accent and no second colour',()=>{
  const grey=matchColours({banner:paint([['#101010',.6],['#e0e0e0',.4]]),avatar:null})!;
  assert.deepEqual(grey,{base:'#101010',accent:null,second:null,vividShare:0});
});

test('the vivid share counts the opaque pixels of the avatar and the banner',()=>{
  const colours=matchColours({banner:paint([['#07110c',.8],['#39ff88',.2]]),avatar:paint([['#39ff88',.5]])})!;
  // 0.2 of the banner and all of the half-painted avatar are vivid: 0.7 of 1.5 images.
  assert.ok(Math.abs(colours.vividShare-.7/1.5)<.01);
});

test('the style rule follows the lightness of the art and its share of vivid colour',()=>{
  const look=(areas:[string,number][])=>{
    const {font,shape,frame,field}=suggestSkin(matchColours({banner:paint(areas),avatar:null}),'banner')!;
    return [font,shape,frame,field].join(' ');
  };
  assert.equal(look([['#ffe1bd',.7],['#e8697d',.3]]),'grotesk round clean drift');
  assert.equal(look([['#190838',.6],['#ff3d9a',.3],['#2ee6f0',.1]]),'wide round holo stars');
  assert.equal(look([['#07110c',.86],['#39ff88',.14]]),'mono square hud grid');
  assert.equal(look([['#07110c',.85],['#39ff88',.15]]),'wide round holo stars');
  assert.equal(look([['#101010',.6],['#e0e0e0',.4]]),'grotesk round clean drift');
});

test('the suggested skin is an art palette that a draft accepts',()=>{
  const skin=suggestSkin(matchColours(night()),'banner')!;
  assert.deepEqual({theme:skin.theme,palette:skin.palette,accent:skin.accent,accentSource:skin.accentSource},
    {theme:'Tide',palette:{base:'#07110c',second:'#ffb020'},accent:'#39ff88',accentSource:'art'});
  const id='00000000-0000-4000-8000-000000000001';
  const home=readHome(newHome(id),id);
  const {theme,reasons,...aura}=skin;
  const saved=normalizeHome({...home,displayName:'Night Signal',intro:'Late-night tactical shooters.',theme,aura:{...defaultAura,...aura}},home,Date.parse('2027-07-16T17:00:00Z'));
  assert.deepEqual(saved.aura.palette,skin.palette);
  assert.equal(saved.aura.font,'mono');
});

test('the suggested accent is moved until it passes on the art palette',()=>{
  const skin=suggestSkin(matchColours({banner:paint([['#ffe1bd',.7],['#e8697d',.3]]),avatar:null}),'banner')!;
  assert.equal(skin.theme,'Paper');
  assert.equal(skin.accent,artPalette({base:'#ffe1bd',second:null,accent:'#e8697d'})!.accent);
  assert.notEqual(skin.accent,'#e8697d');
  assert.match(skin.reasons.find(reason=>reason.control==='Accent')!.reason,/Adjusted for readability/);
});

test('each suggestion carries its reason',()=>{
  const skin=suggestSkin(matchColours(night()),'banner')!;
  assert.deepEqual(skin.reasons.map(reason=>reason.control),['Page colours','Accent','Second colour','Style']);
  assert.match(skin.reasons[0].reason,/banner/);
  // The four style values share one reason, so they are one line.
  assert.equal(skin.reasons[3].value,'Mono font, Square shape, HUD frame, Grid field');
  assert.match(skin.reasons[3].reason,/dark/);
  const fromAvatar=suggestSkin(matchColours({banner:null,avatar:paint([['#101010',.6],['#e0e0e0',.4]])}),'avatar')!;
  assert.match(fromAvatar.reasons[0].reason,/avatar/);
  assert.deepEqual(fromAvatar.reasons.map(reason=>reason.control),['Page colours','Style']);
  assert.equal(fromAvatar.accent,null);
  assert.equal(fromAvatar.accentSource,'theme');
  assert.equal(suggestSkin(null,'banner'),null);
});

test('the contrast guard uses the surfaces of the art palette when the draft has one',()=>{
  const cream={base:'#ffe1bd',second:null};
  const art=artPalette({...cream,accent:null})!;
  assert.deepEqual(guardSurfaces('Paper',cream),{page:art.page,raised:art.raised,on:art.on,accent:accentPalettes.Paper.accent});
  assert.equal(guardSurfaces('Tide',null),accentPalettes.Tide);
});

test('Match my art sets the whole look, and one action restores the look from before',()=>{
  const content={theme:'Ember',aura:{...defaultAura,font:'pixel',intensity:'bold',liveSurge:false,accent:'#ffb547',accentSource:'swatch'}};
  const snapshot=structuredClone(content);
  const skin=suggestSkin(matchColours(night()),'banner')!;
  const before=applySkin(content,skin);
  // Intensity and live surge are not part of the match.
  assert.deepEqual(content,{theme:'Tide',aura:{...snapshot.aura,palette:skin.palette,accent:'#39ff88',accentSource:'art',
    font:'mono',shape:'square',frame:'hud',field:'grid'}});
  restoreSkin(content,before);
  assert.deepEqual(content,snapshot);
});

test('a theme leaves the art palette and keeps the rest of the look',()=>{
  const content={theme:'Nebula',aura:{...defaultAura}};
  applySkin(content,suggestSkin(matchColours(night()),'banner')!);
  const palette=content.aura.palette!;
  assert.equal(chooseTheme(content,'Paper',palette),true);
  assert.equal(content.theme,'Paper');
  assert.equal(content.aura.palette,null);
  assert.deepEqual([content.aura.font,content.aura.shape,content.aura.frame,content.aura.field],['mono','square','hud','grid']);
  // The bright green is not readable on Paper, so its lightness moves.
  assert.notEqual(content.aura.accent,'#39ff88');
  assert.ok(accentPasses(content.aura.accent,accentPalettes.Paper));
  chooseTheme(content,'art',palette);
  assert.equal(content.theme,'Tide');
  assert.deepEqual(content.aura.palette,palette);
  assert.ok(accentPasses(content.aura.accent,guardSurfaces('Tide',palette)));
  const plain={theme:'Ember',aura:{...defaultAura}};
  assert.equal(chooseTheme(plain,'art',null),false);
  assert.deepEqual(plain,{theme:'Ember',aura:{...defaultAura}});
});

test('the compare dialog names the page colours of an art palette',()=>{
  assert.match(auraSummary({...defaultAura,palette:{base:'#07110c',second:'#ffb020'}}),/^Page colours: My art #07110c · Accent: /);
  assert.doesNotMatch(auraSummary(defaultAura),/Page colours/);
});

test('the editor offers My art, the list of changes and the undo action',async()=>{
  const id='00000000-0000-4000-8000-000000000001';
  const page=String(editorPage({id,owner_id:id,draft_revision:0,publication_id:null,published_revision:null,
    content:readHome(newHome(id),id),held:false,hold_reason:null},'csrf',true));
  assert.match(page,/<label id="theme-art" hidden><input name="theme" type="radio" value="art">/);
  assert.match(page,/<button class="secondary" id="aura-match" type="button" aria-describedby="aura-match-help">Match my art<\/button>/);
  assert.match(page,/<ul id="aura-match-changes" hidden><\/ul>/);
  assert.match(page,/<button class="secondary" id="aura-match-undo" type="button" hidden>Undo match<\/button>/);
  const app=createApp();
  for(const script of ['art-match','art-pixels','palette','contrast','editor-support']) {
    assert.equal((await app.request('/assets/'+script+'.js')).status,200,script);
  }
  assert.equal((await app.request('/assets/art-accent.js')).status,404);
});
