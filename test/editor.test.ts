import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../src/app.ts';
import { connect, migrate } from '../src/db.ts';
import { digest } from '../src/domain.ts';

const database=process.env.LOBBY_TEST_DATABASE_URL;

test('the editor is a list with a preview, and each change saves by itself',{skip:!database},async t=>{
  const admin=connect(database!);
  const schema='lobby_test_'+randomUUID().replaceAll('-','');
  await admin.query('CREATE SCHEMA '+schema);
  const scoped=new URL(database!);
  scoped.searchParams.set('options','-c search_path='+schema);
  const pool=connect(scoped.href);
  const origin='https://lobby.example.test';
  const mail:{to:string;text:string}[]=[];
  const images=new Map<string,Buffer>();
  const base={pool,origin,mail:async(to:string,_subject:string,text:string)=>{mail.push({to,text});},
    objects:{async write(name:string,bytes:Buffer){images.set(name,bytes);},async read(name:string){return images.get(name)!;}}};
  const app=createApp(base);
  const csrf=(cookie:string)=>digest('lobby:csrf:'+cookie.split('=')[1]);
  const get=(path:string,cookie='',target=app)=>target.request(origin+path,{headers:cookie?{Cookie:cookie}:{}});
  const post=(path:string,value:Record<string,string>,cookie='',target=app)=>target.request(origin+path,{method:'POST',
    headers:{Origin:origin,...(cookie?{Cookie:cookie}:{})},body:new URLSearchParams(value)});
  const login=async(email:string,operator=false)=>{
    await post(operator?'/ops/sign-in':'/sign-in',{mailbox:email});
    const proof=mail.findLast(item=>item.to===email)!.text.match(/token=([0-9a-f]{64})/)![1];
    return (await post('/verify',{token:proof})).headers.get('Set-Cookie')!.split(';')[0];
  };
  const draft=async()=>(await pool.query(`SELECT h.id,h.draft_revision,h.publication_id,d.content FROM homes h
    JOIN drafts d ON d.home_id=h.id AND d.revision=h.draft_revision`)).rows[0];
  try {
    await migrate(pool);
    await pool.query('INSERT INTO operators(id,mailbox) VALUES ($1,$2)',[randomUUID(),'ops@example.test']);
    const ops=await login('ops@example.test',true);
    assert.equal((await post('/ops/invites',{csrf:csrf(ops),mailbox:'nova@example.test',alias:'nova'},ops)).status,303);
    const nova=await login('nova@example.test');
    const send=(path:string,value:Record<string,string>)=>post(path,{csrf:csrf(nova),...value},nova);

    await t.test('the Page tab shows the profile, the links and a preview',async()=>{
      assert.equal((await get('/editor')).status,401);
      const page=await get('/editor',nova);
      assert.equal(page.status,200);
      const html=await page.text();
      assert.match(html,/<nav class="ed-tabs" aria-label="Editor"><a href="\/editor" aria-current="page">Page<\/a><a href="\/editor\/look">Look<\/a><a href="\/editor\/link">Share<\/a><\/nav>/);
      assert.match(html,/<h1>Your page<\/h1>/);
      assert.match(html,/<form class="ed-row ed-profile" method="post" action="\/editor\/profile">/);
      // A creator with no linked Twitch channel has no parts from Twitch.
      assert.doesNotMatch(html,/From Twitch|Synced with Twitch/);
      for(const field of ['displayName','intro','game','streamUrl']) assert.match(html,new RegExp('name="'+field+'"'));
      assert.match(html,/<iframe class="ed-preview" title="Preview of your page" src="\/editor\/view"><\/iframe>/);
      assert.match(page.headers.get('Content-Security-Policy')!,/frame-src 'self'/);
      // The old editor is gone from this page.
      assert.doesNotMatch(html,/lobby\.css|editor\.js|Edit canvas|Inspector/);
      assert.match(html,/href="\/assets\/app\.css\?v=[\w-]+"/);
    });

    await t.test('the profile saves to the draft with no other step',async()=>{
      const profile={displayName:'NovaByte',intro:'Speedruns and bad puns.',game:'Neon Drift 2',streamUrl:'https://www.twitch.tv/novabyte'};
      assert.equal((await post('/editor/profile',profile,nova)).status,403);
      const saved=await send('/editor/profile',profile);
      assert.equal(saved.status,303);
      assert.equal(saved.headers.get('Location'),'/editor');
      const {draft_revision,content}=await draft();
      assert.equal(draft_revision,1);
      assert.deepEqual([content.identity.displayName,content.identity.intro,content.identity.game,content.spotlight.url],
        ['NovaByte','Speedruns and bad puns.','Neon Drift 2','https://www.twitch.tv/novabyte']);
      const empty=await send('/editor/profile',{...profile,displayName:''});
      assert.equal(empty.status,422);
      assert.match(await empty.text(),/role="alert">Enter 1 to 40 characters\./);
      assert.equal((await draft()).draft_revision,1);
      assert.match(await (await get('/editor',nova)).text(),/<input id="ed-name" name="displayName" required maxlength="40" value="NovaByte">/);
    });

    await t.test('the creator adds, reorders and removes links',async()=>{
      assert.equal((await send('/editor/links',{action:'add',label:'YouTube',url:'https://www.youtube.com/@novabyte'})).status,303);
      assert.equal((await send('/editor/links',{action:'add',label:'Merch',url:'https://example.test/shop'})).status,303);
      const html=await (await get('/editor',nova)).text();
      assert.match(html,/<li class="ed-row ed-link">.*?<strong>YouTube<\/strong><small>youtube\.com\/@novabyte<\/small>.*?<\/li>\s*<li class="ed-row ed-link">.*?<strong>Merch<\/strong>/s);
      assert.equal((await send('/editor/links',{action:'up',index:'1'})).status,303);
      assert.deepEqual((await draft()).content.dock.links.map((link:{label:string})=>link.label),['Merch','YouTube']);
      assert.equal((await send('/editor/links',{action:'remove',index:'0'})).status,303);
      assert.deepEqual((await draft()).content.dock.links,[{label:'YouTube',url:'https://www.youtube.com/@novabyte'}]);
      const wrong=await send('/editor/links',{action:'add',label:'Bad',url:'not a link'});
      assert.equal(wrong.status,422);
      assert.match(await wrong.text(),/role="alert">/);
      assert.equal((await send('/editor/links',{action:'remove',index:'7'})).status,422);
    });

    await t.test('the creator chooses what leads the card while offline',async()=>{
      const tab=await (await get('/editor',nova)).text();
      assert.match(tab,/<h2>Offline card<\/h2>/);
      // A creator with no linked Twitch channel is not offered the latest clip (RDY D-6DX8J).
      assert.ok(tab.includes('<select id="ed-lead" name="lead"><option value="next" selected>Next stream</option><option value="link:0">Link: YouTube</option></select>'));
      assert.equal((await send('/editor/lead',{lead:'link:0'})).status,303);
      let spotlight=(await draft()).content.spotlight;
      assert.deepEqual([spotlight.offlineLead,spotlight.offlineLink],['link','https://www.youtube.com/@novabyte']);
      assert.match(await (await get('/editor',nova)).text(),/<option value="next">Next stream<\/option><option value="link:0" selected>Link: YouTube<\/option>/);
      assert.ok((await (await get('/editor/view',nova)).text()).includes(
        '<p class="pg-card-kicker">Featured link</p><p class="pg-card-title"><a href="https://www.youtube.com/@novabyte">YouTube</a></p>'));
      assert.equal((await send('/editor/lead',{lead:'next'})).status,303);
      spotlight=(await draft()).content.spotlight;
      assert.deepEqual([spotlight.offlineLead,spotlight.offlineLink],['next',null]);
      for(const lead of ['link:7','link:x','clip','other','']) {
        const refused=await send('/editor/lead',{lead});
        assert.equal(refused.status,422,lead);
        assert.match(await refused.text(),/role="alert">/);
      }
    });

    await t.test('the creator adds a session to the schedule and takes one off',async()=>{
      type Stored={id:string;title:string;local:string;zone:string;offset:string;instant:string};
      const schedule=async()=>(await draft()).content.supporting.find((card:{family:string})=>card.family==='schedule') as {sessions:Stored[];scheduleRemoval?:string};
      const add=(title:string,date:string,time:string,zone='America/Phoenix')=>send('/editor/sessions',{action:'add',title,date,time,zone});
      const tab=await (await get('/editor',nova)).text();
      assert.match(tab,/<h2>Schedule<\/h2>/);
      assert.match(tab,/<details class="ed-row ed-more-form"><summary>Add a session<\/summary>/);
      // With no session yet, the zone starts at UTC and the script picks the zone of the browser.
      assert.match(tab,/<select id="ed-zone" name="zone" data-zone="auto"><option value="UTC" selected>UTC<\/option>.*<option value="America\/Phoenix">America\/Phoenix<\/option>/s);
      assert.match(tab,/<script src="\/assets\/zone\.js" defer><\/script>/);
      assert.equal((await get('/assets/zone.js')).status,200);

      assert.equal((await add('Saturday speedrun block','2099-07-18','19:00')).status,303);
      const first=(await schedule()).sessions;
      assert.deepEqual(first.map(({id,...rest})=>rest),[{title:'Saturday speedrun block',local:'2099-07-18T19:00',zone:'America/Phoenix',
        offset:'-07:00',instant:'2099-07-19T02:00:00.000Z'}]);
      const listed=await (await get('/editor',nova)).text();
      assert.match(listed,/<li class="ed-row ed-link">.*?<strong>Saturday speedrun block<\/strong><small>2099-07-18 19:00 · America\/Phoenix<\/small>/s);
      // The next session starts in the zone of the last one.
      assert.match(listed,/<select id="ed-zone" name="zone"><option value="UTC">UTC<\/option>.*<option value="America\/Phoenix" selected>America\/Phoenix<\/option>/s);
      assert.match(await (await get('/editor/view',nova)).text(),/class="pg-h">Schedule.*Saturday speedrun block/s);

      // A session needs a title, a real date, a time, a named zone and a start in the future.
      for(const [title,date,time,zone] of [['Past','2020-01-01','10:00','UTC'],['','2099-07-19','10:00','UTC'],['Wrong date','2099-02-31','10:00','UTC'],
        ['Wrong zone','2099-07-19','10:00','Mars/Base'],['No time','2099-07-19','','UTC']]) {
        const refused=await add(title,date,time,zone);
        assert.equal(refused.status,422,title);
        assert.match(await refused.text(),/role="alert">/);
      }
      // Seven sessions at most.
      for(let day=1;day<=6;day++) assert.equal((await add('Extra '+day,'2099-08-0'+day,'10:00','UTC')).status,303);
      assert.equal((await add('One too many','2099-08-09','10:00','UTC')).status,422);
      assert.equal((await schedule()).sessions.length,7);

      // Cancel says that the session is cancelled. Postpone says that its new time is not known.
      const all=(await schedule()).sessions;
      assert.equal((await send('/editor/sessions',{action:'cancel',id:all[0].id})).status,303);
      assert.equal((await schedule()).scheduleRemoval,'cancelled');
      assert.equal((await send('/editor/sessions',{action:'postpone',id:all[1].id})).status,303);
      const left=await schedule();
      assert.equal(left.scheduleRemoval,'unknown');
      assert.deepEqual(left.sessions.map(session=>session.title),['Extra 2','Extra 3','Extra 4','Extra 5','Extra 6']);
      assert.equal((await send('/editor/sessions',{action:'cancel',id:randomUUID()})).status,422);
      assert.equal((await send('/editor/sessions',{action:'move',id:all[2].id})).status,422);
      for(const session of left.sessions) assert.equal((await send('/editor/sessions',{action:'cancel',id:session.id})).status,303);
      assert.equal((await schedule()).sessions.length,0);
      assert.doesNotMatch(await (await get('/editor/view',nova)).text(),/class="pg-h">Schedule/);
    });

    await t.test('the creator sets and removes the avatar and the banner',async()=>{
      const png=await sharp({create:{width:300,height:300,channels:3,background:'#190838'}}).png().toBuffer();
      const form=new FormData();
      form.set('csrf',csrf(nova));
      form.set('kind','avatar');
      form.set('image',new File([Uint8Array.from(png)],'avatar.png',{type:'image/png'}));
      const uploaded=await app.request(origin+'/editor/art',{method:'POST',headers:{Origin:origin,Cookie:nova},body:form});
      assert.equal(uploaded.status,303,await uploaded.clone().text());
      const avatar=(await draft()).content.identity.avatarId;
      assert.ok(avatar);
      assert.match(await (await get('/editor',nova)).text(),new RegExp('<img class="ed-art" src="/editor/assets/'+avatar+'" alt="">'));
      assert.equal((await send('/editor/art',{kind:'avatar',action:'remove'})).status,303);
      assert.equal((await draft()).content.identity.avatarId,null);
      assert.equal((await send('/editor/art',{kind:'logo',action:'remove'})).status,422);
    });

    await t.test('the preview shows the draft, and Publish puts it on the public page',async()=>{
      const view=await get('/editor/view',nova);
      assert.equal(view.status,200);
      const preview=await view.text();
      assert.match(preview,/class="pg-name">NovaByte/);
      assert.doesNotMatch(preview,/Report this page|pg-sheet/);
      assert.match(view.headers.get('Content-Security-Policy')!,/frame-ancestors 'self'/);
      const before=await (await get('/editor',nova)).text();
      assert.match(before,/<span class="ed-state">Not published<\/span>/);
      const {id}=await draft();
      assert.equal((await get('/h/'+id)).status,404);
      const published=await send('/editor/publish',{});
      assert.equal(published.status,303);
      assert.equal((await get('/h/'+id)).status,200);
      assert.match(await (await get('/editor',nova)).text(),/<span class="ed-state">Published<\/span>/);
      await send('/editor/links',{action:'add',label:'Discord',url:'https://discord.gg/example'});
      assert.match(await (await get('/editor',nova)).text(),/<span class="ed-state">Changes not published<\/span>/);
      assert.doesNotMatch(await (await get('/h/'+id)).text(),/Discord/);
    });

    await t.test('the Look tab offers the themes and matches the art again',async()=>{
      const look=await get('/editor/look',nova);
      assert.equal(look.status,200);
      const html=await look.text();
      assert.match(html,/<a href="\/editor\/look" aria-current="page">Look<\/a>/);
      assert.match(html,/<input type="radio" name="look" value="Nebula" checked>/);
      assert.doesNotMatch(html,/value="art"/);
      assert.equal((await send('/editor/look',{look:'Tide'})).status,303);
      assert.equal((await draft()).content.skin,'Tide');
      assert.equal((await send('/editor/look',{look:'Neon'})).status,422);
      // With no art, the match has nothing to read.
      const none=await send('/editor/look',{action:'match'});
      assert.equal(none.status,422);
      assert.match(await none.text(),/role="alert">Add an avatar or a banner first\./);
      const banner=await sharp({create:{width:1200,height:400,channels:3,background:'#190838'}})
        .composite([{input:{create:{width:400,height:400,channels:3,background:'#ff3d9a'}},left:0,top:0}]).png().toBuffer();
      const form=new FormData();
      form.set('csrf',csrf(nova));
      form.set('kind','banner');
      form.set('image',new File([Uint8Array.from(banner)],'banner.png',{type:'image/png'}));
      assert.equal((await app.request(origin+'/editor/art',{method:'POST',headers:{Origin:origin,Cookie:nova},body:form})).status,303);
      assert.equal((await send('/editor/look',{action:'match'})).status,303);
      const {content}=await draft();
      assert.deepEqual([content.skin,content.aura.accentSource],['Nebula','art']);
      // The stored banner is a compressed copy, so its colour can differ from the upload by a step or two.
      const channels=(color:string)=>[1,3,5].map(at=>parseInt(color.slice(at,at+2),16));
      const base=channels(content.aura.palette.base);
      assert.ok(channels('#190838').every((value,index)=>Math.abs(value-base[index])<=3),content.aura.palette.base);
      const matched=await (await get('/editor/look',nova)).text();
      assert.match(matched,/<input type="radio" name="look" value="art" checked>/);
    });

    await t.test('the Share tab shows the address and can take the page down',async()=>{
      await send('/editor/publish',{});
      const share=await get('/editor/link',nova);
      assert.equal(share.status,200);
      const html=await share.text();
      const {id}=await draft();
      assert.match(html,new RegExp('<input id="address" aria-label="The address of your page" readonly value="lobby\\.example\\.test/h/'+id+'">'));
      assert.match(html,/<button class="ed-quiet">Take my page down<\/button>/);
      // The creator can copy the address or hand it to the share sheet of the device. Both buttons show when the script runs.
      assert.match(html,/<div class="ed-share" data-share data-url="https:\/\/lobby\.example\.test\/h\/[0-9a-f-]+">/);
      assert.match(html,/<button type="button" class="ed-secondary" data-copy hidden>Copy<\/button><button type="button" class="ed-secondary" data-system-share hidden>Share<\/button>/);
      assert.match(html,/<p class="ed-fine" role="status"><\/p>/);
      assert.match(html,/<script src="\/assets\/share\.js\?v=2" defer><\/script>/);
      // The link preview and the texts to share have the look of the editor.
      assert.match(html,/<a href="\/editor\/share">Link preview and texts to share<\/a>/);
      const texts=await (await get('/editor/share',nova)).text();
      assert.match(texts,/<body class="ed">/);
      assert.match(texts,/<h1>Share your link<\/h1>/);
      assert.match(texts,/<h2>Link preview<\/h2>/);
      assert.match(texts,/<nav class="ed-tabs" aria-label="Editor"><a href="\/editor">Page<\/a><a href="\/editor\/look">Look<\/a><a href="\/editor\/link" aria-current="page">Share<\/a><\/nav>/);
      assert.doesNotMatch(texts,/lobby\.css|class="panel|<iframe/);
      assert.equal((await send('/editor/unpublish',{})).status,303);
      assert.equal((await get('/h/'+id)).status,404);
      assert.match(await (await get('/editor/link',nova)).text(),/Your page is not published\./);
    });

    await t.test('the account has the look of the editor, and the editor leads to it',async()=>{
      assert.match(await (await get('/editor',nova)).text(),/<a class="ed-account" href="\/account">Account<\/a>/);
      const account=await get('/account',nova);
      assert.equal(account.status,200);
      const html=await account.text();
      assert.match(html,/<body class="ed">/);
      assert.match(html,/<a class="ed-account" href="\/account" aria-current="page">Account<\/a>/);
      assert.match(html,/<h1>Account<\/h1>/);
      assert.match(html,/<p>Your sign-in email: <strong>nova@example\.test<\/strong><\/p>/);
      assert.match(html,/<form class="ed-inline" method="post" action="\/account\/mailbox">/);
      assert.match(html,/<form method="post" action="\/logout"><input type="hidden" name="csrf" value="[0-9a-f]+"><button class="ed-quiet">Sign out<\/button><\/form>/);
      // The account is one column. It has no preview of the page.
      assert.match(html,/<div class="ed-body ed-solo">/);
      assert.doesNotMatch(html,/lobby\.css|class="panel|<iframe|Creator workspace/);
      // The sign-out ends the session.
      assert.equal((await get('/account')).status,401);
    });

    await t.test('paused Home changes refuse each editor action',async()=>{
      const paused=createApp({...base,readOnlyHomes:true});
      for(const [path,value] of [['/editor/profile',{displayName:'X',intro:'',game:'',streamUrl:''}],['/editor/links',{action:'remove',index:'0'}],
        ['/editor/publish',{}],['/editor/look',{look:'Paper'}]] as const) {
        assert.equal((await post(path,{csrf:csrf(nova),...value},nova,paused)).status,503,path);
      }
    });
  } finally {
    await pool.end();
    await admin.query('DROP SCHEMA '+schema+' CASCADE');
    await admin.end();
  }
});
