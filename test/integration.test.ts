import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../src/app.ts';
import { connect, migrate } from '../src/db.ts';
import { digest, emptyHome } from '../src/domain.ts';

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
  const app=createApp({pool,origin,clock:()=>now,mail:async(to,_subject,text)=>{mail.push({to,text});},
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
      assert.equal((await get('/h/'+id)).status,404);
      assert.equal((await get('/api/editor')).status,401);
    });
    await t.test('preview, image derivative, revisions, replay, and calendar expiry',async()=>{
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
      const draft={operationId:randomUUID(),revision:0,content:{...content,avatarId:avatar}};
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
      assert.match(await home.text(),/Mira Vale.*Surface route practice.*Add to calendar/s);
      const image=await get(imagePath);
      assert.equal(image.status,200);
      assert.equal(image.headers.get('content-type'),'image/webp');
      calendarPath='/h/'+id+'/calendar/'+slot+'/'+publication+'.ics';
      const file=await get(calendarPath);
      assert.match(file.headers.get('content-type')!,/^text\/calendar/);
      const ics=await file.text();
      assert.match(ics,/DTSTART:20270717T190000Z/);
      assert.doesNotMatch(ics,/VALARM|DURATION|RRULE/);
      now=Date.parse('2027-07-17T19:00:00Z');
      assert.equal((await get(calendarPath)).status,410);
      assert.equal((await get(imagePath)).status,200);
      const quiet=await (await get('/h/'+id)).text();
      assert.match(quiet,/Next stream is not scheduled/);
      assert.doesNotMatch(quiet,/Add to calendar/);
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
      for(const publicPath of ['/h/'+id,imagePath,calendarPath]) assert.equal((await get(publicPath)).status,404);
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
      for(const publicPath of ['/h/'+id,imagePath,calendarPath]) assert.equal((await get(publicPath)).status,404);
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
  } finally {
    await pool.end();
    await admin.query('DROP SCHEMA '+schema+' CASCADE');
    await admin.end();
  }
});
