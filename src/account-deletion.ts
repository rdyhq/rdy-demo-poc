import type pg from 'pg';
import type { Objects } from './assets.ts';
import { transaction } from './db.ts';

// 'case': the Home has an operator's case, which is restricted incident evidence. 'billing': a subscription record exists.
export type Deletion='deleted'|'case'|'billing'|'missing';

// Removes an account and every row that names it (RDY D-JH1V5, r-3SS2T). One transaction: all of it goes, or none.
// A new table that holds data of a creator or of a Home needs a line here. The test scans each table for what remains.
export async function deleteAccount(pool:pg.Pool,objects:Objects|null,creator:string,options:{cases?:boolean}={}):Promise<Deletion> {
  const keys:string[]=[];
  const result=await transaction(pool,async client=>{
    const {rows}=await client.query<{mailbox:string;home:string}>(`SELECT c.mailbox,h.id AS home FROM creators c JOIN homes h ON h.owner_id=c.id
      WHERE c.id=$1 FOR UPDATE OF c,h`,[creator]);
    const account=rows[0];
    if(!account) return 'missing' as const;
    const {mailbox,home}=account;
    // A deletion must not leave a subscription that still runs at the payment provider.
    if((await client.query('SELECT 1 FROM stripe_subscriptions WHERE creator_id=$1',[creator])).rowCount) return 'billing' as const;
    const cases=await client.query('SELECT 1 FROM report_cases WHERE home_id=$1',[home]);
    if(cases.rowCount&&!options.cases) return 'case' as const;

    // The sign-ins, the proofs and the link to Twitch. A sign-in at Twitch goes with its session.
    await client.query('DELETE FROM sessions WHERE creator_id=$1',[creator]);
    await client.query(`DELETE FROM access_proofs WHERE creator_id=$1 OR change_id IN (SELECT id FROM mailbox_changes WHERE creator_id=$1)
      OR (purpose<>'operator' AND lower(mailbox)=lower($2))`,[creator,mailbox]);
    await client.query('DELETE FROM mailbox_changes WHERE creator_id=$1',[creator]);
    await client.query('DELETE FROM twitch_pending WHERE subject IN (SELECT subject FROM twitch_identities WHERE creator_id=$1)',[creator]);
    await client.query('DELETE FROM twitch_identities WHERE creator_id=$1',[creator]);
    await client.query('DELETE FROM billing_attempts WHERE creator_id=$1 OR home_id=$2',[creator,home]);

    // The Home and what hangs on it. Its handles go too, so the address is free (RDY r-QEHWD).
    await client.query('UPDATE homes SET publication_id=NULL WHERE id=$1',[home]);
    for(const table of ['update_dates','mutation_receipts','creator_notices','share_preview_consents','pro_drafts','pro_page_history',
      'home_handles','fan_reports']) await client.query('DELETE FROM '+table+' WHERE home_id=$1',[home]);
    if(cases.rowCount) {
      await client.query('DELETE FROM case_audit WHERE case_id IN (SELECT id FROM report_cases WHERE home_id=$1)',[home]);
      await client.query('DELETE FROM visibility_holds WHERE home_id=$1',[home]);
      await client.query('DELETE FROM report_cases WHERE home_id=$1',[home]);
    }
    await client.query('DELETE FROM publications WHERE home_id=$1',[home]);
    // The Home points at its draft with a deferred check, so the draft can go first.
    await client.query('DELETE FROM drafts WHERE home_id=$1',[home]);
    await client.query('DELETE FROM homes WHERE id=$1',[home]);

    // The pictures. Their bytes go here when the database keeps them.
    const assets=await client.query<{object_key:string}>('DELETE FROM assets WHERE owner_id=$1 RETURNING object_key',[creator]);
    keys.push(...assets.rows.map(row=>row.object_key));
    await client.query('DELETE FROM asset_objects WHERE object_key=ANY($1)',[keys]);

    // An invitation holds the email.
    await client.query('DELETE FROM invite_audit WHERE invite_id IN (SELECT id FROM invites WHERE lower(mailbox)=lower($1))',[mailbox]);
    await client.query('DELETE FROM invites WHERE lower(mailbox)=lower($1)',[mailbox]);
    await client.query('DELETE FROM creators WHERE id=$1',[creator]);
    return 'deleted' as const;
  });
  // An object store outside the database loses each picture after the account is gone.
  if(result==='deleted'&&objects) await Promise.allSettled(keys.map(key=>objects.remove(key)));
  return result;
}
