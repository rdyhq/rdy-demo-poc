import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { assetBytes, databaseObjects, objectStore, upload } from '../src/assets.ts';
import { connect, migrate, transaction } from '../src/db.ts';
import { createCreator } from '../src/homes.ts';

const database=process.env.LOBBY_TEST_DATABASE_URL;

test('the object store setting picks where pictures are kept',()=>{
  const pool={} as never;
  const r2={R2_ENDPOINT:'https://r2.example.test',R2_BUCKET:'bucket',R2_ACCESS_KEY_ID:'key',R2_SECRET_ACCESS_KEY:'secret'};
  // With no setting, a deployment has no picture storage.
  assert.equal(objectStore({},pool),null);
  assert.ok(objectStore(r2,pool));
  assert.ok(objectStore({LINB_OBJECTS:'database'},pool));
  assert.throws(()=>objectStore({LINB_OBJECTS:'database'},undefined),/LINB_OBJECTS=database requires DATABASE_URL\./);
  assert.throws(()=>objectStore({LINB_OBJECTS:'disk'},pool),/LINB_OBJECTS must be database or unset\./);
  // Two stores at once are a mistake. The server does not pick one by itself.
  assert.throws(()=>objectStore({...r2,LINB_OBJECTS:'database'},pool),/Set either R2 or LINB_OBJECTS=database, not both\./);
});

test('pictures are kept in the database',{skip:!database},async t=>{
  const admin=connect(database!);
  const schema='lobby_test_'+randomUUID().replaceAll('-','');
  await admin.query('CREATE SCHEMA '+schema);
  const scoped=new URL(database!);
  scoped.searchParams.set('options','-c search_path='+schema);
  const pool=connect(scoped.href);
  try {
    await migrate(pool);
    const objects=databaseObjects(pool);
    const key=randomUUID()+'.webp';

    await t.test('a picture that was written is read back',async()=>{
      await objects.write(key,Buffer.from([1,2,3,250]));
      assert.deepEqual([...await objects.read(key)],[1,2,3,250]);
    });

    await t.test('a key is written once',async()=>{
      await assert.rejects(objects.write(key,Buffer.from([9])));
      assert.deepEqual([...await objects.read(key)],[1,2,3,250]);
    });

    await t.test('an unknown key and a malformed key are refused',async()=>{
      await assert.rejects(objects.read(randomUUID()+'.webp'),/Object unavailable/);
      await assert.rejects(objects.read('../secret'),/Invalid object key/);
      await assert.rejects(objects.write('picture.webp',Buffer.from([1])),/Invalid object key/);
      await assert.rejects(pool.query(`INSERT INTO asset_objects(object_key,bytes) VALUES ('picture.webp','\\x01')`));
    });

    await t.test('an upload is stored in the database and served from it',async()=>{
      const owner=await transaction(pool,client=>createCreator(client,'picture@example.test'));
      const png=await sharp({create:{width:40,height:30,channels:3,background:'#9146ff'}}).png().toBuffer();
      const {id}=await upload(pool,objects,owner,new File([Uint8Array.from(png)],'avatar.png',{type:'image/png'}));
      const stored=await pool.query('SELECT octet_length(o.bytes) AS size FROM asset_objects o JOIN assets a ON a.object_key=o.object_key WHERE a.id=$1',[id]);
      assert.equal(stored.rowCount,1);
      const bytes=await assetBytes(pool,objects,owner,id);
      assert.equal(bytes.length,stored.rows[0].size);
      const info=await sharp(Buffer.from(bytes)).metadata();
      assert.deepEqual([info.format,info.width,info.height],['webp',40,30]);
    });
  } finally {
    await pool.end();
    await admin.query('DROP SCHEMA '+schema+' CASCADE');
    await admin.end();
  }
});
