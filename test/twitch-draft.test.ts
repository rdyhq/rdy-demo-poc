import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../src/app.ts';
import { connect, migrate, transaction } from '../src/db.ts';
import { digest } from '../src/domain.ts';
import { attachTwitch } from '../src/twitch.ts';
import { TwitchActivity } from '../src/twitch-activity.ts';
import { artUrl, fetchArt, matchChannel } from '../src/twitch-channel.ts';

const cdn='https://static-cdn.jtvnw.net/jtv_user_pictures/';
const user={id:'2002',login:'novabyte',display_name:'NovaByte',description:'Speedruns, rhythm games and bad puns.',
  profile_image_url:cdn+'nova-profile_image-300x300.png',offline_image_url:cdn+'nova-channel_offline_image-1920x1080.png'};
const flat=(width:number,height:number,areas:[string,number][])=>{
  // A PNG with vertical bands of flat colour.
  let left=0;
  const bands=areas.map(([color,share])=>{
    const band={input:{create:{width:Math.max(1,Math.round(share*width)),height,channels:3 as const,background:color}},left,top:0};
    left+=band.input.create.width;
    return band;
  });
  return sharp({create:{width,height,channels:3,background:areas[0][0]}}).composite(bands).png().toBuffer();
};
const avatarArt=()=>flat(300,300,[['#1a0b3b',.6],['#ff5fae',.3],['#2ee6f0',.1]]);
const bannerArt=()=>flat(1200,400,[['#190838',.6],['#ff3d9a',.3],['#2ee6f0',.1]]);
const png=(bytes:Buffer)=>new Response(Uint8Array.from(bytes),{headers:{'Content-Type':'image/png'}});

// A stand-in for Twitch: the app token, the two Helix reads and the image host.
function twitchStub(overrides:{user?:object|null;game?:string;images?:Record<string,()=>Promise<Response>|Response>;down?:boolean}={}) {
  const calls:string[]=[];
  const http=async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=new URL(String(input));
    calls.push(url.origin+url.pathname);
    if(overrides.down) return new Response('',{status:503});
    if(url.pathname==='/oauth2/token') return Response.json({access_token:'fixture-token',expires_in:600});
    if(url.origin==='https://api.twitch.tv') {
      assert.equal(new Headers(init?.headers).get('authorization'),'Bearer fixture-token');
      if(url.pathname==='/helix/users') {
        assert.equal(url.searchParams.get('id'),user.id);
        return Response.json({data:overrides.user===null?[]:[{...user,...overrides.user}]});
      }
      if(url.pathname==='/helix/channels') {
        assert.equal(url.searchParams.get('broadcaster_id'),user.id);
        return Response.json({data:[{broadcaster_id:user.id,game_name:overrides.game??'Neon Drift 2',title:'Any% practice'}]});
      }
    }
    if(url.origin==='https://static-cdn.jtvnw.net') {
      assert.equal(init?.redirect,'error');
      const image=overrides.images?.[url.pathname.includes('offline')?'banner':'avatar'];
      return image?image():png(url.pathname.includes('offline')?await bannerArt():await avatarArt());
    }
    return new Response('',{status:404});
  };
  return {http:http as typeof fetch,calls};
}

test('the Twitch adapter reads the profile of the linked channel',async()=>{
  const {http}=twitchStub();
  const activity=new TwitchActivity({clientId:'app',clientSecret:'fixture',http});
  assert.deepEqual(await activity.profile(user.id),{login:'novabyte',displayName:'NovaByte',bio:user.description,game:'Neon Drift 2',
    avatarUrl:user.profile_image_url,bannerUrl:user.offline_image_url});
});

test('the profile leaves out what Twitch does not supply and cuts text to the limits of a Home',async()=>{
  const long='Cozy '.repeat(40).trim();
  const {http}=twitchStub({user:{description:long,offline_image_url:'',
    profile_image_url:'https://static-cdn.jtvnw.net/user-default-pictures-uv/cdd517fe-def4-11e9-948e-784f43822e80-profile_image-300x300.png'},game:''});
  const profile=(await new TwitchActivity({clientId:'app',clientSecret:'fixture',http}).profile(user.id))!;
  // The default picture of Twitch is not the creator's art.
  assert.equal(profile.avatarUrl,null);
  assert.equal(profile.bannerUrl,null);
  assert.equal(profile.game,'');
  assert.ok(profile.bio.length<=160&&profile.bio.endsWith('…')&&!profile.bio.includes(' …'),profile.bio);
});

test('the profile is absent when Twitch names another user or gives no answer',async()=>{
  for(const stub of [twitchStub({user:{id:'9999'}}),twitchStub({user:null}),twitchStub({down:true}),twitchStub({user:{login:'bad login'}})]) {
    assert.equal(await new TwitchActivity({clientId:'app',clientSecret:'fixture',http:stub.http}).profile(user.id),null);
  }
});

test('art comes only from the Twitch image host over HTTPS',()=>{
  assert.equal(artUrl(user.profile_image_url),user.profile_image_url);
  for(const value of ['http://static-cdn.jtvnw.net/a.png','https://static-cdn.jtvnw.net.example.test/a.png','https://example.test/a.png',
    'https://user@static-cdn.jtvnw.net/a.png','https://static-cdn.jtvnw.net:8443/a.png','',null,42,'not a url']) {
    assert.equal(artUrl(value),null,String(value));
  }
});

test('an image fetch has a size limit, needs an image type and follows no redirect',async()=>{
  const {http,calls}=twitchStub();
  assert.ok((await fetchArt(user.profile_image_url,http))!.length>100);
  assert.equal(await fetchArt('https://example.test/a.png',http),null);
  assert.equal(calls.filter(call=>call.includes('example.test')).length,0);
  const page=twitchStub({images:{avatar:()=>new Response('<html>',{headers:{'Content-Type':'text/html'}})}});
  assert.equal(await fetchArt(user.profile_image_url,page.http),null);
  const large=twitchStub({images:{avatar:()=>new Response(new Uint8Array(5*1024*1024+1),{headers:{'Content-Type':'image/png'}})}});
  assert.equal(await fetchArt(user.profile_image_url,large.http),null);
  const lying=twitchStub({images:{avatar:()=>new Response(new Uint8Array(1024),{headers:{'Content-Type':'image/png','Content-Length':String(6*1024*1024)}})}});
  assert.equal(await fetchArt(user.profile_image_url,lying.http),null);
  const failing=twitchStub({images:{avatar:()=>{throw new TypeError('fetch failed');}}});
  assert.equal(await fetchArt(user.profile_image_url,failing.http),null);
  assert.equal(await fetchArt(user.profile_image_url,twitchStub({down:true}).http),null);
});

test('the matched draft holds the art and a skin from the art',async()=>{
  const {http}=twitchStub();
  const profile=(await new TwitchActivity({clientId:'app',clientSecret:'fixture',http}).profile(user.id))!;
  const match=await matchChannel(profile,http);
  assert.equal((await sharp(match.art.avatar!).metadata()).format,'webp');
  assert.equal((await sharp(match.art.banner!).metadata()).format,'webp');
  assert.deepEqual({theme:match.skin!.theme,base:match.skin!.palette!.base,font:match.skin!.font},{theme:'Nebula',base:'#190838',font:'wide'});
  assert.match(match.skin!.reasons[0].reason,/banner/);
});

test('an image that fails a check is left out and the rest of the draft stays',async()=>{
  const broken=twitchStub({images:{banner:()=>png(Buffer.from('not an image'))}});
  const profile=(await new TwitchActivity({clientId:'app',clientSecret:'fixture',http:broken.http}).profile(user.id))!;
  const match=await matchChannel(profile,broken.http);
  assert.equal(match.art.banner,null);
  assert.ok(match.art.avatar);
  // The skin comes from the avatar when the banner is absent.
  assert.match(match.skin!.reasons[0].reason,/avatar/);
  const none=await matchChannel({...profile,avatarUrl:null,bannerUrl:null},broken.http);
  assert.deepEqual(none.art,{avatar:null,banner:null});
  assert.equal(none.skin,null);
});

const database=process.env.LOBBY_TEST_DATABASE_URL;

test('a linked Twitch creator reviews and accepts a matched draft',{skip:!database},async t=>{
  const admin=connect(database!);
  const schema='lobby_test_'+randomUUID().replaceAll('-','');
  await admin.query('CREATE SCHEMA '+schema);
  const scoped=new URL(database!);
  scoped.searchParams.set('options','-c search_path='+schema);
  const pool=connect(scoped.href);
  const origin='https://lobby.example.test';
  const mail:{to:string;text:string}[]=[];
  const images=new Map<string,Buffer>();
  const objects={async write(key:string,bytes:Buffer){images.set(key,bytes);},async read(key:string){return images.get(key)!;}};
  const base={pool,origin,mail:async(to:string,_subject:string,text:string)=>{mail.push({to,text});},objects};
  let stub=twitchStub();
  const twitchActivity={clientId:'app',clientSecret:'fixture',http:((input:RequestInfo|URL,init?:RequestInit)=>stub.http(input,init)) as typeof fetch};
  const app=createApp({...base,twitchActivity});
  const request=(target:ReturnType<typeof createApp>,path:string,cookie:string,init:RequestInit={})=>
    target.request(origin+path,{...init,headers:{Cookie:cookie,Origin:origin,...init.headers}});
  const get=(path:string,cookie:string,target=app)=>request(target,path,cookie);
  const post=(path:string,value:Record<string,string>,cookie='',target=app)=>request(target,path,cookie,{method:'POST',body:new URLSearchParams(value)});
  const csrf=(cookie:string)=>digest('lobby:csrf:'+cookie.split('=')[1]);
  const login=async(email:string,operator=false)=>{
    await post(operator?'/ops/sign-in':'/sign-in',{mailbox:email});
    const proof=mail.findLast(item=>item.to===email)!.text.match(/token=([0-9a-f]{64})/)![1];
    return (await post('/verify',{token:proof})).headers.get('Set-Cookie')!.split(';')[0];
  };
  const draft=async(email:string)=>(await pool.query(`SELECT h.id,h.draft_revision,d.content FROM homes h JOIN creators c ON c.id=h.owner_id
    JOIN drafts d ON d.home_id=h.id AND d.revision=h.draft_revision WHERE c.mailbox=$1`,[email])).rows[0];
  try {
    await migrate(pool);
    await pool.query('INSERT INTO operators(id,mailbox) VALUES ($1,$2)',[randomUUID(),'ops@example.test']);
    const ops=await login('ops@example.test',true);
    const creator=async(email:string,subject?:string,name='novabyte')=>{
      assert.equal((await post('/ops/invites',{csrf:csrf(ops),mailbox:email,alias:email.split('@')[0]},ops)).status,303);
      const cookie=await login(email);
      if(subject) {
        const {rows}=await pool.query('SELECT id FROM creators WHERE mailbox=$1',[email]);
        assert.ok(await transaction(pool,client=>attachTwitch(client,rows[0].id,{subject,login:name})));
      }
      return cookie;
    };
    const nova=await creator('nova@example.test',user.id);
    let operation='';

    await t.test('the editor shows the matched draft while the draft is empty, and saves nothing',async()=>{
      const opened=await get('/editor',nova);
      assert.equal(opened.status,303);
      assert.equal(opened.headers.get('Location'),'/editor/match');
      const review=await get('/editor/match',nova);
      assert.equal(review.status,200);
      const page=await review.text();
      assert.match(page,/Nothing is saved yet/);
      assert.match(page,/@novabyte/);
      assert.match(page,/<input id="match-name" name="displayName" required maxlength="40" value="NovaByte">/);
      assert.match(page,/<textarea id="match-intro" name="intro" required maxlength="160">Speedruns, rhythm games and bad puns\.<\/textarea>/);
      assert.match(page,/<input id="match-game" name="game" maxlength="80" value="Neon Drift 2">/);
      for(const item of ['link','avatar','banner','skin']) assert.match(page,new RegExp('<input type="checkbox" name="'+item+'" checked>'),item);
      assert.match(page,/Built from the most common colour of your banner\./);
      assert.match(page,/<iframe[^>]* src="\/editor\/match\/preview"/);
      assert.match(review.headers.get('Content-Security-Policy')!,/frame-src 'self'/);
      operation=page.match(/name="operationId" value="([0-9a-f-]{36})"/)![1];
      assert.equal((await draft('nova@example.test')).draft_revision,0);
      assert.equal((await pool.query('SELECT 1 FROM assets')).rowCount,0);
      assert.equal(images.size,0);
    });

    await t.test('the review shows the art and a preview of the matched Home to its creator only',async()=>{
      for(const kind of ['avatar','banner']) {
        const image=await get('/editor/match/art/'+kind,nova);
        assert.equal(image.status,200);
        assert.equal(image.headers.get('Content-Type'),'image/webp');
      }
      assert.equal((await get('/editor/match/art/logo',nova)).status,404);
      const preview=await get('/editor/match/preview',nova);
      assert.equal(preview.status,200);
      const page=await preview.text();
      assert.match(page,/NovaByte/);
      assert.match(page,/href="\/assets\/skin\/1\/190838-/);
      assert.match(page,/src="\/editor\/match\/art\/banner"/);
      assert.match(preview.headers.get('Content-Security-Policy')!,/frame-ancestors 'self'/);
      // Twitch is asked once for the review, its art and its preview.
      assert.equal(stub.calls.filter(call=>call.endsWith('/helix/users')).length,1);
      const other=await creator('other@example.test');
      assert.equal((await get('/editor/match/art/avatar',other)).status,404);
      assert.equal((await get('/editor/match',other)).headers.get('Location'),'/editor');
      assert.equal((await get('/editor',other)).status,200);
    });

    await t.test('Use this draft saves the items that the creator kept',async()=>{
      const values={operationId:operation,displayName:'Nova Byte',intro:'Speedruns and bad puns.',game:'',link:'on',avatar:'on',skin:'on'};
      assert.equal((await post('/editor/match',values,nova)).status,403);
      const accepted=await post('/editor/match',{...values,csrf:csrf(nova)},nova);
      assert.equal(accepted.status,303,await accepted.clone().text());
      assert.equal(accepted.headers.get('Location'),'/editor');
      const saved=await draft('nova@example.test');
      assert.equal(saved.draft_revision,1);
      const {identity,spotlight,dock,skin,aura}=saved.content;
      // The creator corrected the name and the intro, emptied the game and left the banner out.
      assert.deepEqual([identity.displayName,identity.intro,identity.game,identity.coverId],['Nova Byte','Speedruns and bad puns.','',null]);
      assert.equal(spotlight.url,'https://www.twitch.tv/novabyte');
      assert.deepEqual(dock.links,[{label:'Twitch',url:'https://www.twitch.tv/novabyte'}]);
      assert.equal(skin,'Nebula');
      assert.equal(aura.palette.base,'#190838');
      assert.equal(aura.accentSource,'art');
      assert.equal(aura.font,'wide');
      const assets=await pool.query('SELECT id,state FROM assets');
      assert.deepEqual(assets.rows,[{id:identity.avatarId,state:'ready'}]);
      assert.equal(images.size,1);
      // A second send of the same form saves nothing more.
      assert.equal((await post('/editor/match',{...values,csrf:csrf(nova)},nova)).status,303);
      assert.equal((await draft('nova@example.test')).draft_revision,1);
      assert.equal((await pool.query('SELECT 1 FROM assets')).rowCount,1);
      const editor=await get('/editor',nova);
      assert.equal(editor.status,200);
      assert.match(await editor.text(),/<a id="twitch-match" href="\/editor\/match">Match my Twitch channel<\/a>/);
    });

    await t.test('a later match starts from the saved draft and keeps what the creator leaves out',async()=>{
      const review=await get('/editor/match',nova);
      const page=await review.text();
      const next=page.match(/name="operationId" value="([0-9a-f-]{36})"/)![1];
      assert.notEqual(next,operation);
      const again=await post('/editor/match',{csrf:csrf(nova),operationId:next,displayName:'NovaByte',intro:'Speedruns and bad puns.',game:'Neon Drift 2',banner:'on'},nova);
      assert.equal(again.status,303);
      const saved=await draft('nova@example.test');
      assert.equal(saved.draft_revision,2);
      const {identity,dock,aura}=saved.content;
      assert.equal(identity.displayName,'NovaByte');
      assert.ok(identity.avatarId&&identity.coverId);
      // The link and the skin were not ticked, so the saved ones stay.
      assert.equal(dock.links.length,1);
      assert.equal(aura.palette.base,'#190838');
    });

    await t.test('a creator can set up by hand, and Twitch can be absent',async()=>{
      const manual=await creator('manual@example.test','3003','handmade');
      const skipped=await get('/editor?manual=1',manual);
      assert.equal(skipped.status,200);
      const remembered=skipped.headers.getSetCookie().find(value=>value.includes('linb-manual=1'))!.split(';')[0];
      assert.equal((await get('/editor',manual+'; '+remembered)).status,200);
      assert.equal((await get('/editor',manual)).status,303);
      // Twitch gives no answer: the creator lands in the editor for manual setup.
      stub=twitchStub({down:true});
      const absent=await get('/editor/match',manual);
      assert.equal(absent.status,303);
      assert.equal(absent.headers.get('Location'),'/editor?manual=1');
      stub=twitchStub();
      // Without the Twitch app credentials the editor opens as before.
      const plain=createApp(base);
      assert.equal((await get('/editor',manual,plain)).status,200);
      assert.equal((await get('/editor/match',manual,plain)).headers.get('Location'),'/editor');
      assert.equal((await draft('manual@example.test')).draft_revision,0);
    });

    await t.test('paused Home changes refuse the matched draft',async()=>{
      const paused=createApp({...base,twitchActivity,readOnlyHomes:true});
      const refused=await post('/editor/match',{csrf:csrf(nova),operationId:randomUUID(),displayName:'NovaByte',intro:'Speedruns.',game:''},nova,paused);
      assert.equal(refused.status,503);
      assert.equal((await draft('nova@example.test')).draft_revision,2);
    });
  } finally {
    await pool.end();
    await admin.query('DROP SCHEMA '+schema+' CASCADE');
    await admin.end();
  }
});
