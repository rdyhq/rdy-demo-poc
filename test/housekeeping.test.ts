import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { connect, migrate, transaction } from '../src/db.ts';
import { createCreator } from '../src/homes.ts';
import { housekeep } from '../src/housekeeping.ts';

const database=process.env.LOBBY_TEST_DATABASE_URL;

test('housekeeping removes old report text and old limit counts',{skip:!database},async t=>{
  const admin=connect(database!);
  const schema='lobby_test_'+randomUUID().replaceAll('-','');
  await admin.query('CREATE SCHEMA '+schema);
  const scoped=new URL(database!);
  scoped.searchParams.set('options','-c search_path='+schema);
  const pool=connect(scoped.href);
  try {
    await migrate(pool);
    const owner=await transaction(pool,client=>createCreator(client,'reported@example.test'));
    const home=(await pool.query('SELECT id FROM homes WHERE owner_id=$1',[owner])).rows[0].id, publication=randomUUID();
    await pool.query('INSERT INTO publications(home_id,id,draft_revision,content) SELECT home_id,$2,revision,content FROM drafts WHERE home_id=$1',[home,publication]);
    const report=async(age:string)=>{
      const id=randomUUID();
      await pool.query(`INSERT INTO fan_reports(id,home_id,publication_id,reason,detail,created_at) VALUES($1,$2,$3,'Other','A detail.',now()-$4::interval)`,[id,home,publication,age]);
      return id;
    };
    const limit=async(bucket:string,age:string)=>{
      await pool.query(`INSERT INTO rate_limits VALUES($1,date_trunc('hour',now()-$2::interval),1)`,[bucket,age]);
    };
    const detail=async(id:string)=>(await pool.query('SELECT detail FROM fan_reports WHERE id=$1',[id])).rows[0].detail;

    await t.test('the text of a report goes after 30 days, and the report stays',async()=>{
      const old=await report('31 days'), recent=await report('29 days');
      const result=await housekeep(pool);
      assert.equal(result.evidence,1);
      assert.equal(await detail(old),null);
      assert.equal(await detail(recent),'A detail.');
      assert.equal((await pool.query('SELECT count(*)::int n FROM fan_reports')).rows[0].n,2);
    });

    await t.test('a limit count goes after one day, and the count of this hour stays',async()=>{
      await limit('old','26 hours');
      await limit('recent','2 hours');
      await limit('now','0 hours');
      const result=await housekeep(pool);
      assert.equal(result.limits,1);
      assert.deepEqual((await pool.query('SELECT bucket FROM rate_limits ORDER BY bucket')).rows.map(row=>row.bucket),['now','recent']);
    });

    await t.test('a second run changes nothing',async()=>{
      assert.deepEqual(await housekeep(pool),{evidence:0,limits:0});
    });
  } finally {
    await pool.end();
    await admin.query('DROP SCHEMA '+schema+' CASCADE');
    await admin.end();
  }
});
