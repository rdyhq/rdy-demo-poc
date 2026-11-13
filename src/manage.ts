import { randomUUID } from 'node:crypto';
import { connect, migrate, transaction } from './db.ts';
import { mailbox, uuidPattern } from './domain.ts';
import { approveHandle } from './handles.ts';
import { housekeep } from './housekeeping.ts';

const [action,argument,daysArgument,reviewReason,approver]=process.argv.slice(2);
const db=process.env.DATABASE_URL;
if(!db) throw new Error('Set DATABASE_URL.');
const pool=connect(db);
try {
  if(action==='migrate') {
    await migrate(pool);
    console.log('Lobby migrations are current.');
  } else if(action==='designate-operator'||action==='revoke-operator') {
    const email=mailbox(argument);
    if(!email) throw new Error('Enter an operator mailbox.');
    if(action==='designate-operator') {
      await pool.query('INSERT INTO operators(id,mailbox) VALUES ($1,$2) ON CONFLICT (mailbox) DO UPDATE SET active=true',[randomUUID(),email]);
      console.log('Designated operator access enabled.');
    } else {
      await transaction(pool,async client=>{
        await client.query('UPDATE operators SET active=false WHERE mailbox=$1',[email]);
        await client.query(`UPDATE sessions SET revoked_at=now() WHERE operator_id=(SELECT id FROM operators WHERE mailbox=$1)
          AND revoked_at IS NULL`,[email]);
      });
      console.log('Operator access revoked.');
    }
  } else if(action==='approve-handle') {
    await approveHandle(pool,argument??'',daysArgument);
    console.log('Handle approved.');
  } else if(action==='retain-evidence') {
    const days=Number(daysArgument);
    if(!argument||!uuidPattern.test(argument)||!Number.isInteger(days)||days<1||days>30||
        !reviewReason||reviewReason.length>240||!approver||approver.length>120) {
      throw new Error('Enter case ID, extension days (1–30), reason, and reviewing approver.');
    }
    const result=await pool.query(`UPDATE report_cases SET evidence_until=GREATEST(evidence_until,now())+$2::int*interval '1 day',
      evidence_hold_reason=$3,evidence_hold_approver=$4 WHERE id=$1 AND evidence IS NOT NULL`,[argument,days,reviewReason,approver]);
    if(!result.rowCount) throw new Error('No retained case evidence found.');
    console.log('Reviewed evidence extension recorded.');
  } else if(action==='prune-evidence') {
    // The server runs the same step each hour. This command runs it at once.
    console.log('Expired case and fan report evidence removed:',(await housekeep(pool)).evidence);
  } else if(action==='revoke-restored-access') {
    await transaction(pool,async client=>{
      await client.query('UPDATE sessions SET revoked_at=now() WHERE revoked_at IS NULL');
      await client.query('UPDATE access_proofs SET consumed_at=now() WHERE consumed_at IS NULL');
    });
    console.log('Restored sessions and access proofs revoked.');
  } else {
    throw new Error('Use migrate, designate-operator, revoke-operator, approve-handle, retain-evidence, prune-evidence, or revoke-restored-access.');
  }
} finally {
  await pool.end();
}
