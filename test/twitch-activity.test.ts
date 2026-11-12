import assert from 'node:assert/strict';
import {test} from 'node:test';
import {homeAliases} from '../src/home-aliases.ts';
import {TwitchActivity} from '../src/twitch-activity.ts';

const channel={subject:'1001',login:'creator'};

test('Twitch activity verifies the linked subject and login, shares requests and fails closed',async()=>{
  let time=Date.parse('2027-07-16T17:00:00Z'),tokens=0,streams=0;
  let state='live';
  const activity=new TwitchActivity({clientId:'app',clientSecret:'fixture',http:async(input,init)=>{
    const url=new URL(String(input));
    if(url.pathname==='/oauth2/token') {
      assert.equal(url.origin,'https://id.twitch.tv');
      assert.equal((init?.body as URLSearchParams).get('grant_type'),'client_credentials');
      tokens++;
      return Response.json({access_token:'fixture-token',expires_in:600});
    }
    assert.equal(url.origin,'https://api.twitch.tv');
    if(url.pathname==='/helix/users') return Response.json({data:[
      {id:channel.subject,login:state==='renamed'?'new_login':channel.login},
    ]});
    assert.equal(url.searchParams.get('user_id'),channel.subject);
    assert.equal(new Headers(init?.headers).get('authorization'),'Bearer fixture-token');
    streams++;
    if(state==='unauthorized') return new Response(null,{status:401});
    if(state==='offline'||state==='renamed') return Response.json({data:[]});
    return Response.json({data:[{type:'live',user_id:channel.subject,
      user_login:state==='wrong'?'other':channel.login,title:'Stream title',viewer_count:52}]});
  }},()=>time);
  const both=await Promise.all([activity.get(channel),activity.get(channel)]);
  assert.deepEqual(both,[{live:true,verified:true,title:'Stream title',viewers:52},{live:true,verified:true,title:'Stream title',viewers:52}]);
  assert.deepEqual([tokens,streams],[1,1]);
  const check=async(next:string,verified:boolean)=>{
    state=next; time+=26_000;
    assert.deepEqual(await activity.get(channel),{live:false,verified});
  };
  await check('wrong',false);
  await check('unauthorized',false);
  await check('offline',true);
  await check('renamed',false);
  assert.equal(tokens,2);
});

test('Offline clips come from the linked broadcaster and never reuse a response URL',async()=>{
  const time=Date.parse('2027-07-16T17:00:00Z');
  let clipReads=0;
  const activity=new TwitchActivity({clientId:'app',clientSecret:'fixture',http:async input=>{
    const url=new URL(String(input));
    if(url.pathname==='/oauth2/token') return Response.json({access_token:'token',expires_in:600});
    if(url.pathname==='/helix/streams') return Response.json({data:[]});
    if(url.pathname==='/helix/users') return Response.json({data:[{id:channel.subject,login:channel.login}]});
    clipReads++;
    assert.equal(url.searchParams.get('broadcaster_id'),channel.subject);
    return Response.json({data:[
      {id:'Older',title:'Older',broadcaster_id:channel.subject,created_at:'2027-07-14T00:00:00Z',view_count:900},
      {id:'Latest',title:'Latest',broadcaster_id:channel.subject,created_at:'2027-07-15T00:00:00Z',view_count:71,url:'https://example.test'},
      {id:'Wrong',title:'Other broadcaster',broadcaster_id:'2001',created_at:'2027-07-16T00:00:00Z',view_count:800},
      {id:'../../bad',title:'Malformed clip',broadcaster_id:channel.subject,created_at:'2027-07-16T00:00:00Z',view_count:700},
    ]});
  }},()=>time);
  assert.deepEqual(await activity.get(channel),{live:false,verified:true});
  assert.equal(clipReads,0);
  assert.deepEqual((await activity.get(channel,true)).clip,{title:'Latest',url:'https://clips.twitch.tv/Latest',views:71});
  await activity.get(channel,true);
  assert.equal(clipReads,1);
});

test('Home aliases reserve application routes and validate the expected identity',()=>{
  const alias={homeId:'00000000-0000-4000-8000-000000000001',twitchSubject:'1001'};
  assert.deepEqual(homeAliases(JSON.stringify({creator:alias})).get('creator'),alias);
  for(const handle of ['editor','/creator','%6eexzou','Nexzou']) {
    assert.throws(()=>homeAliases(JSON.stringify({[handle]:alias})),/Invalid approved Home alias/);
  }
  assert.throws(()=>homeAliases(JSON.stringify({creator:{...alias,twitchSubject:'creator'}})),/Invalid approved Home alias/);
});

test('a live stream carries the address of its picture, only from the Twitch image host',async()=>{
  let thumbnail:unknown='https://static-cdn.jtvnw.net/previews-ttv/live_user_creator-{width}x{height}.jpg';
  const read=()=>new TwitchActivity({clientId:'app',clientSecret:'fixture',http:(async(input:RequestInfo|URL)=>{
    const url=new URL(String(input));
    if(url.pathname==='/oauth2/token') return Response.json({access_token:'fixture-token',expires_in:600});
    return Response.json({data:[{type:'live',user_id:channel.subject,user_login:channel.login,title:'Stream title',viewer_count:52,
      thumbnail_url:thumbnail}]});
  }) as typeof fetch}).get(channel);
  assert.deepEqual(await read(),{live:true,verified:true,title:'Stream title',viewers:52,
    picture:'https://static-cdn.jtvnw.net/previews-ttv/live_user_creator-960x540.jpg'});
  for(const other of ['https://example.test/live_user_creator-{width}x{height}.jpg',
    'http://static-cdn.jtvnw.net/previews-ttv/live_user_creator-{width}x{height}.jpg','',undefined,42]) {
    thumbnail=other;
    assert.deepEqual(await read(),{live:true,verified:true,title:'Stream title',viewers:52});
  }
});

test('the clips of a channel are its featured clips, or the most viewed of 30 days',async()=>{
  const time=Date.parse('2027-07-16T17:00:00Z');
  const cdn='https://static-cdn.jtvnw.net/twitch-video-assets/';
  const clip=(id:string,views:number,extra:Record<string,unknown>={})=>({id,broadcaster_id:channel.subject,title:'Clip '+id,view_count:views,
    created_at:'2027-07-01T00:00:00Z',thumbnail_url:cdn+id+'-480x272.jpg',...extra});
  let featured=[clip('B',40),clip('A',900),clip('C',7),clip('D',5),clip('E',3)];
  let top=[clip('T1',99),clip('T2',98)];
  let down=false;
  const asked:string[]=[];
  const make=()=>new TwitchActivity({clientId:'app',clientSecret:'fixture',http:(async(input:RequestInfo|URL)=>{
    const url=new URL(String(input));
    if(url.pathname==='/oauth2/token') return Response.json({access_token:'fixture-token',expires_in:600});
    assert.equal(url.pathname,'/helix/clips');
    assert.equal(url.searchParams.get('broadcaster_id'),channel.subject);
    asked.push(url.search);
    if(down) return new Response('',{status:503});
    return Response.json({data:url.searchParams.get('is_featured')==='true'?featured:top});
  }) as typeof fetch},()=>time);
  const activity=make();
  const first=await activity.clipList(channel);
  // Most viewed first, four at most.
  assert.deepEqual(first.map(item=>item.id),['A','B','C','D']);
  assert.deepEqual(first[0],{id:'A',title:'Clip A',url:'https://clips.twitch.tv/A',views:900,picture:cdn+'A-480x272.jpg'});
  assert.equal(asked.length,1);
  // A second reading within five minutes asks Twitch nothing.
  await activity.clipList(channel);
  assert.equal(asked.length,1);
  // With no featured clip, the most viewed clips of the last 30 days.
  featured=[];
  assert.deepEqual((await make().clipList(channel)).map(item=>item.id),['T1','T2']);
  assert.match(asked.at(-1)!,/started_at=2027-06-16T17%3A00%3A00\.000Z/);
  // A clip of another channel, with no title, with a wrong ID or with a picture from another host is left out.
  top=[clip('ok',5),clip('other',4,{broadcaster_id:'9'}),clip('untitled',3,{title:' '}),clip('wrong id!',2),
    clip('nopicture',1,{thumbnail_url:'https://example.test/x.jpg'})];
  assert.deepEqual((await make().clipList(channel)).map(item=>item.id),['ok']);
  // When Twitch does not answer, there are no clips, and the next reading asks again.
  down=true;
  const failing=make();
  assert.deepEqual(await failing.clipList(channel),[]);
  down=false;
  assert.deepEqual((await failing.clipList(channel)).map(item=>item.id),['ok']);
});
