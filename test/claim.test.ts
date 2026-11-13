import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../src/app.ts';
import { connect, migrate } from '../src/db.ts';
import { digest } from '../src/domain.ts';
import { landingPage } from '../src/screens.ts';

const database=process.env.LOBBY_TEST_DATABASE_URL;
const cdn='https://static-cdn.jtvnw.net/jtv_user_pictures/';
const bands=(width:number,height:number,areas:[string,number][])=>{
  let left=0;
  const parts=areas.map(([color,share])=>{
    const part={input:{create:{width:Math.max(1,Math.round(share*width)),height,channels:3 as const,background:color}},left,top:0};
    left+=part.input.create.width;
    return part;
  });
  return sharp({create:{width,height,channels:3,background:areas[0][0]}}).composite(parts).png().toBuffer();
};

test('the home page says when sign-up is closed',()=>{
  assert.match(String(landingPage({preview:true,closed:true})),/<p class="app-fine">Sign-up is by invitation for now\.<\/p>/);
  assert.doesNotMatch(String(landingPage({preview:true})),/by invitation/);
});

test('a streamer claims a page with Twitch sign-in, sets it up and publishes it',{skip:!database},async t=>{
  const admin=connect(database!);
  const schema='lobby_test_'+randomUUID().replaceAll('-','');
  await admin.query('CREATE SCHEMA '+schema);
  const scoped=new URL(database!);
  scoped.searchParams.set('options','-c search_path='+schema);
  const pool=connect(scoped.href);
  const origin='https://lobby.example.test';
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const key={...publicKey.export({format:'jwk'}),kid:'fixture'};
  // The person at Twitch for the next sign-in. As at Twitch, the ID token carries the display name
  // and the token check carries the login.
  let who={sub:'2002',login:'novabyte',name:'NovaByte',email:'nova@example.test' as string|null,verified:true};
  // The channel of that person streams while this is set.
  let streaming=false;
  let nonce='';
  const b64=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const http=(async(input:RequestInfo|URL)=>{
    const url=new URL(String(input));
    if(url.hostname==='id.twitch.tv') {
      if(url.pathname.endsWith('/keys')) return Response.json({keys:[key]});
      if(url.pathname.endsWith('/validate')) return Response.json({client_id:'fixture',login:who.login,user_id:who.sub,expires_in:3600});
      if(url.pathname.endsWith('/token')&&!nonce) return Response.json({access_token:'app-token',expires_in:600});
      if(url.pathname.endsWith('/token')) {
        const unsigned=b64({alg:'RS256',kid:'fixture'})+'.'+b64({iss:'https://id.twitch.tv/oauth2',aud:'fixture',sub:who.sub,
          preferred_username:who.name,email:who.verified?who.email:null,email_verified:who.verified,nonce,
          iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+600});
        nonce='';
        return Response.json({id_token:unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),privateKey).toString('base64url'),access_token:'user-token'});
      }
    }
    if(url.pathname==='/helix/users') return Response.json({data:url.searchParams.get('id')===who.sub?[{id:who.sub,login:who.login,display_name:who.name,
      description:'Speedruns, rhythm games and bad puns.',profile_image_url:cdn+'a-profile_image-300x300.png',
      offline_image_url:cdn+'a-channel_offline_image-1920x1080.png'}]:[]});
    if(url.pathname==='/helix/channels') return Response.json({data:[{broadcaster_id:who.sub,game_name:'Neon Drift 2'}]});
    if(url.pathname==='/helix/streams') return Response.json({data:streaming?[{type:'live',user_id:who.sub,user_login:who.login,
      title:'Any% practice',viewer_count:27,thumbnail_url:'https://static-cdn.jtvnw.net/previews-ttv/live_user_'+who.login+'-{width}x{height}.jpg'}]:[]});
    if(url.pathname==='/helix/schedule') return url.searchParams.get('broadcaster_id')==='2002'?Response.json({data:{broadcaster_id:'2002',vacation:null,
      segments:[{id:'s1',start_time:'2099-07-21T16:00:00Z',end_time:'2099-07-21T18:00:00Z',title:'Any% practice',canceled_until:null,
        category:{id:'1',name:'Neon Drift 2'},is_recurring:true}]}}):Response.json({message:'schedule was not found'},{status:404});
    if(url.pathname==='/helix/clips') return Response.json({data:url.searchParams.get('broadcaster_id')==='2002'&&url.searchParams.get('is_featured')==='true'?[
      {id:'NovaClip-1',broadcaster_id:'2002',title:'World record pace',view_count:7263,created_at:'2026-11-01T00:00:00Z',
        thumbnail_url:'https://static-cdn.jtvnw.net/twitch-video-assets/NovaClip-1-480x272.jpg'}]:[]});
    if(url.hostname==='static-cdn.jtvnw.net') {
      const bytes=url.pathname.includes('offline')?await bands(1200,400,[['#190838',.6],['#ff3d9a',.3],['#2ee6f0',.1]])
        :await bands(300,300,[['#1a0b3b',.6],['#ff5fae',.3],['#2ee6f0',.1]]);
      return new Response(Uint8Array.from(bytes),{headers:{'Content-Type':'image/png'}});
    }
    return new Response('',{status:404});
  }) as typeof fetch;
  const mail:{to:string;text:string}[]=[];
  const images=new Map<string,Buffer>();
  const base={pool,origin,mail:async(to:string,_subject:string,text:string)=>{mail.push({to,text});},
    objects:{async write(name:string,bytes:Buffer){images.set(name,bytes);},async read(name:string){return images.get(name)!;}},
    twitch:{clientId:'fixture',clientSecret:'fixture',key:Buffer.alloc(32,1),http},twitchActivity:{clientId:'fixture',clientSecret:'fixture',http}};
  const app=createApp({...base,openSignup:true});
  const closed=createApp(base);
  const csrf=(cookie:string)=>digest('lobby:csrf:'+cookie.split('=')[1]);
  const get=(path:string,cookie='',target=app)=>target.request(origin+path,{headers:cookie?{Cookie:cookie}:{}});
  const post=(path:string,value:Record<string,string>,cookie='',target=app)=>target.request(origin+path,{method:'POST',
    headers:{Origin:origin,...(cookie?{Cookie:cookie}:{})},body:new URLSearchParams(value)});
  // The whole Twitch sign-in: the start here, the consent at Twitch (a stand-in), and the return.
  const signIn=async(target=app)=>{
    const begin=await post('/auth/twitch',{claim:who.login},'',target);
    assert.equal(begin.status,200);
    // The browser leaves for Twitch from a page. The address is in its refresh.
    const upstream=new URL((await begin.text()).match(/<meta http-equiv="refresh" content="0;url=([^"]+)">/)![1].replaceAll('&amp;','&'));
    nonce=upstream.searchParams.get('nonce')!;
    const result=await target.request(upstream.searchParams.get('redirect_uri')+'?code=example&state='+upstream.searchParams.get('state'),
      {headers:{Cookie:begin.headers.get('Set-Cookie')!.split(';')[0]}});
    return {upstream,result,session:result.headers.getSetCookie().find(value=>value.startsWith('__Host-lobby='))?.split(';')[0]??''};
  };
  const draftOf=async(email:string)=>(await pool.query(`SELECT h.id,h.draft_revision,h.publication_id,d.content FROM homes h
    JOIN creators c ON c.id=h.owner_id JOIN drafts d ON d.home_id=h.id AND d.revision=h.draft_revision WHERE c.mailbox=$1`,[email])).rows[0];
  const count=async(table:string)=>(await pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n;
  try {
    await migrate(pool);
    let nova='';

    await t.test('a new Twitch identity creates the account, its Home and its handle',async()=>{
      const {upstream,result,session}=await signIn();
      assert.equal(upstream.searchParams.get('scope'),'openid user:read:email');
      assert.deepEqual(JSON.parse(upstream.searchParams.get('claims')!),{id_token:{email:null,email_verified:null}});
      assert.equal(result.status,303);
      assert.equal(result.headers.get('Location'),'/start');
      assert.ok(session);
      nova=session;
      assert.deepEqual((await pool.query('SELECT mailbox FROM creators')).rows,[{mailbox:'nova@example.test'}]);
      assert.deepEqual((await pool.query('SELECT subject,login FROM twitch_identities')).rows,[{subject:'2002',login:'novabyte'}]);
      assert.deepEqual((await pool.query('SELECT handle,current FROM home_handles')).rows,[{handle:'novabyte',current:true}]);
      assert.equal((await draftOf('nova@example.test')).draft_revision,0);
    });

    await t.test('the sign-in leaves for Twitch from a page, not from a redirect of the form',async()=>{
      // Twitch forwards its sign-in address to other hosts. A browser blocks a form post that is redirected
      // to a host outside the form-action policy, so the form post must end on a page of linb.io.
      const begin=await post('/auth/twitch',{claim:'novabyte'});
      assert.equal(begin.status,200);
      assert.equal(begin.headers.get('Location'),null);
      assert.match(begin.headers.get('Content-Security-Policy')!,/form-action 'self';/);
      const page=await begin.text();
      assert.match(page,/<h1>Going to Twitch<\/h1>/);
      assert.match(page,/<meta http-equiv="refresh" content="0;url=https:\/\/id\.twitch\.tv\/oauth2\/authorize\?client_id=fixture&amp;/);
      assert.match(page,/<a class="app-primary" href="https:\/\/id\.twitch\.tv\/oauth2\/authorize\?client_id=fixture&amp;[^"]+">Continue to Twitch<\/a>/);
      assert.equal(begin.headers.get('Referrer-Policy'),'same-origin');
    });

    await t.test('the first step builds the draft from the channel and asks for other platforms',async()=>{
      assert.equal((await get('/start')).status,401);
      const step=await get('/start',nova);
      assert.equal(step.status,200);
      const html=await step.text();
      assert.match(html,/<h1>Where else are you\?<\/h1>/);
      for(const platform of ['youtube','tiktok','x','instagram','kick']) assert.match(html,new RegExp('<input id="link-'+platform+'" name="'+platform+'" aria-label="Your '));
      assert.match(html,/<a class="app-skip" href="\/start\/look">Skip<\/a>/);
      const draft=await draftOf('nova@example.test');
      assert.equal(draft.draft_revision,1);
      const {identity,spotlight,dock,skin,aura}=draft.content;
      assert.deepEqual([identity.displayName,identity.intro,identity.game],['NovaByte','Speedruns, rhythm games and bad puns.','Neon Drift 2']);
      assert.equal(spotlight.url,'https://www.twitch.tv/novabyte');
      assert.deepEqual(dock.links,[{label:'Twitch',url:'https://www.twitch.tv/novabyte'}]);
      assert.ok(identity.avatarId&&identity.coverId);
      assert.deepEqual([skin,aura.palette.base,aura.font],['Nebula','#190838','wide']);
      assert.equal(await count('assets'),2);
      // A second look at the step keeps the same draft.
      assert.equal((await get('/start',nova)).status,200);
      assert.equal((await draftOf('nova@example.test')).draft_revision,1);
      assert.equal(await count('assets'),2);
    });

    await t.test('the links step adds a platform for each name that the creator gives',async()=>{
      const page=await (await get('/start',nova)).text();
      const operation=page.match(/name="operationId" value="([0-9a-f-]{36})"/)![1];
      assert.equal((await post('/start/links',{operationId:operation,youtube:'novabyte'},nova)).status,403);
      const wrong=await post('/start/links',{csrf:csrf(nova),operationId:operation,youtube:'not a name!'},nova);
      assert.equal(wrong.status,422);
      assert.match(await wrong.text(),/role="alert">Check the YouTube name\./);
      const added=await post('/start/links',{csrf:csrf(nova),operationId:operation,youtube:'@NovaByte',tiktok:'novabyte.plays',x:'',instagram:'',kick:''},nova);
      assert.equal(added.status,303);
      assert.equal(added.headers.get('Location'),'/start/look');
      const draft=await draftOf('nova@example.test');
      assert.equal(draft.draft_revision,2);
      assert.deepEqual(draft.content.dock.links,[{label:'Twitch',url:'https://www.twitch.tv/novabyte'},
        {label:'YouTube',url:'https://www.youtube.com/@NovaByte'},{label:'TikTok',url:'https://www.tiktok.com/@novabyte.plays'}]);
      // A second send of the same form adds nothing more.
      assert.equal((await post('/start/links',{csrf:csrf(nova),operationId:operation,youtube:'@NovaByte',tiktok:'novabyte.plays'},nova)).status,303);
      assert.equal((await draftOf('nova@example.test')).draft_revision,2);
    });

    await t.test('the look step offers the matched colours first and publishes the page',async()=>{
      const step=await get('/start/look',nova);
      assert.equal(step.status,200);
      const html=await step.text();
      assert.match(html,/<h1>Pick a look<\/h1>/);
      assert.match(html,/<input type="radio" name="look" value="art" checked>\s*<span class="app-look" data-look="art">.*?<\/span>Your colours/s);
      for(const theme of ['Nebula','Ember','Tide','Paper']) assert.match(html,new RegExp('<input type="radio" name="look" value="'+theme+'">'));
      assert.match(html,/<button>Publish my page<\/button>/);
      assert.match(html,/href="\/assets\/skin\/1\/190838-/);
      const operation=html.match(/name="operationId" value="([0-9a-f-]{36})"/)![1];
      assert.equal((await get('/novabyte')).status,404);
      const published=await post('/start/look',{csrf:csrf(nova),operationId:operation,look:'art'},nova);
      assert.equal(published.status,303,await published.clone().text());
      assert.equal(published.headers.get('Location'),'/start/live');
      const draft=await draftOf('nova@example.test');
      assert.ok(draft.publication_id);
      const fan=await get('/novabyte');
      assert.equal(fan.status,200);
      const page=await fan.text();
      assert.match(page,/class="pg-name">NovaByte/);
      // The published page shows the clips of the linked channel (RDY r-29W7N).
      assert.ok(page.includes('<a class="pg-clip" href="https://clips.twitch.tv/NovaClip-1"><img src="/assets/clip/NovaClip-1" alt="" loading="lazy"><span>World record pace</span><small>7,263 views</small></a>'));
      assert.equal((await get('/assets/clip/NovaClip-1')).status,200);
      // The report page names the page by its handle address.
      const {id:homeId}=await draftOf('nova@example.test');
      assert.match(await (await get('/h/'+homeId+'/report')).text(),/<h1>Report this page<\/h1><p class="app-lead">lobby\.example\.test\/novabyte<\/p>/);
      // The preview in the editor shows them too.
      assert.match(await (await get('/editor/view',nova)).text(),/<img src="\/assets\/clip\/NovaClip-1"/);
      assert.match(page,/href="\/assets\/skin\/1\/190838-/);
      assert.match(page,/aria-label="YouTube"/);
    });

    await t.test('the last screen shows the address and the way to the editor',async()=>{
      const live=await get('/start/live',nova);
      assert.equal(live.status,200);
      const html=await live.text();
      assert.match(html,/<h1>Your page is live<\/h1>/);
      assert.match(html,/<input id="address" aria-label="The address of your page" readonly value="lobby\.example\.test\/novabyte">/);
      assert.match(html,/<a class="app-primary" href="\/novabyte">View my page<\/a>/);
      assert.match(html,/<a class="app-secondary" href="\/editor">Edit my page<\/a>/);
      // The old review of a matched draft is gone.
      assert.equal((await get('/editor',nova)).status,200);
      assert.equal((await get('/editor/match',nova)).status,404);
    });

    await t.test('the creator switches the Twitch schedule and the clips off and on',async()=>{
      const part=(name:string,show:'0'|'1')=>'<input type="hidden" name="part" value="'+name+'"><input type="hidden" name="show" value="'+show+'">'
        +'<button aria-pressed="'+(show==='0')+'" aria-label="Show the '+name+' on my page">'+(show==='0'?'On':'Off')+'</button>';
      const tab=await (await get('/editor',nova)).text();
      assert.match(tab,/<h2>From Twitch<\/h2>/);
      assert.ok(tab.includes('<span><strong>Schedule</strong><small>Synced with Twitch</small></span>'));
      assert.ok(tab.includes('<span><strong>Clips</strong><small>Synced with Twitch</small></span>'));
      assert.ok(tab.includes(part('schedule','0'))&&tab.includes(part('clips','0')));
      const fan=async()=>(await get('/novabyte')).text(), draft=async()=>(await get('/editor/view',nova)).text();
      assert.match(await fan(),/class="pg-h">Schedule.*class="pg-clips"/s);
      // The switch changes the draft. The published page changes after Publish.
      const off=await post('/editor/twitch',{csrf:csrf(nova),part:'clips',show:'0'},nova);
      assert.equal(off.status,303);
      assert.equal(off.headers.get('Location'),'/editor');
      assert.doesNotMatch(await draft(),/pg-clips/);
      assert.match(await draft(),/class="pg-h">Schedule/);
      assert.match(await fan(),/pg-clips/);
      assert.ok((await (await get('/editor',nova)).text()).includes(part('clips','1')));
      assert.equal((await post('/editor/publish',{csrf:csrf(nova)},nova)).status,303);
      assert.doesNotMatch(await fan(),/pg-clips/);
      assert.match(await fan(),/class="pg-h">Schedule/);
      // With the schedule off, the page shows no schedule and its card does not lead with the next stream.
      await post('/editor/twitch',{csrf:csrf(nova),part:'schedule',show:'0'},nova);
      assert.doesNotMatch(await draft(),/class="pg-h">Schedule|Next stream|localtime\.js/);
      // Both go back on.
      await post('/editor/twitch',{csrf:csrf(nova),part:'schedule',show:'1'},nova);
      await post('/editor/twitch',{csrf:csrf(nova),part:'clips',show:'1'},nova);
      assert.equal((await post('/editor/publish',{csrf:csrf(nova)},nova)).status,303);
      assert.match(await fan(),/Next stream.*class="pg-h">Schedule.*class="pg-clips"/s);
      // Another part or value is refused.
      assert.equal((await post('/editor/twitch',{csrf:csrf(nova),part:'banner',show:'0'},nova)).status,422);
      assert.equal((await post('/editor/twitch',{csrf:csrf(nova),part:'clips',show:'maybe'},nova)).status,422);
      assert.equal((await post('/editor/twitch',{part:'clips',show:'0'},nova)).status,403);
    });

    await t.test('a creator with a linked Twitch channel can lead with the latest clip',async()=>{
      assert.ok((await (await get('/editor',nova)).text()).includes('<option value="next" selected>Next stream</option><option value="clip">Latest clip</option>'));
      assert.equal((await post('/editor/lead',{csrf:csrf(nova),lead:'clip'},nova)).status,303);
      assert.equal((await draftOf('nova@example.test')).content.spotlight.offlineLead,'clip');
      assert.match(await (await get('/editor',nova)).text(),/<option value="clip" selected>Latest clip<\/option>/);
      assert.equal((await post('/editor/lead',{csrf:csrf(nova),lead:'next'},nova)).status,303);
    });

    await t.test('a creator can pick a theme in place of the matched colours',async()=>{
      who={sub:'3003',login:'afterhours',name:'Afterhours',email:'after@example.test',verified:true};
      const {result,session}=await signIn();
      assert.equal(result.headers.get('Location'),'/start');
      await get('/start',session);
      const html=await (await get('/start/look',session)).text();
      const operation=html.match(/name="operationId" value="([0-9a-f-]{36})"/)![1];
      assert.equal((await post('/start/look',{csrf:csrf(session),operationId:operation,look:'Sunset'},session)).status,422);
      assert.equal((await post('/start/look',{csrf:csrf(session),operationId:operation,look:'Paper'},session)).headers.get('Location'),'/start/live');
      const draft=await draftOf('after@example.test');
      assert.deepEqual([draft.content.skin,draft.content.aura.palette],['Paper',null]);
      assert.match(await (await get('/afterhours')).text(),/data-theme="Paper"/);
    });

    await t.test('a returning creator goes to the editor, and nothing is made twice',async()=>{
      who={sub:'2002',login:'novabyte',name:'NovaByte',email:'nova@example.test',verified:true};
      const {result,session}=await signIn();
      assert.equal(result.headers.get('Location'),'/editor');
      assert.equal(await count('creators'),2);
      // The setup of a published Home leads to its last screen.
      assert.equal((await get('/start',session)).headers.get('Location'),'/start/live');
    });

    await t.test('Twitch must give a verified email, and accounts are never joined',async()=>{
      who={sub:'4004',login:'noemail',name:'No Email',email:null,verified:false};
      const unverified=await signIn();
      assert.equal(unverified.result.headers.get('Location'),'/sign-in?twitch=email');
      assert.equal(unverified.session,'');
      assert.match(await (await get('/sign-in?twitch=email')).text(),/Twitch gave no verified email\. Verify your email at Twitch, then try again\./);
      // The email of this Twitch account already belongs to another linb.io account.
      who={sub:'5005',login:'twin',name:'Twin',email:'NOVA@example.test',verified:true};
      const twin=await signIn();
      assert.equal(twin.result.headers.get('Location'),'/sign-in?twitch=mailbox');
      assert.equal(twin.session,'');
      assert.equal(await count('creators'),2);
      assert.equal(await count('twitch_identities'),2);
    });

    await t.test('with open sign-up off, a new identity is not admitted',async()=>{
      who={sub:'6006',login:'latecomer',name:'Latecomer',email:'late@example.test',verified:true};
      const {upstream,result,session}=await signIn(closed);
      assert.equal(upstream.searchParams.get('scope'),'openid');
      assert.equal(upstream.searchParams.get('claims'),null);
      assert.equal(result.headers.get('Location'),'/sign-in?twitch=mailbox');
      assert.equal(session,'');
      assert.equal(await count('creators'),2);
      assert.match(await (await get('/','',closed)).text(),/Sign-up is by invitation for now\./);
      assert.doesNotMatch(await (await get('/')).text(),/by invitation/);
    });

    await t.test('the handle is the login of the channel, not its display name',async()=>{
      // A localized display name shares no letter with the login.
      who={sub:'7007',login:'hoshizora',name:'星空ちゃん',email:'hoshi@example.test',verified:true};
      const {result}=await signIn();
      assert.equal(result.headers.get('Location'),'/start');
      assert.deepEqual((await pool.query(`SELECT login FROM twitch_identities WHERE subject='7007'`)).rows,[{login:'hoshizora'}]);
      assert.equal((await pool.query(`SELECT 1 FROM home_handles WHERE handle='hoshizora' AND current`)).rowCount,1);
    });

    await t.test('the published page of a live channel shows the picture of the stream',async()=>{
      who={sub:'2002',login:'novabyte',name:'NovaByte',email:'nova@example.test',verified:true};
      streaming=true;
      const liveApp=createApp({...base,openSignup:true});
      const {id}=await draftOf('nova@example.test');
      const page=await (await get('/novabyte','',liveApp)).text();
      assert.match(page,/<span class="pg-live">LIVE<\/span>/);
      assert.ok(page.includes('<img class="pg-thumb" src="/h/'+id+'/stream" alt=""><p class="pg-card-title">Any% practice</p>'));
      const shot=await get('/h/'+id+'/stream','',liveApp);
      assert.equal(shot.status,200);
      assert.equal(shot.headers.get('Content-Type'),'image/webp');
      // An offline channel has no stream picture.
      streaming=false;
      assert.equal((await get('/h/'+id+'/stream','',createApp({...base,openSignup:true}))).status,404);
    });

    // A deployment with no mail service. Twitch is then the only way to sign in.
    const bare=createApp({...base,mail:undefined,openSignup:true});
    let mailless='';

    await t.test('without a mail service, a streamer signs up and returns with Twitch alone',async()=>{
      who={sub:'8008',login:'mailless',name:'Mailless',email:'mailless@example.test',verified:true};
      const sent=mail.length;
      const first=await signIn(bare);
      assert.equal(first.result.headers.get('Location'),'/start');
      assert.ok(first.session);
      assert.equal((await get('/start',first.session,bare)).status,200);
      assert.equal((await pool.query(`SELECT 1 FROM home_handles WHERE handle='mailless' AND current`)).rowCount,1);
      const again=await signIn(bare);
      assert.equal(again.result.headers.get('Location'),'/editor');
      mailless=again.session;
      assert.equal((await get('/editor',mailless,bare)).status,200);
      assert.equal(mail.length,sent);
    });

    await t.test('without a mail service, the sign-in page offers Twitch only',async()=>{
      const page=await (await get('/sign-in','',bare)).text();
      assert.match(page,/<button class="app-twitch">Continue with Twitch<\/button>/);
      assert.doesNotMatch(page,/name="mailbox"|Email me a sign-in link|The link works once/);
      // The address of the sent state shows no mailbox message.
      assert.doesNotMatch(await (await get('/sign-in?sent=1','',bare)).text(),/Check your mailbox/);
      // A request for a link is refused, and it stores no proof.
      const proofs=await count('access_proofs');
      assert.equal((await post('/sign-in',{mailbox:'nova@example.test'},'',bare)).status,503);
      assert.equal(await count('access_proofs'),proofs);
      // With a mail service, the page keeps the email form.
      assert.match(await (await get('/sign-in')).text(),/name="mailbox"/);
    });

    await t.test('without a mail service, the operator sign-in says that it needs mail',async()=>{
      const page=await (await get('/ops/sign-in','',bare)).text();
      assert.match(page,/<p class="app-lead">Operator sign-in needs the mail service\. It is not set up\.<\/p>/);
      assert.doesNotMatch(page,/name="mailbox"/);
      const proofs=await count('access_proofs');
      assert.equal((await post('/ops/sign-in',{mailbox:'operator@example.test'},'',bare)).status,503);
      assert.equal(await count('access_proofs'),proofs);
    });

    await t.test('without a mail service, a second Twitch account with a known email is sent to the first account',async()=>{
      who={sub:'9009',login:'secondnova',name:'SecondNova',email:'nova@example.test',verified:true};
      const {result,session}=await signIn(bare);
      assert.equal(result.headers.get('Location'),'/sign-in?twitch=mailbox');
      assert.equal(session,'');
      assert.equal((await pool.query(`SELECT 1 FROM twitch_identities WHERE subject='9009'`)).rowCount,0);
      const page=await (await get('/sign-in?twitch=mailbox','',bare)).text();
      assert.match(page,/<p class="app-note" role="alert">The email of this Twitch account already has a linb\.io page\. Sign in with the Twitch account of that page\.<\/p>/);
      assert.match(page,/Continue with Twitch/);
      assert.doesNotMatch(page,/name="mailbox"/);
    });

    await t.test('without a mail service, the account offers no email change and no Twitch disconnect',async()=>{
      const page=await (await get('/account',mailless,bare)).text();
      assert.match(page,/<p>Your email: <strong>mailless@example\.test<\/strong><\/p><p class="ed-fine">It comes from your Twitch account\.<\/p>/);
      assert.doesNotMatch(page,/action="\/account\/mailbox"|Send verification links/);
      assert.match(page,/<p>Connected: mailless<\/p><p class="ed-fine">You sign in with Twitch\.<\/p>/);
      assert.doesNotMatch(page,/Disconnect Twitch|action="\/account\/twitch"/);
      assert.match(page,/<button class="ed-quiet">Sign out<\/button>/);
      // The account leads to the terms and to the privacy notice.
      assert.match(page,/<a href="\/terms">Terms<\/a><a href="\/privacy">Privacy<\/a>/);
      // The forms that the page does not show are refused.
      const changes=await count('mailbox_changes');
      assert.equal((await post('/account/mailbox',{csrf:csrf(mailless),mailbox:'other@example.test'},mailless,bare)).status,503);
      assert.equal(await count('mailbox_changes'),changes);
      assert.equal((await post('/account/twitch',{csrf:csrf(mailless),action:'unlink'},mailless,bare)).status,503);
      assert.equal((await pool.query(`SELECT 1 FROM twitch_identities WHERE subject='8008'`)).rowCount,1);
      // With a mail service, the account keeps both controls.
      who={sub:'2002',login:'novabyte',name:'NovaByte',email:'nova@example.test',verified:true};
      const full=await (await get('/account',(await signIn()).session)).text();
      assert.match(full,/action="\/account\/mailbox"/);
      assert.match(full,/Disconnect Twitch/);
      assert.match(full,/<a href="\/terms">Terms<\/a><a href="\/privacy">Privacy<\/a>/);
    });
  } finally {
    await pool.end();
    await admin.query('DROP SCHEMA '+schema+' CASCADE');
    await admin.end();
  }
});
