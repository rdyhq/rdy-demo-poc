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
  // The person at Twitch for the next sign-in.
  let who={sub:'2002',login:'novabyte',name:'NovaByte',email:'nova@example.test' as string|null,verified:true};
  let nonce='';
  const b64=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const http=(async(input:RequestInfo|URL)=>{
    const url=new URL(String(input));
    if(url.hostname==='id.twitch.tv') {
      if(url.pathname.endsWith('/keys')) return Response.json({keys:[key]});
      if(url.pathname.endsWith('/validate')) return Response.json({client_id:'fixture',user_id:who.sub,expires_in:3600});
      if(url.pathname.endsWith('/token')&&!nonce) return Response.json({access_token:'app-token',expires_in:600});
      if(url.pathname.endsWith('/token')) {
        const unsigned=b64({alg:'RS256',kid:'fixture'})+'.'+b64({iss:'https://id.twitch.tv/oauth2',aud:'fixture',sub:who.sub,
          preferred_username:who.login,email:who.verified?who.email:null,email_verified:who.verified,nonce,
          iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+600});
        nonce='';
        return Response.json({id_token:unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),privateKey).toString('base64url'),access_token:'user-token'});
      }
    }
    if(url.pathname==='/helix/users') return Response.json({data:url.searchParams.get('id')===who.sub?[{id:who.sub,login:who.login,display_name:who.name,
      description:'Speedruns, rhythm games and bad puns.',profile_image_url:cdn+'a-profile_image-300x300.png',
      offline_image_url:cdn+'a-channel_offline_image-1920x1080.png'}]:[]});
    if(url.pathname==='/helix/channels') return Response.json({data:[{broadcaster_id:who.sub,game_name:'Neon Drift 2'}]});
    if(url.pathname==='/helix/streams') return Response.json({data:[]});
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
    assert.equal(begin.status,303);
    const upstream=new URL(begin.headers.get('Location')!);
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
      assert.deepEqual(JSON.parse(upstream.searchParams.get('claims')!),{id_token:{preferred_username:null,email:null,email_verified:null}});
      assert.equal(result.status,303);
      assert.equal(result.headers.get('Location'),'/start');
      assert.ok(session);
      nova=session;
      assert.deepEqual((await pool.query('SELECT mailbox FROM creators')).rows,[{mailbox:'nova@example.test'}]);
      assert.deepEqual((await pool.query('SELECT subject,login FROM twitch_identities')).rows,[{subject:'2002',login:'novabyte'}]);
      assert.deepEqual((await pool.query('SELECT handle,current FROM home_handles')).rows,[{handle:'novabyte',current:true}]);
      assert.equal((await draftOf('nova@example.test')).draft_revision,0);
    });

    await t.test('the first step builds the draft from the channel and asks for other platforms',async()=>{
      assert.equal((await get('/start')).status,401);
      const step=await get('/start',nova);
      assert.equal(step.status,200);
      const html=await step.text();
      assert.match(html,/<h1>Where else are you\?<\/h1>/);
      for(const platform of ['youtube','tiktok','x','instagram','kick']) assert.match(html,new RegExp('<input id="link-'+platform+'" name="'+platform+'"'));
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
      assert.match(page,/href="\/assets\/skin\/1\/190838-/);
      assert.match(page,/aria-label="YouTube"/);
    });

    await t.test('the last screen shows the address and the way to the editor',async()=>{
      const live=await get('/start/live',nova);
      assert.equal(live.status,200);
      const html=await live.text();
      assert.match(html,/<h1>Your page is live<\/h1>/);
      assert.match(html,/<input id="address" readonly value="lobby\.example\.test\/novabyte">/);
      assert.match(html,/<a class="app-primary" href="\/novabyte">View my page<\/a>/);
      assert.match(html,/<a class="app-secondary" href="\/editor">Edit my page<\/a>/);
      // The old review of a matched draft is gone.
      assert.equal((await get('/editor',nova)).status,200);
      assert.equal((await get('/editor/match',nova)).status,404);
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
      assert.equal(result.headers.get('Location'),'/sign-in?twitch=mailbox');
      assert.equal(session,'');
      assert.equal(await count('creators'),2);
      assert.match(await (await get('/','',closed)).text(),/Sign-up is by invitation for now\./);
      assert.doesNotMatch(await (await get('/')).text(),/by invitation/);
    });
  } finally {
    await pool.end();
    await admin.query('DROP SCHEMA '+schema+' CASCADE');
    await admin.end();
  }
});
