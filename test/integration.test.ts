import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../src/app.ts';
import { connect, migrate, transaction } from '../src/db.ts';
import { digest, emptyHome, normalize } from '../src/domain.ts';

const database=process.env.LOBBY_TEST_DATABASE_URL;

test('creator-to-fan and operator flows against PostgreSQL',{skip:!database},async t=>{
  const admin=connect(database!);
  const schema='lobby_test_'+randomUUID().replaceAll('-','');
  await admin.query('CREATE SCHEMA '+schema);
  const scoped=new URL(database!);
  scoped.searchParams.set('options','-c search_path='+schema);
  const pool=connect(scoped.href);
  const origin='https://lobby.example.test';
  let now=Date.parse('2027-07-16T17:00:00Z');
  const mail:{to:string;text:string}[]=[];
  const images=new Map<string,Buffer>();
  const app=createApp({pool,origin,redirectOrigins:['https://l1nb.io'],clock:()=>now,mail:async(to,_subject,text)=>{mail.push({to,text});},
    objects:{async write(key,bytes){images.set(key,bytes);},async read(key){return images.get(key)!;}}});
  const get=(path:string,cookie='')=>app.request(origin+path,{headers:cookie?{Cookie:cookie}:{}});
  const post=(path:string,value:Record<string,string>,cookie='',authOrigin=origin)=>app.request(origin+path,{
    method:'POST',headers:{Origin:authOrigin,...(cookie?{Cookie:cookie}:{})},body:new URLSearchParams(value),
  });
  const token=(recipient:string)=>mail.findLast(item=>item.to===recipient)?.text.match(/token=([0-9a-f]{64})/)?.[1];
  const sessionCookie=(response:Response)=>response.headers.get('Set-Cookie')!.split(';')[0];
  const csrf=(cookie:string)=>digest('lobby:csrf:'+cookie.split('=')[1]);
  const change=(action:string,value:object,cookie:string,proof=csrf(cookie))=>app.request(origin+'/api/editor/'+action,{
    method:'POST',headers:{Origin:origin,Cookie:cookie,'X-CSRF-Token':proof,'Content-Type':'application/json'},body:JSON.stringify(value),
  });
  const login=async(email:string,operator=false)=>{
    const asked=await post(operator?'/ops/sign-in':'/sign-in',{mailbox:email});
    assert.equal(asked.status,303);
    const proof=token(email);
    assert.ok(proof);
    const confirmed=await post('/verify',{token:proof});
    assert.equal(confirmed.status,303);
    return sessionCookie(confirmed);
  };
  const creator='Mira@example.test';
  const reviewer='reviewer@example.test', applier='applier@example.test';
  let operator:string, second:string, creatorCookie:string, id:string, revision:number, publication:string, calendarPath:string, imagePath:string, avatar:string;
  const slot=randomUUID(), update=randomUUID();
  const content={...emptyHome,displayName:'Mira Vale',intro:'Cozy strategy, questionable shortcuts.',game:'Hades II',
    theme:'Grove',streamUrl:'https://www.twitch.tv/miravale',links:[{label:'Archive',url:'https://example.test/archive'}],
    updates:[{id:update,text:'One more attempt at the surface route.'}],
    sessions:[{id:slot,title:'Surface route practice',local:'2027-07-17T19:00',zone:'UTC',offset:'+00:00'}]};
  try {
    await migrate(pool);
    await migrate(pool);
    await t.test('invited mailbox, single-use confirmation and private draft',async()=>{
      assert.equal((await post('/sign-in',{mailbox:'unknown@example.test'})).status,303);
      assert.equal(mail.length,0);
      for(const email of [reviewer,applier]) await pool.query('INSERT INTO operators(id,mailbox) VALUES ($1,$2)',[randomUUID(),email]);
      operator=await login(applier,true);
      second=await login(reviewer,true);
      const issued=await post('/ops/invites',{csrf:csrf(operator),mailbox:creator,alias:'Mira synthetic'},operator);
      assert.equal(issued.status,303,await issued.clone().text());
      const enrollment=await (await get('/ops/invites',operator)).text();
      assert.match(enrollment,/Mira synthetic/);
      assert.ok(!enrollment.includes(creator));
      assert.equal((await post('/sign-in',{mailbox:'Mira@EXAMPLE.TEST'})).status,303);
      const proof=token(creator)!;
      assert.ok(proof);
      assert.match(mail.at(-1)!.text,/\/verify#token=/);
      const verifyPage=await get('/verify');
      assert.equal(verifyPage.status,200);
      assert.equal(verifyPage.headers.get('Referrer-Policy'),'same-origin');
      assert.equal((await post('/verify',{token:proof},'','https://other.example')).status,403);
      const race=await Promise.all([post('/verify',{token:proof}),post('/verify',{token:proof})]);
      assert.deepEqual(race.map(r=>r.status).sort(),[303,410]);
      const success=race.find(r=>r.status===303)!;
      const attributes=success.headers.get('Set-Cookie')!.split(';').slice(1).map(x=>x.trim().toLowerCase());
      for(const attribute of ['secure','httponly','samesite=lax']) assert.ok(attributes.includes(attribute));
      creatorCookie=sessionCookie(success);
      const state=await (await get('/api/editor',creatorCookie)).json();
      id=state.id;
      assert.equal(state.draft_revision,0);
      assert.equal((await pool.query('SELECT content FROM drafts WHERE home_id=$1',[id])).rows[0].content.schemaVersion,2);
      assert.equal((await get('/h/'+id)).status,404);
      assert.equal((await get('/api/editor')).status,401);
    });
    await t.test('preview, image derivative, revisions, replay, and retired calendar compatibility',async()=>{
      const tiny=await sharp({create:{width:30,height:30,channels:3,background:'#324384'}}).png().toBuffer();
      const form=new FormData();
      form.set('image',new File([Uint8Array.from(tiny)],'avatar.png',{type:'image/png'}));
      const upload=await app.request(origin+'/api/editor/assets',{method:'POST',headers:{
        Cookie:creatorCookie,Origin:origin,'X-CSRF-Token':csrf(creatorCookie)},body:form});
      assert.equal(upload.status,201,await upload.clone().text());
      avatar=(await upload.json()).id;
      imagePath='/h/'+id+'/images/'+avatar;
      const preview=await post('/editor/preview',{csrf:csrf(creatorCookie),content:JSON.stringify({...content,avatarId:avatar})},creatorCookie);
      assert.equal(preview.status,200);
      assert.match(await preview.text(),/Private preview.*Mira Vale/s);
      assert.equal((await get(imagePath)).status,404);
      const draft={operationId:randomUUID(),revision:0,content:{...content,avatarId:avatar,coverId:avatar}};
      assert.equal((await change('save',draft,creatorCookie,'wrong')).status,403);
      const race=await Promise.all([change('save',draft,creatorCookie),change('save',{...draft,operationId:randomUUID()},creatorCookie)]);
      assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
      // The first command may have lost the race. A read gives the authoritative revision.
      revision=(await (await get('/api/editor',creatorCookie)).json()).draft_revision;
      const request={operationId:randomUUID(),revision,publicationId:null};
      const writes=await Promise.all([change('publish',request,creatorCookie),change('publish',request,creatorCookie)]);
      assert.deepEqual(writes.map(r=>r.status),[200,200]);
      const [first,second]=await Promise.all(writes.map(r=>r.json()));
      assert.deepEqual(first,second);
      publication=first.publicationId;
      assert.equal((await change('publish',{...request,revision:revision+1},creatorCookie)).status,409);
      assert.equal((await pool.query('SELECT count(*)::int n FROM publications')).rows[0].n,1);
      const home=await get('/h/'+id);
      const publicPage=await home.text();
      assert.match(publicPage,/og:title" content="A creator on LINB"/);
      assert.match(publicPage,/data-share/);
      assert.match(publicPage,/Mira Vale.*Signature game: .*Hades II.*Open stream on Twitch.*Surface route practice/s);
      assert.doesNotMatch(publicPage,/Add to calendar/);
      const image=await get(imagePath);
      assert.equal(image.status,200);
      assert.equal(image.headers.get('content-type'),'image/webp');
      calendarPath='/h/'+id+'/calendar/'+slot+'/'+publication+'.ics';
      const file=await get(calendarPath);
      assert.equal(file.status,410);
      assert.match(file.headers.get('content-type')!,/^text\/html/);
      assert.match(await file.text(),/Calendar downloads have ended.*Open creator page/s);
      for(const publicPath of ['/h/'+id,imagePath,calendarPath]) {
        const forwarded=await app.request('https://l1nb.io'+publicPath+'?token=drop');
        assert.equal(forwarded.status,308);
        assert.equal(forwarded.headers.get('location'),origin+publicPath+'#');
      }
      assert.equal((await get(calendarPath.replace(id,'00000000-0000-4000-8000-000000000000'))).status,404);
      now=Date.parse('2027-07-17T19:00:00Z');
      assert.equal((await get(calendarPath)).status,410);
      assert.equal((await get(imagePath)).status,200);
      const quiet=await (await get('/h/'+id)).text();
      assert.doesNotMatch(quiet,/data-card="schedule"/);
      assert.doesNotMatch(quiet,/Add to calendar/);
    });
    await t.test('creator approves exact rich preview and fan submits a private report',async()=>{
      const review=await get('/editor/share?review=1&name=1&image=1',creatorCookie);
      assert.equal(review.status,200);
      const proof=(await review.text()).match(/name="proof" value="([0-9a-f]{64})"/)?.[1];
      assert.ok(proof);
      const consent={csrf:csrf(creatorCookie),publication,proof,action:'enable',name:'1',image:'1'};
      assert.equal((await post('/editor/share',{...consent,intro:'1'},creatorCookie)).status,403);
      assert.equal((await post('/editor/share',consent,creatorCookie)).status,303);
      assert.match(await (await get('/h/'+id)).text(),/og:title" content="Mira Vale"/);
      const image='/h/'+id+'/share-image/'+publication;
      assert.equal((await get(image)).status,200);
      assert.equal((await post('/editor/share',{csrf:csrf(creatorCookie),action:'disable'},creatorCookie)).status,303);
      assert.equal((await get(image)).status,404);
      assert.match(await (await get('/h/'+id)).text(),/og:title" content="A creator on LINB"/);
      const path='/h/'+id+'/report';
      assert.equal((await get(path)).status,200);
      const fields={reason:'Other',detail:'Synthetic report visible only to operators.'};
      assert.equal((await post(path,fields,'','https://other.example')).status,403);
      assert.equal((await post(path,fields)).status,201);
      assert.doesNotMatch(await (await get('/h/'+id)).text(),/Synthetic report/);
      assert.match(await (await get('/ops',operator)).text(),/Synthetic report visible only to operators/);
    });
    await t.test('hold authorization, stale review, and unpublish cannot expose the home',async()=>{
      assert.equal((await get('/api/editor',operator)).status,401);
      const opened=await post('/ops/cases',{csrf:csrf(operator),homeId:id,reviewer,reason:'Private contact information',evidence:'Synthetic exposure fixture.'},operator);
      assert.equal(opened.status,303,await opened.clone().text());
      const path=opened.headers.get('Location')!;
      const act=(action:string,cookie:string,pub='',reason='')=>post(path+'/'+action,{
        csrf:csrf(cookie),operationId:randomUUID(),publicationId:pub,reason,
      },cookie);
      assert.equal((await act('hold',operator)).status,303);
      for(const publicPath of ['/h/'+id,imagePath,calendarPath]) {
        assert.equal((await get(publicPath)).status,404);
        assert.equal((await app.request('https://l1nb.io'+publicPath)).status,404);
      }
      assert.equal((await get(path+'/publication',operator)).status,404);
      assert.equal((await get(path+'/publication',second)).status,200);
      assert.equal((await act('review',second,publication)).status,303);
      const corrected=await change('publish',{operationId:randomUUID(),revision,publicationId:publication},creatorCookie);
      assert.equal(corrected.status,200,await corrected.clone().text());
      const correctedState=await corrected.json();
      assert.equal(correctedState.held,true);
      assert.equal(correctedState.publicPath,null);
      assert.equal((await act('release',second,publication,'Synthetic review')).status,409);
      const removed=await change('unpublish',{operationId:randomUUID(),publicationId:correctedState.publicationId},creatorCookie);
      assert.equal(removed.status,200);
      assert.equal((await get(path+'/publication',second)).status,200);
      assert.equal((await act('review',second)).status,303);
      const republished=await change('publish',{operationId:randomUUID(),revision,publicationId:null},creatorCookie);
      assert.equal(republished.status,200);
      assert.equal((await change('unpublish',{operationId:randomUUID(),publicationId:(await republished.json()).publicationId},creatorCookie)).status,200);
      assert.equal((await act('release',second,'','Stale absence')).status,409);
      assert.equal((await act('review',second)).status,409);
      assert.equal((await get(path+'/publication',second)).status,200);
      assert.equal((await act('review',second)).status,303);
      assert.equal((await act('release',second,'','No current publication')).status,303);
      for(const publicPath of ['/h/'+id,imagePath,calendarPath]) {
        assert.equal((await get(publicPath)).status,404);
        assert.equal((await app.request('https://l1nb.io'+publicPath)).status,404);
      }
      const state=await (await get('/api/editor',creatorCookie)).json();
      assert.equal(state.held,false);
      assert.equal(state.publication_id,null);
    });
    await t.test('mailbox change proves both addresses and revokes creator access',async()=>{
      const next='MiraNew@example.test';
      assert.equal((await post('/account/mailbox',{csrf:csrf(creatorCookie),mailbox:next},creatorCookie)).status,303);
      const currentProof=token(creator)!,newProof=token(next)!;
      assert.notEqual(currentProof,newProof);
      assert.equal((await post('/verify',{token:newProof})).headers.get('Location'),'/account/proof-received');
      assert.equal((await get('/api/editor',creatorCookie)).status,200);
      assert.equal((await post('/verify',{token:currentProof})).headers.get('Location'),'/account/mailbox-changed');
      assert.equal((await get('/api/editor',creatorCookie)).status,401);
      const renewed=await login(next);
      assert.equal((await (await get('/api/editor',renewed)).json()).id,id);
    });
    await t.test('Twitch links only after mailbox proof and returns to the existing home',async()=>{
      const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
      const key={...publicKey.export({format:'jwk'}),kid:'fixture'};
      let nonce='';
      const http=async(input:RequestInfo|URL)=>{
        const path=new URL(String(input)).pathname;
        if(path.endsWith('/keys')) return Response.json({keys:[key]});
        if(path.endsWith('/validate')) return Response.json({client_id:'fixture',user_id:'1001',expires_in:3600});
        if(path.endsWith('/revoke')) return Response.json({});
        if(path.endsWith('/token')) {
          const b64=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
          const unsigned=b64({alg:'RS256',kid:'fixture'})+'.'+b64({iss:'https://id.twitch.tv/oauth2',
            aud:'fixture',sub:'1001',preferred_username:'miravale',nonce,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+600});
          return Response.json({id_token:unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),privateKey).toString('base64url'),access_token:'synthetic-access'});
        }
        return new Response('',{status:404});
      };
      const twitchApp=createApp({pool,origin,mail:async()=>{},twitch:{clientId:'fixture',clientSecret:'fixture',key:Buffer.alloc(32,1),http}});
      const postT=(path:string,value:Record<string,string>,cookie='')=>twitchApp.request(origin+path,{
        method:'POST',headers:{Origin:origin,...(cookie?{Cookie:cookie}:{})},body:new URLSearchParams(value),
      });
      const flow=async(begin:Response,sid='')=>{
        assert.equal(begin.status,303);
        const upstream=new URL(begin.headers.get('Location')!);
        nonce=upstream.searchParams.get('nonce')!;
        const callback=upstream.searchParams.get('redirect_uri')+'?code=example&state='+upstream.searchParams.get('state');
        const cookies=[sessionCookie(begin),sid].filter(Boolean).join('; ');
        return {result:await twitchApp.request(callback,{headers:{Cookie:cookies}}),callback,cookies};
      };
      const unattached=await flow(await postT('/auth/twitch',{}));
      assert.equal(unattached.result.headers.get('Location'),'/sign-in?twitch=mailbox');
      assert.equal((await pool.query('SELECT 1 FROM twitch_identities')).rowCount,0);
      const emailCookie=await login('MiraNew@example.test');
      const linked=await flow(await postT('/account/twitch',{csrf:csrf(emailCookie),action:'link'},emailCookie),emailCookie);
      assert.equal(linked.result.headers.get('Location'),'/account?twitch=linked');
      const signed=await flow(await postT('/auth/twitch',{}));
      assert.equal(signed.result.headers.get('Location'),'/editor');
      const providerCookie=signed.result.headers.getSetCookie().find(x=>x.startsWith('__Host-lobby='))!.split(';')[0];
      const state=await twitchApp.request(origin+'/api/editor',{headers:{Cookie:providerCookie}});
      assert.equal((await state.json()).id,id);
      assert.equal((await get('/api/editor',providerCookie)).status,401);
      const replay=await twitchApp.request(signed.callback,{headers:{Cookie:signed.cookies}});
      assert.equal(replay.headers.get('Location'),'/sign-in?twitch=retry');
      assert.equal((await twitchApp.request(origin+'/ops',{headers:{Cookie:providerCookie}})).status,401);
    });
    await t.test('test Stripe access gates atomic Pro pages and preserves the Free fallback',async()=>{
      const next='MiraNew@example.test';
      const sid=await login(next);
      const state=await (await get('/api/editor',sid)).json();
      const published=await change('publish',{operationId:randomUUID(),revision:state.draft_revision,publicationId:null},sid);
      assert.equal(published.status,200);
      const original=(await published.json()).publicationId;
      const who=(await pool.query('SELECT owner_id FROM homes WHERE id=$1',[id])).rows[0].owner_id;
      let subscriptionStatus='active', fetches=0;
      const http=async(input:RequestInfo|URL)=>{
        const path=new URL(String(input)).pathname;
        if(path.endsWith('/checkout/sessions')) return Response.json({id:'cs_test_fixture',livemode:false,url:'https://checkout.stripe.com/c/pay/cs_test_fixture'});
        if(path.endsWith('/subscriptions/sub_fixture')) {
          fetches++;
          return Response.json({id:'sub_fixture',livemode:false,customer:'cus_fixture',status:subscriptionStatus,
            metadata:{linb_creator:who,linb_publication:original},current_period_end:Math.floor(Date.now()/1000)+3600,
            items:{data:[{price:{id:'price_fixture'}}]}});
        }
        return new Response('',{status:404});
      };
      const config={pool,origin,mail:async()=>{},billing:{secret:'sk_test_fixture',price:'price_fixture',webhookSecret:'whsec_fixture',http},pro:{multipage:true}};
      const product=createApp(config);
      const request=(path:string,values?:Record<string,string>,as=sid)=>product.request(origin+path,{
        headers:{Cookie:as,Origin:origin},...(values?{method:'POST',body:new URLSearchParams({...values,csrf:csrf(as)})}:{}),
      });
      assert.equal((await request('/account/billing',{action:'checkout',approved:'1',publication:original})).headers.get('Location'),
        'https://checkout.stripe.com/c/pay/cs_test_fixture');
      assert.doesNotMatch(await (await request('/account/billing?return=1')).text(),/Test access active/);
      const event=(eventId:string,valid=true)=>{
        const body=JSON.stringify({id:eventId,livemode:false,type:'customer.subscription.updated',data:{object:{id:'sub_fixture'}}});
        const when=Math.floor(Date.now()/1000);
        const sig=createHmac('sha256','whsec_fixture').update(when+'.'+body).digest('hex');
        return product.request(origin+'/webhooks/stripe',{method:'POST',headers:{'Stripe-Signature':'t='+when+',v1='+(valid?sig:'bad')},body});
      };
      assert.equal((await event('evt_fixture_1',false)).status,400);
      assert.equal((await event('evt_fixture_1')).status,200);
      assert.equal((await event('evt_fixture_1')).status,200);
      assert.equal(fetches,1);
      assert.equal((await request('/editor/pro',{version:'0',appearance:'arcade',videoTitle:'A synthetic clip',
        videoUrl:'https://www.youtube.com/watch?v=M7lc1UVf-VE',highlightsTitle:'Highlights',label1:'A creator pick',
        url1:'https://example.test/pick'})).status,303);
      const draft=(await pool.query('SELECT highlights_id,revision FROM pro_drafts WHERE home_id=$1',[id])).rows[0];
      const path='/h/'+id+'/p/'+draft.highlights_id;
      assert.equal((await request(path)).status,404);
      const result=await request('/editor/pro/publish',{revision:String(state.draft_revision),version:String(draft.revision),
        publication:original,operation:randomUUID(),approved:'1'});
      assert.equal(result.status,303,await result.text());
      const page=await request(path);
      assert.equal(page.status,200);
      assert.match(await page.text(),/A synthetic clip.*Load YouTube player/s);
      const home=await (await request('/h/'+id)).text();
      assert.match(home,/A creator pick/);
      assert.doesNotMatch(home,/<iframe/);
      const current=(await (await get('/api/editor',sid)).json()).publication_id;
      const ordinaryPublish=await change('publish',{operationId:randomUUID(),revision:state.draft_revision,publicationId:current},sid);
      assert.equal(ordinaryPublish.status,200);
      assert.equal((await request(path)).status,200);
      assert.match(await (await request('/h/'+id)).text(),/A creator pick/);
      subscriptionStatus='canceled';
      assert.equal((await event('evt_fixture_2')).status,200);
      assert.equal((await request(path)).status,410);
      const free=await (await request('/h/'+id)).text();
      assert.match(free,/Open stream on Twitch/);
      assert.doesNotMatch(free,/A creator pick/);
      subscriptionStatus='active';
      assert.equal((await event('evt_fixture_3')).status,200);
      assert.equal((await request(path)).status,410);
    });
    await t.test('retained Homes map to cards without changing their published revision',async()=>{
      const homeId=randomUUID(), owner=randomUUID(), oldPublication=randomUUID();
      const email='retained@example.test';
      const old=normalize({...emptyHome,displayName:'LongExistingCreatorNameWithoutAnySpaces',intro:'A retained Home.',
        game:'Hades II',streamUrl:'https://www.twitch.tv/retained',theme:'Hearth',
        links:[
          {label:'Official YouTube',url:'https://www.youtube.com/@retained'},
          {label:'TikTok',url:'https://www.tiktok.com/@retained'},
          {label:'Kick',url:'https://kick.com/retained'},
          {label:'Archive video',url:'https://www.youtube.com/watch?v=example'},
        ]});
      await transaction(pool,async client=>{
        await client.query('INSERT INTO creators VALUES ($1,$2)',[owner,email]);
        await client.query('INSERT INTO homes(id,owner_id) VALUES ($1,$2)',[homeId,owner]);
        await client.query('INSERT INTO drafts VALUES ($1,0,$2)',[homeId,old]);
        await client.query('INSERT INTO publications(home_id,id,draft_revision,content) VALUES ($1,$2,0,$3)',[homeId,oldPublication,old]);
        await client.query('UPDATE homes SET publication_id=$2 WHERE id=$1',[homeId,oldPublication]);
      });
      const cookie=await login(email);
      const retained=await (await get('/api/editor',cookie)).json();
      const stable=await (await get('/api/editor',cookie)).json();
      assert.deepEqual(retained.content.layout,stable.content.layout);
      const path='/h/'+homeId;
      const before=await (await get(path)).text();
      assert.match(before,/data-card="identity".*data-card="spotlight".*data-card="dock"/s);
      assert.match(before,/Open stream on Twitch/);
      assert.match(before,/data-platform="youtube"/);
      assert.match(before,/<summary>More channels<\/summary>.*Archive video/s);
      assert.doesNotMatch(before,/Watch live|viewers/);
      assert.equal((await get('/assets/platforms/youtube.svg')).headers.get('content-type')?.split(';')[0],'image/svg+xml');
      assert.equal((await get('/assets/platforms/unknown.svg')).status,404);

      const next=structuredClone(retained.content);
      next.intro='A private card draft.';
      next.layout.identity.avatarPosition='banner-center';
      next.layout.spotlight.size='expanded';
      const promo={family:'promo',id:randomUUID(),hidden:false,size:'expanded',category:'Giveaway',
        title:'Supporter giveaway',description:'Check the details.',url:'https://example.test/giveaway'};
      next.layout.supporting.unshift(promo);
      const phone=await post('/editor/preview',{csrf:csrf(cookie),width:'phone',content:JSON.stringify(next)},cookie);
      assert.equal(phone.status,200,await phone.clone().text());
      const phonePage=await phone.text();
      assert.match(phonePage,/phone-preview/);
      assert.match(phonePage,/data-card="spotlight".*data-size="expanded".*data-card="dock".*data-card="promo".*Supporter giveaway/s);
      const embedded=await post('/editor/preview',{csrf:csrf(cookie),width:'phone',embedded:'1',content:JSON.stringify(next)},cookie);
      assert.equal(embedded.status,200,await embedded.clone().text());
      assert.equal(embedded.headers.get('x-frame-options'),'SAMEORIGIN');
      assert.match(embedded.headers.get('content-security-policy')!,/frame-ancestors 'self'/);
      assert.equal((await post('/editor/preview',{embedded:'1',content:JSON.stringify(next)})).status,401);

      const firstSave={operationId:randomUUID(),revision:0,content:next};
      const invalidLayout=structuredClone(next);
      invalidLayout.layout.supporting.push({...invalidLayout.layout.supporting[1]});
      assert.equal((await change('save',{...firstSave,content:invalidLayout},cookie)).status,422);
      const overBudget=structuredClone(next);
      overBudget.links.push({label:'Extra',url:'https://example.test/extra'});
      assert.equal((await change('save',{...firstSave,content:overBudget},cookie)).status,422);
      assert.equal((await change('save',firstSave,cookie)).status,200);
      const stored=(await pool.query('SELECT content FROM drafts WHERE home_id=$1 ORDER BY revision',[homeId])).rows.map(row=>row.content);
      assert.deepEqual(stored[0],old);
      assert.equal(stored[1].schemaVersion,2);
      assert.equal(stored[1].identity.id,retained.content.layout.identity.id);
      assert.equal(stored[1].supporting[0].id,promo.id);
      assert.equal((await get(path)).status,200);
      assert.equal(await (await get(path)).text(),before);
      assert.equal((await change('save',{...firstSave,operationId:randomUUID()},cookie)).status,409);
      const publish={operationId:randomUUID(),revision:1,publicationId:oldPublication};
      assert.equal((await change('publish',{...publish,publicationId:randomUUID()},cookie)).status,409);
      await pool.query(`CREATE FUNCTION reject_fixture_publication() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'simulated publication failure'; END; $$;
        CREATE TRIGGER reject_fixture_publication BEFORE INSERT ON publications
        FOR EACH ROW EXECUTE PROCEDURE reject_fixture_publication()`);
      try {
        assert.equal((await change('publish',publish,cookie)).status,503);
        assert.equal(await (await get(path)).text(),before);
        const afterFailure=await (await get('/api/editor',cookie)).json();
        assert.equal(afterFailure.draft_revision,1);
        assert.equal(afterFailure.content.intro,next.intro);
      } finally {
        await pool.query('DROP TRIGGER reject_fixture_publication ON publications; DROP FUNCTION reject_fixture_publication()');
      }
      const paused=createApp({pool,origin,mail:async()=>{},readOnlyHomes:true});
      assert.equal((await paused.request(origin+path)).status,200);
      const blocked=await paused.request(origin+'/api/editor/publish',{method:'POST',
        headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':csrf(cookie),'Content-Type':'application/json'},body:JSON.stringify(publish)});
      assert.equal(blocked.status,503);
      assert.equal((await blocked.json()).code,'home_writes_paused');
      const done=await change('publish',publish,cookie);
      assert.equal(done.status,200,await done.clone().text());
      assert.equal((await done.json()).publicPath,path);
      const after=await (await get(path)).text();
      assert.match(after,/A private card draft.*Open stream.*Supporter giveaway/s);
      assert.match(after,/data-avatar-position="banner-center"/);
      const rows=(await pool.query('SELECT content FROM publications WHERE home_id=$1 ORDER BY draft_revision',[homeId])).rows;
      assert.deepEqual(rows[0].content,old);
      assert.equal(rows[1].content.schemaVersion,2);
      const sparse={...next,streamUrl:'',links:[],layout:{...next.layout,supporting:next.layout.supporting.map(card=>({...card,hidden:true}))}};
      const emptyPage=await (await post('/editor/preview',{csrf:csrf(cookie),content:JSON.stringify(sparse)},cookie)).text();
      assert.match(emptyPage,/data-card="identity"/);
      assert.doesNotMatch(emptyPage,/data-card="(?:spotlight|dock|promo|schedule)"/);
    });
  } finally {
    await pool.end();
    await admin.query('DROP SCHEMA '+schema+' CASCADE');
    await admin.end();
  }
});
