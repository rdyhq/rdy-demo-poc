import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { transaction } from './db.ts';
import { conflict, digest, invalid, scheduleChange, unavailable, uuidPattern, type HomeContent, type ScheduleChange } from './domain.ts';

import { type ProDraft, type ProContent } from './pro.ts';
import { normalizeHome, readHome, writeHome, type EditableHome, type StoredHome } from './home-cards.ts';
import { previewFingerprint, type Selection } from './sharing.ts';

export type HomeState = {
  id:string; owner_id:string; draft_revision:number; publication_id:string|null; published_revision:number|null;
  content:EditableHome; held:boolean; hold_reason:string|null; notice?:string;
};
export type PublicHome = {id:string; owner_id:string; publication_id:string; committed_at:Date; content:EditableHome; schedule_change:ScheduleChange|null};
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
  const {rows}=await pool.query<Omit<HomeState, 'content'> & {content:StoredHome}>(`SELECT h.*,d.content,p.draft_revision AS published_revision,${holdFlag} AS held,${holdReason} AS hold_reason,
    (SELECT message FROM creator_notices n WHERE n.home_id=h.id ORDER BY id DESC LIMIT 1) AS notice
    FROM homes h JOIN drafts d ON d.home_id=h.id AND d.revision=h.draft_revision
    LEFT JOIN publications p ON p.home_id=h.id AND p.id=h.publication_id WHERE h.owner_id=$1`,[owner]);
  if (!rows[0]) throw unavailable();
  return {...rows[0],content:readHome(rows[0].content,rows[0].id)};
}

export async function publicHome(pool:pg.Pool,id:string) {
  if (!uuidPattern.test(id)) throw unavailable();
  const {rows}=await pool.query<Omit<PublicHome, 'content'> & {content:StoredHome}>(`SELECT h.id,h.owner_id,h.publication_id,p.committed_at,p.content,p.schedule_change
    FROM homes h JOIN publications p ON p.home_id=h.id AND p.id=h.publication_id
    WHERE h.id=$1 AND NOT ${holdFlag}`,[id]);
  if (!rows[0]) throw unavailable();
  return {...rows[0],content:readHome(rows[0].content,rows[0].id)};
}

function validateMutation(action:string,value:any) {
  if (!value || typeof value.operationId!=='string'||!uuidPattern.test(value.operationId)) throw invalid('operationId','Provide a valid operation ID.');
  if (action!=='unpublish'&&(!Number.isInteger(value.revision)||value.revision<0||value.revision>2147483646)) {
    throw invalid('revision','Provide a valid draft revision.');
  }
  if (action!=='save'&&value.publicationId!==null&&
      (typeof value.publicationId!=='string'||!uuidPattern.test(value.publicationId))) throw invalid('publicationId','Provide the current publication ID or null.');
}

export async function mutate(pool:pg.Pool,owner:string,action:'save'|'publish'|'unpublish',value:any,now:number,allowPro?:{multipage:boolean}) {
  validateMutation(action,value);
  const proVersion=action==='publish'&&allowPro?value.proVersion:null;
  if(proVersion!=null&&(!Number.isInteger(proVersion)||proVersion<1)) throw invalid('proVersion','Review the saved Pro draft.');
  // Keep retry equality independent of JSON field order.
  const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'
    ?Object.fromEntries(Object.keys(v).sort().map(key=>[key,canonical(v[key])])):v;
  const fingerprint=digest(JSON.stringify(canonical({
    action,revision:action==='unpublish'?null:value.revision,
    publicationId:action==='save'?null:value.publicationId,content:action==='save'?value.content:null,
    ...(proVersion!=null?{proVersion}:{}),
  })));
  return transaction(pool,async client=>{
    const locked=await client.query<Pick<HomeState,'id'|'draft_revision'|'publication_id'>>('SELECT * FROM homes WHERE owner_id=$1 FOR UPDATE',[owner]);
    const home=locked.rows[0];
    if (!home) throw unavailable();
    const previous=await client.query('SELECT fingerprint,response FROM mutation_receipts WHERE home_id=$1 AND operation_id=$2',[home.id,value.operationId]);
    if (previous.rows[0]) {
      if (previous.rows[0].fingerprint!==fingerprint) throw conflict('This operation ID was used with different values.');
      return previous.rows[0].response;
    }
    if (action!=='unpublish'&&home.draft_revision!==value.revision) throw conflict('The draft changed. Compare it before continuing.');
    if (action!=='save'&&home.publication_id!==value.publicationId) throw conflict('The publication changed. Review its current state before continuing.');
    const stored=await client.query<{content:StoredHome}>('SELECT content FROM drafts WHERE home_id=$1 AND revision=$2',[home.id,home.draft_revision]);
    const saved=stored.rows[0].content;
    const old=readHome(saved,home.id);
    let revision=home.draft_revision, publicationId=home.publication_id;
    if (action==='save') {
      const next=normalizeHome(value.content,old,now);
      await checkAssets(client,owner,next);
      revision++;
      await client.query('INSERT INTO drafts VALUES ($1,$2,$3)',[home.id,revision,writeHome(next)]);
      await client.query('UPDATE homes SET draft_revision=$1 WHERE id=$2',[revision,home.id]);
    }
    if (action==='publish') {
      const next=normalizeHome(old,old,now);
      await checkAssets(client,owner,next);
      for (const update of next.updates) {
        await client.query('INSERT INTO update_dates VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',[home.id,update.id,new Date(now)]);
        const result=await client.query('SELECT first_published_at FROM update_dates WHERE home_id=$1 AND update_id=$2',[home.id,update.id]);
        update.firstPublishedAt=result.rows[0].first_published_at.toISOString();
      }
      const consent=await client.query<{selection:Selection;fingerprint:string}>('SELECT selection,fingerprint FROM share_preview_consents WHERE home_id=$1',[home.id]);
      const active=consent.rows[0];
      if(active&&previewFingerprint(next,active.selection)!==active.fingerprint) {
        await client.query('DELETE FROM share_preview_consents WHERE home_id=$1',[home.id]);
      }
      const prior=home.publication_id?await client.query<{content:StoredHome;schedule_change:ScheduleChange|null;pro_content:ProContent|null;pro_grant:string|null}>('SELECT content,schedule_change,pro_content,pro_grant FROM publications WHERE home_id=$1 AND id=$2',
        [home.id,home.publication_id]):null;
      const previousPublication=prior?.rows[0];
      // A Free edit keeps the already-published Pro snapshot. Its grant is checked at read time.
      let pro:ProContent|null=previousPublication?.pro_content??null, grant:string|null=previousPublication?.pro_grant??null;
      if(proVersion!=null) {
        const {rows}=await client.query<ProDraft>('SELECT * FROM pro_drafts WHERE home_id=$1 FOR UPDATE',[home.id]);
        if(!rows[0]||rows[0].revision!==proVersion) throw conflict('The Pro draft changed. Review it again.');
        const entitlement=await client.query(`SELECT grant_id FROM stripe_subscriptions WHERE creator_id=$1
          AND status IN('active','trialing') AND access_until>now()`,[owner]);
        if(!entitlement.rows[0]) throw conflict('Verified test Pro access is required.');
        pro=rows[0].content;
        if(pro&&!allowPro?.multipage) { pro.highlights=null; pro.recommendations=null; }
        grant=entitlement.rows[0].grant_id;
      }
      const notice=scheduleChange(previousPublication?readHome(previousPublication.content,home.id):undefined,next,now,previousPublication?.schedule_change);
      publicationId=randomUUID();
      await client.query(`INSERT INTO publications(home_id,id,draft_revision,committed_at,content,pro_content,pro_grant,schedule_change)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,[home.id,publicationId,revision,new Date(now),saved.schemaVersion===2?writeHome(next):{...next,layout:undefined,aura:undefined},pro,grant,notice]);
      for(const page of [pro?.highlights,pro?.recommendations]) if(page) {
        await client.query('INSERT INTO pro_page_history(home_id,page_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[home.id,page.id]);
      }
    }
    if (action==='unpublish') {
      publicationId=null;
      await client.query('DELETE FROM share_preview_consents WHERE home_id=$1',[home.id]);
    }
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
