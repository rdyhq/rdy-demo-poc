import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { ProContent } from './pro.ts';
import { transaction } from './db.ts';
import { conflict, invalid, mailbox, unavailable, uuidPattern, type HomeContent } from './domain.ts';

const reasons=['Private contact information','Serious safety exposure','Other serious public exposure'];
export const holdReasons=reasons;

async function audit(client:pg.PoolClient,row:any,actor:string,action:string,reason:string|null=null,
    operation:string|null=null,publication:string|null=null) {
  await client.query(`INSERT INTO case_audit(case_id,operator_id,action,reason,operation_id,publication_id,publication_epoch)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`,[row.id,actor,action,reason,operation,publication,row.publication_epoch??null]);
}

export async function openCase(pool:pg.Pool,actor:string,value:any) {
  const reviewer=mailbox(value?.reviewer);
  if (!reviewer) throw invalid('reviewer','Enter the other designated operator’s mailbox.');
  if (typeof value?.homeId!=='string'||!uuidPattern.test(value.homeId)) throw invalid('homeId','Enter the home ID from the public URL.');
  if (!reasons.includes(value.reason)) throw invalid('reason','Choose the reason for review.');
  const evidence=typeof value.evidence==='string'?value.evidence.trim():'';
  if (!evidence || evidence.length>1200) throw invalid('evidence','Enter a short description without unnecessary personal information.');
  return transaction(pool,async client=>{
    const rev=await client.query('SELECT id FROM operators WHERE mailbox=$1 AND active AND id<>$2',[reviewer,actor]);
    if (!rev.rows[0]) throw invalid('reviewer','Choose a different active designated operator.');
    if (!(await client.query('SELECT id FROM homes WHERE id=$1',[value.homeId])).rowCount) throw unavailable();
    const id=randomUUID();
    await client.query(`INSERT INTO report_cases(id,home_id,applier_id,reviewer_id,reason,evidence)
      VALUES ($1,$2,$3,$4,$5,$6)`,[id,value.homeId,actor,rev.rows[0].id,value.reason,evidence]);
    await audit(client,{id},actor,'opened',value.reason);
    return id;
  });
}

export async function cases(pool:pg.Pool,actor:string) {
  const {rows}=await pool.query(`SELECT c.id,c.home_id,c.applier_id,c.reviewer_id,c.reason,c.created_at,
    v.applied_at,v.released_at FROM report_cases c LEFT JOIN visibility_holds v ON v.case_id=c.id
    WHERE $1 IN (c.applier_id,c.reviewer_id) ORDER BY c.created_at DESC LIMIT 100`,[actor]);
  return rows;
}

async function lockCase(client:pg.PoolClient,actor:string,id:string) {
  if (!uuidPattern.test(id)) throw unavailable();
  const {rows}=await client.query(`SELECT c.*,h.publication_id,h.owner_id,
    v.applied_at,v.released_at,v.reviewed_publication_id,v.reviewed_at
    FROM report_cases c JOIN homes h ON h.id=c.home_id LEFT JOIN visibility_holds v ON v.case_id=c.id
    WHERE c.id=$1 AND $2 IN (c.applier_id,c.reviewer_id) FOR UPDATE OF h`,[id,actor]);
  if (!rows[0]) throw unavailable();
  // Read the hold after acquiring the home lock. The joined row may predate a waiting transaction.
  const hold=await client.query('SELECT * FROM visibility_holds WHERE case_id=$1',[id]);
  return {...rows[0],...hold.rows[0],id};
}

export async function caseDetail(pool:pg.Pool,actor:string,id:string) {
  return transaction(pool,async client=>{
    const row=await lockCase(client,actor,id);
    const entries=await client.query('SELECT action,reason,publication_id,created_at FROM case_audit WHERE case_id=$1 ORDER BY id DESC LIMIT 100',[id]);
    return {row,events:entries.rows};
  });
}

export async function inspectPublication(pool:pg.Pool,actor:string,id:string,asset?:string,expected?:string,record=true) {
  return transaction(pool,async client=>{
    const row=await lockCase(client,actor,id);
    if (row.reviewer_id!==actor || !row.applied_at || row.released_at || (expected && expected!==row.publication_id)) throw unavailable();
    let content:HomeContent|null=null,pro:ProContent|null=null;
    if (row.publication_id) {
      const result=await client.query('SELECT content,pro_content FROM publications WHERE home_id=$1 AND id=$2',[row.home_id,row.publication_id]);
      content=result.rows[0]?.content??null;
      pro=result.rows[0]?.pro_content??null;
    }
    if (asset && (!content || ![content.avatarId,content.coverId].includes(asset))) throw unavailable();
    if (record) await audit(client,row,actor,asset?'asset_inspected':'publication_inspected',asset??null,null,row.publication_id);
    return {id:row.home_id,owner:row.owner_id,publicationId:row.publication_id,content,pro};
  });
}

export async function caseAction(pool:pg.Pool,actor:string,id:string,action:'hold'|'review'|'release',value:any) {
  const operation=typeof value?.operationId==='string'&&uuidPattern.test(value.operationId)?value.operationId:null;
  if (!operation) throw invalid('operationId','Enter a valid operation ID.');
  const reason=typeof value?.reason==='string'?value.reason.trim():'';
  if (action==='release'&&(!reason||reason.length>240)) throw invalid('reason','Enter a short release rationale.');
  const expected=value?.publicationId??null;
  if (expected!==null&&(typeof expected!=='string'||!uuidPattern.test(expected))) throw invalid('publicationId','The reviewed publication ID is invalid.');
  return transaction(pool,async client=>{
    const row=await lockCase(client,actor,id);
    if ((action==='hold'?row.applier_id:row.reviewer_id)!==actor) throw unavailable();
    const prior=await client.query('SELECT action,reason,publication_id FROM case_audit WHERE case_id=$1 AND operation_id=$2',[id,operation]);
    if (prior.rows[0]) {
      const record=prior.rows[0];
      if(record.action!==action || (action==='release'&&record.reason!==reason) ||
        (action!=='hold'&&record.publication_id!==expected)) throw conflict('This operation ID was used with different values.');
      return null;
    }
    if(action==='hold') {
      const active=await client.query('SELECT case_id FROM visibility_holds WHERE home_id=$1 AND released_at IS NULL',[row.home_id]);
      if (row.applied_at||active.rowCount) throw conflict('A hold already exists for this home or case.');
      await client.query('INSERT INTO visibility_holds(case_id,home_id) VALUES ($1,$2)',[id,row.home_id]);
      await client.query('INSERT INTO creator_notices(home_id,message) VALUES ($1,$2)',[row.home_id,'Public access is held. Reason: '+row.reason+'.']);
    } else {
      if (!row.applied_at||row.released_at||row.publication_id!==expected) throw conflict('The publication or hold changed. Review the current state.');
      if(action==='review') {
        const seen=await client.query(`SELECT 1 FROM case_audit WHERE case_id=$1 AND operator_id=$2
          AND action='publication_inspected' AND publication_id IS NOT DISTINCT FROM $3::uuid
          AND publication_epoch=$4`,[id,actor,expected,row.publication_epoch]);
        if(!seen.rowCount) throw conflict('Inspect this publication before recording review.');
        await client.query('UPDATE visibility_holds SET reviewed_publication_id=$1,reviewed_at=now() WHERE case_id=$2',[expected,id]);
      } else {
        if(!row.reviewed_at||row.reviewed_publication_id!==expected) throw conflict('Record a current review before releasing the hold.');
        await client.query('UPDATE visibility_holds SET released_at=now() WHERE case_id=$1',[id]);
        await client.query('INSERT INTO creator_notices(home_id,message) VALUES ($1,$2)',[row.home_id,
          expected?'The visibility hold was released. Your reviewed publication is available.':'The visibility hold was released. Your home has no current publication.']);
      }
    }
    await audit(client,row,actor,action,action==='hold'?row.reason:reason||null,operation,action==='hold'?row.publication_id:expected);
    if(action==='release'||action==='hold') {
      const {rows}=await client.query('SELECT mailbox FROM creators WHERE id=$1',[row.owner_id]);
      return rows[0]?.mailbox??null;
    }
    return null;
  });
}
