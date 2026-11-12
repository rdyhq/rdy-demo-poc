import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../src/app.ts';
import { defaultAura } from '../src/aura.ts';
import { connect, migrate } from '../src/db.ts';
import { newHome, readHome } from '../src/home-cards.ts';
import { renderPage } from '../src/page.ts';
import { confirmPage, landingPage, messagePage, signInPage } from '../src/screens.ts';
import { TwitchActivity } from '../src/twitch-activity.ts';

const id='00000000-0000-4000-8000-000000000001';
const now=Date.parse('2027-07-16T17:00:00Z');
const base=readHome(newHome(id),id);
const home={...base,displayName:'NovaByte',intro:'Speedruns, rhythm games and bad puns.',game:'Neon Drift 2',
  streamUrl:'https://www.twitch.tv/novabyte',avatarId:'avatar',coverId:'banner',
  links:[{label:'Twitch',url:'https://www.twitch.tv/novabyte'},{label:'YouTube',url:'https://www.youtube.com/@novabyte'},
    {label:'Glow tee, second drop',url:'https://example.test/shop'}],
  sessions:[{id,title:'Saturday speedrun block',local:'2027-07-17T19:00',zone:'America/Chicago',offset:'-05:00',instant:'2027-07-18T00:00:00Z'}],
  theme:'Nebula' as const,aura:{...defaultAura,font:'wide' as const,accent:'#ff5fae',accentSource:'art' as const,palette:{base:'#190838',second:'#2ee6f0'}}};
const page=(value:typeof home,options:Partial<Parameters<typeof renderPage>[1]>={})=>String(renderPage(value,{now,asset:asset=>'/img/'+asset,...options}));
const order=(html:string,...parts:string[])=>parts.map(part=>{
  const at=html.indexOf(part);
  assert.ok(at>=0,'missing '+part);
  return at;
}).every((at,index,all)=>index===0||at>all[index-1]);

test('a Home is one centred column in a fixed order',()=>{
  const html=page(home);
  assert.ok(order(html,'class="pg-hero"','class="pg-avatar"','class="pg-name"','class="pg-bio"','class="pg-social"',
    'class="pg-card"','class="pg-links"','class="pg-h">Schedule','class="pg-foot"'),'order');
  assert.match(html,/<h1 class="pg-name">NovaByte<\/h1>/);
  assert.match(html,/<p class="pg-bio">Speedruns, rhythm games and bad puns\.<\/p>/);
  assert.match(html,/<img class="pg-avatar" src="\/img\/avatar" alt="">/);
  // The old interface is gone from the page: no card frames, no labels above parts, no field canvas.
  assert.doesNotMatch(html,/data-frame|aura-|home-card|lobby\.css|canvas/);
  assert.match(html,/<link rel="stylesheet" href="\/assets\/page\.css\?v=[\w-]+">\s*<link rel="stylesheet" href="\/assets\/skin\/1\/190838-2ee6f0-ff5fae\.css">/);
  assert.match(html,/<main class="pg" data-font="wide">/);
});

test('a link is one pill, and a platform link also shows as a social icon',()=>{
  const html=page(home);
  const social=html.slice(html.indexOf('class="pg-social"'),html.indexOf('class="pg-card"'));
  assert.equal((social.match(/<a /g)??[]).length,2);
  assert.match(social,/<a href="https:\/\/www\.youtube\.com\/@novabyte" aria-label="YouTube"><span class="pg-icon" data-platform="youtube"><\/span><\/a>/);
  const links=html.slice(html.indexOf('class="pg-links"'),html.indexOf('class="pg-h"'));
  assert.equal((links.match(/class="pg-pill"/g)??[]).length,3);
  assert.match(links,/<a class="pg-pill" href="https:\/\/example\.test\/shop"><i aria-hidden="true">↗<\/i><span>Glow tee, second drop<\/span><\/a>/);
});

test('the live card shows a stream only while a provider verifies it',()=>{
  const live=page(home,{liveState:{live:true,verified:true,title:'Any% practice',viewers:1284}});
  assert.match(live,/<h1 class="pg-name">NovaByte <span class="pg-live">LIVE<\/span><\/h1>/);
  assert.match(live,/<p class="pg-card-title">Any% practice<\/p>/);
  assert.match(live,/1,284 watching/);
  assert.match(live,/<a class="pg-watch" href="https:\/\/www\.twitch\.tv\/novabyte">Watch on Twitch<\/a>/);
  for(const state of [undefined,{live:true,verified:false,viewers:9},{live:false,verified:true}]) {
    const quiet=page(home,{liveState:state});
    assert.doesNotMatch(quiet,/pg-live|watching/);
    // Offline, the card leads with the next stream and keeps the way to the channel.
    assert.match(quiet,/<p class="pg-card-kicker">Next stream<\/p><p class="pg-card-title">Saturday speedrun block<\/p>/);
    assert.match(quiet,/<a class="pg-watch" href="https:\/\/www\.twitch\.tv\/novabyte">Open stream on Twitch<\/a>/);
  }
});

test('a schedule change shows on the page while it is current',()=>{
  const slot=home.sessions[0];
  const notice={prior:slot,next:null,status:'Cancelled' as const};
  assert.match(page(home,{notice}),/<p class="pg-notice"><strong>Schedule change<\/strong> Saturday speedrun block: Cancelled\. Previous time: 2027-07-17 19:00 America\/Chicago \(-05:00\)\.<\/p>/);
  assert.doesNotMatch(page(home,{notice,now:Date.parse('2027-07-19T00:00:00Z')}),/pg-notice/);
  assert.doesNotMatch(page(home),/pg-notice/);
});

test('an offline card can lead with the latest clip',()=>{
  const clipHome={...home,layout:{...home.layout,spotlight:{...home.layout.spotlight,offlineLead:'clip' as const}}};
  const html=page(clipHome,{liveState:{live:false,verified:true,clip:{title:'World record pace',url:'https://clips.twitch.tv/Example',views:36}}});
  assert.match(html,/<p class="pg-card-kicker">Latest clip<\/p><p class="pg-card-title"><a href="https:\/\/clips\.twitch\.tv\/Example">World record pace<\/a><\/p><p class="pg-card-meta">36 views<\/p>/);
});

test('a custom accent on a theme reaches the page without script',async()=>{
  const themed={...home,theme:'Paper' as const,aura:{...defaultAura,accent:'#5a3cf0',accentSource:'custom' as const}};
  assert.match(page(themed),/<link rel="stylesheet" href="\/assets\/page\.css\?v=[\w-]+">\s*<link rel="stylesheet" href="\/assets\/skin\/1\/accent-5a3cf0\.css">/);
  const app=createApp();
  const styles=await app.request('/assets/skin/1/accent-5a3cf0.css');
  assert.equal(styles.status,200);
  assert.equal(await styles.text(),':root{--accent:#5a3cf0;}');
  assert.equal(styles.headers.get('Cache-Control'),'public, max-age=31536000, immutable');
  assert.equal((await app.request('/assets/skin/1/accent-5a3cfg.css')).status,404);
  assert.equal((await app.request('/assets/page.css')).status,200);
  assert.equal((await app.request('/assets/app.css')).status,200);
});

test('a part with no content does not show',()=>{
  const bare=page({...base,displayName:'Solo'});
  assert.doesNotMatch(bare,/pg-social|pg-card|pg-links|class="pg-h"|pg-bio|<img/);
  assert.match(bare,/<div class="pg-avatar pg-initials" aria-hidden="true">S<\/div>/);
  assert.match(bare,/<html lang="en" data-theme="Nebula">/);
  assert.doesNotMatch(bare,/assets\/skin/);
});

test('a preview carries the claim action and no report link',()=>{
  const preview=page(home,{claim:'novabyte'});
  assert.match(preview,/<aside class="pg-sheet">\s*<h2>That is you, NovaByte\.<\/h2>/);
  assert.match(preview,/<form method="post" action="\/auth\/twitch"><input type="hidden" name="claim" value="novabyte"><button>Claim linb\.io\/novabyte<\/button><\/form>/);
  assert.match(preview,/<a href="\/">Try another name<\/a>/);
  assert.doesNotMatch(preview,/Report this page/);
  assert.match(page(home,{report:'/h/'+id+'/report'}),/<a href="\/h\/[0-9a-f-]+\/report">Report this page<\/a>/);
  assert.doesNotMatch(page(home),/pg-sheet/);
});

test('the home page has one field for a Twitch name and one action',()=>{
  const html=String(landingPage({preview:true}));
  assert.match(html,/<form class="app-claim" method="get" action="\/preview">/);
  assert.equal((html.match(/<input /g)??[]).length,1);
  assert.match(html,/<input id="name" name="name" aria-label="Your Twitch name" required maxlength="25" pattern="\[A-Za-z0-9_\]\{3,25\}" autocapitalize="none" autocomplete="off" spellcheck="false" placeholder="yourtwitchname">/);
  assert.match(html,/<button>Show my page<\/button>/);
  assert.match(html,/No sign-up needed\./);
  assert.match(html,/<a href="\/sign-in">Sign in<\/a>/);
  assert.match(html,/href="\/assets\/app\.css\?v=[\w-]+"/);
  assert.doesNotMatch(html,/lobby\.css/);
  assert.match(String(landingPage({preview:true,missing:'nobody_here'})),/<p class="app-note" role="alert">Twitch has no channel named nobody_here\.<\/p>/);
  assert.match(String(landingPage({preview:true,limited:true})),/role="alert">Too many previews\. Try again in an hour\./);
  // Without the Twitch connection the page offers sign-in only.
  const closed=String(landingPage({preview:false}));
  assert.doesNotMatch(closed,/<form/);
  assert.match(closed,/<a class="app-primary" href="\/sign-in">Sign in<\/a>/);
});

test('the sign-in screens use the look of the app',async()=>{
  const creator=String(signInPage({twitch:true}));
  assert.match(creator,/href="\/assets\/app\.css\?v=[\w-]+"/);
  assert.doesNotMatch(creator,/lobby\.css/);
  assert.match(creator,/<h1>Sign in<\/h1>/);
  // Twitch comes first. The email link follows.
  assert.ok(creator.indexOf('<form method="post" action="/auth/twitch"><button class="app-twitch">Continue with Twitch</button></form>')
    <creator.indexOf('<form class="app-claim" method="post" action="/sign-in">'));
  assert.match(creator,/<input id="mailbox" name="mailbox" aria-label="Email address" autocomplete="email" type="email" maxlength="254" required placeholder="you@example\.com">/);
  assert.match(creator,/<button>Email me a sign-in link<\/button>/);
  assert.doesNotMatch(String(signInPage({twitch:false})),/auth\/twitch/);
  const operator=String(signInPage({operator:true,twitch:true}));
  assert.match(operator,/<h1>Operator sign-in<\/h1>/);
  assert.match(operator,/action="\/ops\/sign-in"/);
  assert.doesNotMatch(operator,/auth\/twitch/);
  const sent=String(signInPage({sent:true,twitch:true}));
  assert.match(sent,/<h1>Check your mailbox<\/h1>/);
  assert.doesNotMatch(sent,/<form/);
  assert.match(String(signInPage({twitch:true,state:'email'})),/role="alert">Twitch gave no verified email\. Verify your email at Twitch, then try again\./);
  assert.match(String(signInPage({twitch:true,state:'mailbox'})),/role="alert">Twitch knows you\. Sign in with the email of your linb\.io account to connect it\./);
  assert.doesNotMatch(String(signInPage({twitch:true,state:'mailbox'})),/auth\/twitch/);
  const confirm=String(confirmPage());
  assert.match(confirm,/<script src="\/assets\/verify\.js" defer><\/script>/);
  assert.match(confirm,/<input type="hidden" id="confirmation-token" name="token"><button id="confirm-access" disabled>Confirm access<\/button>/);
  assert.match(confirm,/<p id="confirm-status" class="app-lead">/);
  const note=String(messagePage('Proof received','Confirm the other mailbox.','/account','Return to account'));
  assert.match(note,/<h1>Proof received<\/h1><p class="app-lead">Confirm the other mailbox\.<\/p><a class="app-secondary" href="\/account">Return to account<\/a>/);
  const app=createApp({origin:'https://linb.io'});
  assert.match(await (await app.request('https://linb.io/verify')).text(),/app\.css/);
  assert.match(await (await app.request('https://linb.io/nothing/here')).text(),/app\.css/);
});

const cdn='https://static-cdn.jtvnw.net/jtv_user_pictures/';
const art=(width:number,height:number,color:string)=>sharp({create:{width,height,channels:3,background:color}})
  .composite([{input:{create:{width:Math.round(width/3),height,channels:3,background:'#ff3d9a'}},left:0,top:0}]).png().toBuffer();
function twitchStub() {
  const calls:string[]=[];
  const http=async(input:RequestInfo|URL)=>{
    const url=new URL(String(input));
    calls.push(url.pathname+url.search);
    if(url.pathname==='/oauth2/token') return Response.json({access_token:'fixture-token',expires_in:600});
    if(url.pathname==='/helix/users') {
      const login=url.searchParams.get('login'), known=login==='novabyte';
      return Response.json({data:known||url.searchParams.get('id')==='2002'?[{id:'2002',login:'novabyte',display_name:'NovaByte',
        description:'Speedruns, rhythm games and bad puns.',profile_image_url:cdn+'nova-profile_image-300x300.png',
        offline_image_url:cdn+'nova-channel_offline_image-1920x1080.png'}]:[]});
    }
    if(url.pathname==='/helix/channels') return Response.json({data:[{broadcaster_id:'2002',game_name:'Neon Drift 2'}]});
    if(url.pathname==='/helix/streams') return Response.json({data:[]});
    if(url.hostname==='static-cdn.jtvnw.net') {
      const bytes=url.pathname.includes('offline')?await art(1200,400,'#190838'):await art(300,300,'#1a0b3b');
      return new Response(Uint8Array.from(bytes),{headers:{'Content-Type':'image/png'}});
    }
    return new Response('',{status:404});
  };
  return {http:http as typeof fetch,calls};
}

test('the Twitch adapter finds a channel by its login',async()=>{
  const {http}=twitchStub();
  const activity=new TwitchActivity({clientId:'app',clientSecret:'fixture',http});
  assert.equal((await activity.profileByLogin('novabyte'))!.displayName,'NovaByte');
  assert.equal((await activity.profileByLogin('novabyte'))!.subject,'2002');
  assert.equal(await activity.profileByLogin('nobody_here'),null);
});

const database=process.env.LOBBY_TEST_DATABASE_URL;

test('a visitor sees a preview of a Twitch channel with no account',{skip:!database},async t=>{
  const admin=connect(database!);
  const schema='lobby_test_'+randomUUID().replaceAll('-','');
  await admin.query('CREATE SCHEMA '+schema);
  const scoped=new URL(database!);
  scoped.searchParams.set('options','-c search_path='+schema);
  const pool=connect(scoped.href);
  const origin='https://lobby.example.test';
  const stub=twitchStub();
  let address='203.0.113.7';
  const twitchActivity={clientId:'app',clientSecret:'fixture',http:stub.http};
  const app=createApp({pool,origin,mail:async()=>{},twitchActivity,clientAddress:()=>address,
    twitch:{clientId:'app',clientSecret:'fixture',key:Buffer.alloc(32,1),http:stub.http}});
  const get=(path:string,target=app)=>target.request(origin+path);
  try {
    await migrate(pool);
    await t.test('the home page leads to a building screen, then to the preview',async()=>{
      const landing=await get('/');
      assert.equal(landing.status,200);
      assert.match(await landing.text(),/action="\/preview"/);
      const building=await get('/preview?name=NovaByte');
      assert.equal(building.status,200);
      const waiting=await building.text();
      assert.match(waiting,/<h1>Building your page<\/h1>/);
      assert.match(waiting,/<meta http-equiv="refresh" content="0;url=\/preview\/page\?name=novabyte">/);
      assert.equal(stub.calls.length,0);
      const ready=await get('/preview/page?name=novabyte');
      assert.equal(ready.status,200);
      const html=await ready.text();
      assert.match(html,/<h1 class="pg-name">NovaByte<\/h1>/);
      assert.match(html,/Claim linb\.io\/novabyte/);
      assert.match(html,/<img class="pg-avatar" src="\/preview\/art\/novabyte\/avatar" alt="">/);
      assert.match(html,/href="\/assets\/skin\/1\/190838-/);
      assert.match(html,/<a class="pg-watch" href="https:\/\/www\.twitch\.tv\/novabyte">/);
      assert.equal(ready.headers.get('Cache-Control'),'no-store');
    });
    await t.test('the preview serves its art and stores nothing',async()=>{
      const image=await get('/preview/art/novabyte/banner');
      assert.equal(image.status,200);
      assert.equal(image.headers.get('Content-Type'),'image/webp');
      assert.equal((await get('/preview/art/novabyte/logo')).status,404);
      assert.equal((await get('/preview/art/nobody_here/avatar')).status,404);
      for(const table of ['creators','homes','drafts','assets']) {
        assert.equal((await pool.query('SELECT 1 FROM '+table)).rowCount,0,table);
      }
      // A second look at the same name asks Twitch nothing more.
      const before=stub.calls.length;
      assert.equal((await get('/preview/page?name=novabyte')).status,200);
      assert.equal(stub.calls.length,before);
    });
    await t.test('a wrong or unknown name returns to the field with a plain message',async()=>{
      for(const name of ['','ab','has space','way_too_long_for_a_twitch_login_name']) {
        const refused=await get('/preview?name='+encodeURIComponent(name));
        assert.equal(refused.status,303,name);
        assert.equal(refused.headers.get('Location'),'/?invalid=1');
      }
      const unknown=await get('/preview/page?name=nobody_here');
      assert.equal(unknown.status,303);
      assert.equal(unknown.headers.get('Location'),'/?missing=nobody_here');
      assert.match(await (await get('/?missing=nobody_here')).text(),/Twitch has no channel named nobody_here\./);
      // A value that is not a Twitch name never reaches the page.
      const odd=(await (await get('/?missing=%3Cscript%3E')).text()).toLowerCase();
      assert.ok(!odd.includes('script')&&!odd.includes('no channel named'));
    });
    await t.test('each client address gets a limited number of new previews',async()=>{
      address='198.51.100.9';
      for(let count=0;count<20;count++) assert.equal((await get('/preview/page?name=ghost_'+count)).headers.get('Location'),'/?missing=ghost_'+count);
      const limited=await get('/preview/page?name=ghost_extra');
      assert.equal(limited.status,303);
      assert.equal(limited.headers.get('Location'),'/?limited=1');
      // A waiting preview still shows, and another address is not limited.
      assert.equal((await get('/preview/page?name=novabyte')).status,200);
      address='198.51.100.10';
      assert.equal((await get('/preview/page?name=ghost_other')).headers.get('Location'),'/?missing=ghost_other');
    });
    await t.test('without the Twitch connection the home page offers sign-in only',async()=>{
      const plain=createApp({pool,origin,mail:async()=>{}});
      assert.doesNotMatch(await (await get('/',plain)).text(),/action="\/preview"/);
      assert.equal((await get('/preview?name=novabyte',plain)).headers.get('Location'),'/');
      assert.equal((await get('/preview/page?name=novabyte',plain)).headers.get('Location'),'/');
      // Without Twitch sign-in the preview shows, and nothing offers a claim.
      const noSignIn=createApp({pool,origin,mail:async()=>{},twitchActivity});
      assert.doesNotMatch(await (await get('/preview/page?name=novabyte',noSignIn)).text(),/pg-sheet/);
    });
  } finally {
    await pool.end();
    await admin.query('DROP SCHEMA '+schema+' CASCADE');
    await admin.end();
  }
});
