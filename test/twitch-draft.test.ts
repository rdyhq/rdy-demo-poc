import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
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
  assert.deepEqual(await activity.profile(user.id),{subject:'2002',login:'novabyte',displayName:'NovaByte',bio:user.description,game:'Neon Drift 2',
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
