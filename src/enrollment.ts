import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { transaction } from './db.ts';
import { conflict, invalid, mailbox, unavailable, uuidPattern } from './domain.ts';

export async function invite(pool:pg.Pool,operator:string,raw:unknown,alias:unknown) {
  const email=mailbox(raw);
  if(!email) throw invalid('mailbox','Enter a valid mailbox.');
  if(typeof alias!=='string'||!alias.trim()||alias.trim().length>40) throw invalid('alias','Enter a pilot alias of up to 40 characters.');
  return transaction(pool,async client=>{
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[email]);
    if((await client.query('SELECT 1 FROM creators WHERE mailbox=$1',[email])).rowCount) throw conflict('This mailbox already has a creator account.');
    const prior=await client.query(`SELECT id, expires_at>now() AS valid FROM invites WHERE mailbox=$1
      AND consumed_at IS NULL AND revoked_at IS NULL FOR UPDATE`,[email]);
    if(prior.rows[0]?.valid) throw conflict('An invitation already exists. Revoke it before issuing another.');
    if(prior.rows[0]) await client.query('UPDATE invites SET revoked_at=now() WHERE id=$1',[prior.rows[0].id]);
    const id=randomUUID();
    await client.query("INSERT INTO invites(id,mailbox,expires_at) VALUES ($1,$2,now()+interval '7 days')",[id,email]);
    await client.query("INSERT INTO invite_audit(invite_id,operator_id,pilot_alias,action) VALUES ($1,$2,$3,'issued')",[id,operator,alias.trim()]);
    return id;
  });
}

export async function revokeInvite(pool:pg.Pool,operator:string,id:string) {
  if(!uuidPattern.test(id)) throw unavailable();
  return transaction(pool,async client=>{
    const {rows}=await client.query(`SELECT i.mailbox,a.pilot_alias FROM invites i JOIN invite_audit a ON a.invite_id=i.id
      WHERE i.id=$1 AND a.action='issued'`,[id]);
    if(!rows[0]) throw unavailable();
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[rows[0].mailbox]);
    const changed=await client.query('UPDATE invites SET revoked_at=now() WHERE id=$1 AND consumed_at IS NULL AND revoked_at IS NULL',[id]);
    if(!changed.rowCount) throw conflict('This invitation has already been consumed or revoked.');
    await client.query("INSERT INTO invite_audit(invite_id,operator_id,pilot_alias,action) VALUES ($1,$2,$3,'revoked')",[id,operator,rows[0].pilot_alias]);
  });
}

export async function inviteList(pool:pg.Pool) {
  const {rows}=await pool.query(`SELECT i.id,a.pilot_alias,a.created_at,i.consumed_at,i.revoked_at,i.expires_at,
    i.expires_at<=now() AS expired FROM invites i JOIN invite_audit a ON a.invite_id=i.id AND a.action='issued'
    ORDER BY a.created_at DESC LIMIT 100`);
  return rows;
}
