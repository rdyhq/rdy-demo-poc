import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { transaction } from './db.ts';
import { conflict, digest, invalid, normalize, unavailable, uuidPattern, type HomeContent } from './domain.ts';

export type HomeState = {
  id:string; owner_id:string; draft_revision:number; publication_id:string|null;
  content:HomeContent; held:boolean; hold_reason:string|null; notice?:string;
};
export type PublicHome = {id:string; owner_id:string; publication_id:string; committed_at:Date; content:HomeContent};
const holdFlag=`EXISTS (SELECT 1 FROM visibility_holds v WHERE v.home_id=h.id AND v.released_at IS NULL)`;
const holdReason=`(SELECT rc.reason FROM visibility_holds v JOIN report_cases rc ON rc.id=v.case_id
  WHERE v.home_id=h.id AND v.released_at IS NULL)`;

async function checkAssets(client: pg.PoolClient,owner:string,content:HomeContent) {
  for (const field of ['avatarId','coverId'] as const) {
    if (!content[field]) continue;
    const {rows}=await client.query('SELECT id FROM assets WHERE id=$1 AND owner_id=$2 AND state=\'ready\'',[content[field],owner]);
    if (!rows[0]) throw invalid(field,'Choose an image that has finished processing.');
  }
}

export async function editor(pool:pg.Pool,owner:string) {
  const {rows}=await pool.query<HomeState>(`SELECT h.*,d.content,${holdFlag} AS held,${holdReason} AS hold_reason,
    (SELECT message FROM creator_notices n WHERE n.home_id=h.id ORDER BY id DESC LIMIT 1) AS notice
    FROM homes h JOIN drafts d ON d.home_id=h.id AND d.revision=h.draft_revision WHERE h.owner_id=$1`,[owner]);
  if (!rows[0]) throw unavailable();
  return rows[0];
}

export async function publicHome(pool:pg.Pool,id:string) {
  if (!uuidPattern.test(id)) throw unavailable();
  const {rows}=await pool.query<PublicHome>(`SELECT h.id,h.owner_id,h.publication_id,p.committed_at,p.content
    FROM homes h JOIN publications p ON p.home_id=h.id AND p.id=h.publication_id
    WHERE h.id=$1 AND NOT ${holdFlag}`,[id]);
  if (!rows[0]) throw unavailable();
  return rows[0];
}

function validateMutation(action:string,value:any) {
  if (!value || typeof value.operationId!=='string'||!uuidPattern.test(value.operationId)) throw invalid('operationId','Provide a valid operation ID.');
  if (action!=='unpublish'&&(!Number.isInteger(value.revision)||value.revision<0||value.revision>2147483646)) {
    throw invalid('revision','Provide a valid draft revision.');
  }
  if (action!=='save'&&value.publicationId!==null&&
      (typeof value.publicationId!=='string'||!uuidPattern.test(value.publicationId))) throw invalid('publicationId','Provide the current publication ID or null.');
}

export async function mutate(pool:pg.Pool,owner:string,action:'save'|'publish'|'unpublish',value:any,now:number) {
  validateMutation(action,value);
  // Keep retry equality independent of JSON field order.
  const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'
    ?Object.fromEntries(Object.keys(v).sort().map(key=>[key,canonical(v[key])])):v;
  const fingerprint=digest(JSON.stringify(canonical({
    action,revision:action==='unpublish'?null:value.revision,
    publicationId:action==='save'?null:value.publicationId,content:action==='save'?value.content:null,
  })));
  return transaction(pool,async client=>{
    const locked=await client.query<HomeState>('SELECT * FROM homes WHERE owner_id=$1 FOR UPDATE',[owner]);
    const home=locked.rows[0];
    if (!home) throw unavailable();
    const previous=await client.query('SELECT fingerprint,response FROM mutation_receipts WHERE home_id=$1 AND operation_id=$2',[home.id,value.operationId]);
    if (previous.rows[0]) {
      if (previous.rows[0].fingerprint!==fingerprint) throw conflict('This operation ID was used with different values.');
      return previous.rows[0].response;
    }
    if (action!=='unpublish'&&home.draft_revision!==value.revision) throw conflict('The draft changed. Compare it before continuing.');
    if (action!=='save'&&home.publication_id!==value.publicationId) throw conflict('The publication changed. Review its current state before continuing.');
    const stored=await client.query<{content:HomeContent}>('SELECT content FROM drafts WHERE home_id=$1 AND revision=$2',[home.id,home.draft_revision]);
    const old=stored.rows[0].content;
    let revision=home.draft_revision, publicationId=home.publication_id;
    if (action==='save') {
      const next=normalize(value.content,old,now);
      await checkAssets(client,owner,next);
      revision++;
      await client.query('INSERT INTO drafts VALUES ($1,$2,$3)',[home.id,revision,next]);
      await client.query('UPDATE homes SET draft_revision=$1 WHERE id=$2',[revision,home.id]);
    }
    if (action==='publish') {
      const next=normalize(old,old,now);
      await checkAssets(client,owner,next);
      for (const update of next.updates) {
        await client.query('INSERT INTO update_dates VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',[home.id,update.id,new Date(now)]);
        const result=await client.query('SELECT first_published_at FROM update_dates WHERE home_id=$1 AND update_id=$2',[home.id,update.id]);
        update.firstPublishedAt=result.rows[0].first_published_at.toISOString();
      }
      publicationId=randomUUID();
      await client.query('INSERT INTO publications(home_id,id,draft_revision,committed_at,content) VALUES ($1,$2,$3,$4,$5)',
        [home.id,publicationId,revision,new Date(now),next]);
    }
    if (action==='unpublish') publicationId=null;
    if (publicationId!==home.publication_id) {
      await client.query('UPDATE homes SET publication_id=$1 WHERE id=$2',[publicationId,home.id]);
      await client.query(`UPDATE visibility_holds SET reviewed_publication_id=NULL,reviewed_at=NULL,publication_epoch=publication_epoch+1
        WHERE home_id=$1 AND released_at IS NULL`,[home.id]);
    }
    const {rows}=await client.query(`SELECT ${holdFlag} AS held FROM homes h WHERE id=$1`,[home.id]);
    const held=rows[0].held as boolean;
    const response={homeId:home.id,revision,publicationId,held,publicPath:publicationId&&!held?'/h/'+home.id:null};
    await client.query('INSERT INTO mutation_receipts VALUES ($1,$2,$3,$4)',[home.id,value.operationId,fingerprint,response]);
    return response;
  });
}

export function refers(content:HomeContent,id:string) {
  return content.avatarId===id||content.coverId===id;
}
