import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { deleteAccount } from '../src/account-deletion.ts';
import { assetBytes, databaseObjects, upload } from '../src/assets.ts';
import { connect, migrate, transaction } from '../src/db.ts';
import { digest } from '../src/domain.ts';
import { createCreator } from '../src/homes.ts';
import { attachTwitch } from '../src/twitch.ts';

const database=process.env.LOBBY_TEST_DATABASE_URL;

test('the deletion of an account removes everything that names it',{skip:!database},async t=>{
  const admin=connect(database!);
  const schema='lobby_test_'+randomUUID().replaceAll('-','');
  await admin.query('CREATE SCHEMA '+schema);
  const scoped=new URL(database!);
  scoped.searchParams.set('options','-c search_path='+schema);
  const pool=connect(scoped.href);
  const removed:string[]=[];
  const store=databaseObjects(pool);
  const objects={...store,async remove(key:string){removed.push(key);await store.remove(key);}};
  const png=await sharp({create:{width:40,height:30,channels:3,background:'#9146ff'}}).png().toBuffer();
  // An account as a streamer leaves it: a linked Twitch account, a handle, a sign-in, a picture and a published page.
  const account=async(mailbox:string,subject:string,login:string)=>{
    const creator=await transaction(pool,async client=>{
      const id=await createCreator(client,mailbox);
      assert.ok(await attachTwitch(client,id,{subject,login}));
      return id;
    });
    const home=(await pool.query('SELECT id FROM homes WHERE owner_id=$1',[creator])).rows[0].id, publication=randomUUID(), session=digest(randomUUID());
    const asset=(await upload(pool,objects,creator,new File([Uint8Array.from(png)],'avatar.png',{type:'image/png'}))).id;
    const key=(await pool.query('SELECT object_key FROM assets WHERE id=$1',[asset])).rows[0].object_key;
    await pool.query('INSERT INTO publications(home_id,id,draft_revision,content) SELECT home_id,$2,revision,content FROM drafts WHERE home_id=$1',[home,publication]);
    await pool.query('UPDATE homes SET publication_id=$2 WHERE id=$1',[home,publication]);
    await pool.query(`INSERT INTO sessions(digest,creator_id,expires_at) VALUES($1,$2,now()+interval '1 hour')`,[session,creator]);
    await pool.query('INSERT INTO twitch_sessions(session_hash,subject,token_box) VALUES($1,$2,$3)',[session,subject,'box']);
    await pool.query(`INSERT INTO twitch_pending VALUES($1,$2,$3,now()+interval '15 minutes')`,[digest(randomUUID()),subject,login]);
    await pool.query(`INSERT INTO access_proofs(digest,purpose,mailbox,creator_id,expires_at) VALUES($1,'login',$2,$3,now()+interval '15 minutes')`,[digest(randomUUID()),mailbox,creator]);
    const change=randomUUID();
    await pool.query('INSERT INTO mailbox_changes(id,creator_id,old_mailbox,new_mailbox) VALUES($1,$2,$3,$4)',[change,creator,mailbox,'next-'+mailbox]);
    await pool.query(`INSERT INTO access_proofs(digest,purpose,mailbox,creator_id,change_id,expires_at) VALUES($1,'mailbox-new',$2,$3,$4,now()+interval '15 minutes')`,
      [digest(randomUUID()),'next-'+mailbox,creator,change]);
    await pool.query(`INSERT INTO invites(id,mailbox,expires_at,consumed_at) VALUES($1,$2,now(),now())`,[randomUUID(),mailbox]);
    await pool.query(`INSERT INTO fan_reports(id,home_id,publication_id,reason,detail) VALUES($1,$2,$3,'Other','A detail.')`,[randomUUID(),home,publication]);
    await pool.query('INSERT INTO update_dates VALUES($1,$2,now())',[home,randomUUID()]);
    await pool.query(`INSERT INTO mutation_receipts VALUES($1,$2,'print','{}')`,[home,randomUUID()]);
    await pool.query(`INSERT INTO creator_notices(home_id,message) VALUES($1,'A notice.')`,[home]);
    await pool.query(`INSERT INTO share_preview_consents(home_id,selection,fingerprint) VALUES($1,'{}','print')`,[home]);
    await pool.query('INSERT INTO pro_drafts(home_id) VALUES($1)',[home]);
    await pool.query('INSERT INTO pro_page_history VALUES($1,$2)',[home,randomUUID()]);
    return {creator,home,mailbox,subject,login,asset,key,publication};
  };
  // Each row of each table as text, to find what still names an account.
  const traces=async(words:string[])=>{
    const {rows}=await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE'`);
    const found:string[]=[];
    for(const {table_name} of rows) for(const word of words) {
      const hit=await pool.query(`SELECT 1 FROM ${table_name} t WHERE t::text LIKE '%'||$1||'%' LIMIT 1`,[word]);
      if(hit.rowCount) found.push(table_name+': '+word);
    }
    return found;
  };
  const names=(a:Awaited<ReturnType<typeof account>>)=>[a.creator,a.home,a.mailbox,a.subject,a.login,a.asset,a.key,a.publication];
  try {
    await migrate(pool);
    const nova=await account('nova@example.test','twitch-id-1001','novabyte'), stays=await account('stays@example.test','twitch-id-2002','staying');

    await t.test('the fixture names the account in each table that can hold it',async()=>{
      const tables=new Set((await traces(names(nova))).map(line=>line.split(':')[0]));
      for(const table of ['creators','homes','drafts','publications','sessions','twitch_identities','twitch_sessions','twitch_pending','access_proofs',
        'mailbox_changes','invites','fan_reports','update_dates','mutation_receipts','creator_notices','share_preview_consents','pro_drafts',
        'pro_page_history','home_handles','assets','asset_objects']) assert.ok(tables.has(table),table);
    });

    await t.test('one step removes each row, and the pictures leave the store',async()=>{
      assert.equal(await deleteAccount(pool,objects,nova.creator),'deleted');
      assert.deepEqual(await traces([...names(nova),'next-nova@example.test']),[]);
      assert.equal((await pool.query(`SELECT 1 FROM twitch_identities WHERE subject='twitch-id-1001'`)).rowCount,0);
      assert.deepEqual(removed,[nova.key]);
    });

    await t.test('another account keeps everything',async()=>{
      const tables=new Set((await traces(names(stays))).map(line=>line.split(':')[0]));
      for(const table of ['creators','homes','publications','sessions','twitch_identities','home_handles','assets','asset_objects','fan_reports']) assert.ok(tables.has(table),table);
      assert.ok((await assetBytes(pool,objects,stays.creator,stays.asset)).length>0);
    });

    await t.test('a second deletion and an unknown account change nothing',async()=>{
      assert.equal(await deleteAccount(pool,objects,nova.creator),'missing');
      assert.equal(await deleteAccount(pool,objects,randomUUID()),'missing');
      assert.equal((await pool.query('SELECT count(*)::int n FROM creators')).rows[0].n,1);
    });

    await t.test('the handle is free, and the person who holds that login takes it again',async()=>{
      assert.equal((await pool.query(`SELECT 1 FROM home_handles WHERE handle='novabyte'`)).rowCount,0);
      const back=await account('nova@example.test','twitch-id-1001','novabyte');
      assert.deepEqual((await pool.query(`SELECT home_id,current FROM home_handles WHERE handle='novabyte'`)).rows,[{home_id:back.home,current:true}]);
    });

    await t.test('a Home with an operator case is deleted only by an operator',async()=>{
      const held=await account('held@example.test','twitch-id-3003','heldpage'), applier=randomUUID(), reviewer=randomUUID(), report=randomUUID();
      await pool.query(`INSERT INTO operators(id,mailbox) VALUES($1,'one@example.test'),($2,'two@example.test')`,[applier,reviewer]);
      await pool.query(`INSERT INTO report_cases(id,home_id,applier_id,reviewer_id,reason) VALUES($1,$2,$3,$4,'A reason.')`,[report,held.home,applier,reviewer]);
      await pool.query('INSERT INTO visibility_holds(case_id,home_id) VALUES($1,$2)',[report,held.home]);
      assert.equal(await deleteAccount(pool,objects,held.creator),'case');
      assert.equal((await pool.query('SELECT 1 FROM creators WHERE id=$1',[held.creator])).rowCount,1);
      assert.equal((await pool.query('SELECT 1 FROM asset_objects WHERE object_key=$1',[held.key])).rowCount,1);
      assert.equal(await deleteAccount(pool,objects,held.creator,{cases:true}),'deleted');
      assert.deepEqual(await traces([...names(held),report]),[]);
      assert.equal((await pool.query('SELECT count(*)::int n FROM operators')).rows[0].n,2);
    });

    await t.test('an account with a subscription record of the billing test is not deleted',async()=>{
      const paid=await account('paid@example.test','twitch-id-4004','paidpage');
      await pool.query(`INSERT INTO stripe_subscriptions(creator_id,stripe_subscription_id,stripe_customer_id,status) VALUES($1,'sub_test','cus_test','active')`,[paid.creator]);
      assert.equal(await deleteAccount(pool,objects,paid.creator),'billing');
      assert.equal((await pool.query('SELECT 1 FROM homes WHERE id=$1',[paid.home])).rowCount,1);
    });
  } finally {
    await pool.end();
    await admin.query('DROP SCHEMA '+schema+' CASCADE');
    await admin.end();
  }
});
