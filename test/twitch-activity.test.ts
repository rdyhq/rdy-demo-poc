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
