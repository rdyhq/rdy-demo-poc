import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { consumePendingTwitch } from './twitch.ts';
import { transaction } from './db.ts';
import { createCreator } from './homes.ts';
import { AppError, conflict, digest, invalid, mailbox, secret, tokenPattern } from './domain.ts';

export type SendMail = (to: string, subject: string, text: string) => Promise<void>;
type Purpose = 'login' | 'operator' | 'mailbox-old' | 'mailbox-new';
type Principal = { creator_id: string | null; operator_id: string | null };
const badProof=()=>new AppError(410,'invalid_proof','This link is not valid. Request a new link.');
const notSignedIn=()=>new AppError(401,'sign_in','Sign in again to continue.');

// One counter for each key and hour. The answer is empty once the key has reached its limit.
export async function throttle(client: pg.Pool | pg.PoolClient, key: string, limit: number) {
  const {rows}=await client.query(`INSERT INTO rate_limits VALUES ($1,date_trunc('hour',now()),1)
    ON CONFLICT (bucket,hour) DO UPDATE SET attempts=rate_limits.attempts+1
    WHERE rate_limits.attempts<$2 RETURNING attempts`,[digest(key),limit]);
  return rows.length>0;
}

// Sign-in forgives letter case only when it cannot choose between two accounts.
export function storedMailbox(typed:string,stored:string[]) {
  const distinct=[...new Set(stored)];
  if (distinct.includes(typed)) return typed;
  return distinct.length===1?distinct[0]:null;
}

async function newProof(client: pg.PoolClient,purpose: Purpose,email: string,creator: string|null,change: string|null) {
  const token=secret();
  await client.query(`INSERT INTO access_proofs(digest,purpose,mailbox,creator_id,change_id,expires_at)
    VALUES ($1,$2,$3,$4,$5,now()+interval '15 minutes')`,[digest(token),purpose,email,creator,change]);
  return token;
}

async function session(client: pg.PoolClient,creator: string|null,operator: string|null) {
  const sid=secret();
  await client.query(`INSERT INTO sessions(digest,creator_id,operator_id,expires_at,mailbox_proved_at)
    VALUES ($1,$2,$3,now()+interval '7 days',now())`,[digest(sid),creator,operator]);
  return sid;
}

export class Auth {
  pool: pg.Pool;
  send: SendMail;
  origin: string;
  twitchEnabled: boolean;
  readOnlyHomes: boolean;
  constructor(pool: pg.Pool,send: SendMail,origin: string,twitchEnabled=false,readOnlyHomes=false) {
    this.pool=pool;
    this.send=send;
    this.origin=origin;
    this.twitchEnabled=twitchEnabled;
    this.readOnlyHomes=readOnlyHomes;
  }

  async requestLink(raw: unknown,ip: string,kind: 'login'|'operator') {
    const email=mailbox(raw);
    if (!email) return;
    const proof=await transaction(this.pool,async client=>{
      // Letter case must not give one mailbox more attempts.
      if (!(await throttle(client,'ip:'+ip,30)) || !(await throttle(client,'mailbox:'+email.toLowerCase(),5))) return null;
      if (kind==='operator') {
        const {rowCount}=await client.query('SELECT 1 FROM operators WHERE mailbox=$1 AND active',[email]);
        return rowCount?{to:email,token:await newProof(client,kind,email,null,null)}:null;
      }
      const {rows}=await client.query(`SELECT mailbox,id FROM creators WHERE lower(mailbox)=lower($1) UNION ALL
        SELECT mailbox,NULL::uuid FROM invites WHERE lower(mailbox)=lower($1) AND revoked_at IS NULL
        AND consumed_at IS NULL AND expires_at>now()`,[email]);
      const stored=storedMailbox(email,rows.map(row=>row.mailbox));
      if (!stored) return null;
      const creator=rows.find(row=>row.mailbox===stored&&row.id)?.id??null;
      return {to:stored,token:await newProof(client,kind,stored,creator,null)};
    });
    if (proof) this.deliver(proof.to,kind==='operator'?'Confirm LINB operator access':'Confirm your LINB sign-in',proof.token);
  }

  deliver(email: string,subject: string,token: string) {
    const message='Open this link, then select Confirm access. The link expires in 15 minutes.\n\n'+
      this.origin+'/verify#token='+token+'\n\nIf you did not request access, ignore this email.';
    void this.send(email,subject,message).catch(()=>console.error('LINB email delivery failed.'));
  }

  async principal(raw: string|undefined,kind: 'creator'|'operator') {
    if (!raw || !tokenPattern.test(raw)) throw notSignedIn();
    const {rows}=await this.pool.query<Principal>(`SELECT s.creator_id,s.operator_id FROM sessions s
      LEFT JOIN operators o ON o.id=s.operator_id
      WHERE s.digest=$1 AND s.revoked_at IS NULL AND s.expires_at>now()
      AND (s.operator_id IS NULL OR o.active)
      AND ($2::boolean OR NOT EXISTS(SELECT 1 FROM twitch_sessions t WHERE t.session_hash=s.digest))`,[digest(raw),this.twitchEnabled]);
    const id=kind==='creator'?rows[0]?.creator_id:rows[0]?.operator_id;
    if (!id) throw notSignedIn();
    return id;
  }

  async redeem(raw: unknown,pendingTwitch?:string) {
    if (typeof raw!=='string' || !tokenPattern.test(raw)) throw badProof();
    return transaction(this.pool,async client=>{
      const key=digest(raw);
      const {rows}=await client.query(`SELECT * FROM access_proofs WHERE digest=$1 AND
        consumed_at IS NULL AND expires_at>now()`,[key]);
      const proof=rows[0];
      if (!proof) throw badProof();
      if (proof.purpose==='mailbox-old'||proof.purpose==='mailbox-new') {
        return this.proveChange(client,key,proof);
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[proof.mailbox]);
      await this.consume(client,key);
      if (proof.purpose==='operator') {
        const found=await client.query('SELECT id FROM operators WHERE mailbox=$1 AND active',[proof.mailbox]);
        if (!found.rows[0]) throw badProof();
        return {sid:await session(client,null,found.rows[0].id),destination:'/ops'};
      }
      const found=await client.query('SELECT id FROM creators WHERE mailbox=$1 FOR UPDATE',[proof.mailbox]);
      let creator=found.rows[0]?.id;
      if (proof.creator_id && proof.creator_id!==creator) throw badProof();
      if (!creator) {
        if(this.readOnlyHomes) throw new AppError(503,'home_writes_paused','New Home creation is temporarily paused.');
        const invite=await client.query(`UPDATE invites SET consumed_at=now() WHERE mailbox=$1
          AND revoked_at IS NULL AND consumed_at IS NULL AND expires_at>now() RETURNING id`,[proof.mailbox]);
        if (!invite.rowCount) throw badProof();
        creator=await createCreator(client,proof.mailbox);
      }
      await client.query('UPDATE sessions SET revoked_at=now() WHERE creator_id=$1 AND revoked_at IS NULL',[creator]);
      if(pendingTwitch) await consumePendingTwitch(client,pendingTwitch,creator);
      return {sid:await session(client,creator,null),destination:'/editor'};
    });
  }

  async consume(client: pg.PoolClient,key: string) {
    const consumed=await client.query(`UPDATE access_proofs SET consumed_at=now() WHERE digest=$1
      AND consumed_at IS NULL AND expires_at>now() RETURNING digest`,[key]);
    if (!consumed.rowCount) throw badProof();
  }

  async logout(raw: string) {
    await this.pool.query('UPDATE sessions SET revoked_at=now() WHERE digest=$1 AND revoked_at IS NULL',[digest(raw)]);
  }

  async startChange(creator: string,raw: unknown,replace=false) {
    const next=mailbox(raw);
    if (!next) throw invalid('mailbox','Enter a complete mailbox address.');
    const result=await transaction(this.pool,async client=>{
      const {rows}=await client.query('SELECT mailbox FROM creators WHERE id=$1 FOR UPDATE',[creator]);
      const current=rows[0]?.mailbox;
      if (!current) throw notSignedIn();
      if (next===current) throw invalid('mailbox','Enter a different mailbox.');
      if (!(await throttle(client,'mailbox-change:'+creator,5))) throw new AppError(429,'limited','Try again later.');
      const pending=await client.query(`SELECT id FROM mailbox_changes WHERE creator_id=$1
        AND finished_at IS NULL AND cancelled_at IS NULL`,[creator]);
      if (pending.rowCount && !replace) throw conflict('Confirm replacement of the pending change.');
      if (pending.rowCount) await client.query('UPDATE mailbox_changes SET cancelled_at=now() WHERE id=$1',[pending.rows[0].id]);
      const change=randomUUID();
      await client.query('INSERT INTO mailbox_changes(id,creator_id,old_mailbox,new_mailbox) VALUES ($1,$2,$3,$4)',[change,creator,current,next]);
      return {current,old:await newProof(client,'mailbox-old',current,creator,change),
        next:await newProof(client,'mailbox-new',next,creator,change)};
    });
    this.deliver(result.current,'Confirm your current LINB mailbox',result.old);
    this.deliver(next,'Confirm your new LINB mailbox',result.next);
  }

  async proveChange(client: pg.PoolClient,key: string,proof: any) {
    const owner=await client.query('SELECT mailbox FROM creators WHERE id=$1 FOR UPDATE',[proof.creator_id]);
    const selected=await client.query(`SELECT * FROM mailbox_changes WHERE id=$1 AND creator_id=$2
      AND finished_at IS NULL AND cancelled_at IS NULL FOR UPDATE`,[proof.change_id,proof.creator_id]);
    const change=selected.rows[0];
    const old=proof.purpose==='mailbox-old';
    if (!change || owner.rows[0]?.mailbox!==change.old_mailbox
      || proof.mailbox!==(old?change.old_mailbox:change.new_mailbox)) throw badProof();
    await this.consume(client,key);
    const otherProved=old?change.new_proved:change.old_proved;
    if (!otherProved) {
      await client.query(old?'UPDATE mailbox_changes SET old_proved=true WHERE id=$1':'UPDATE mailbox_changes SET new_proved=true WHERE id=$1',[change.id]);
      return {destination:'/account/proof-received'};
    }
    try {
      await client.query('UPDATE creators SET mailbox=$1 WHERE id=$2',[change.new_mailbox,proof.creator_id]);
    } catch(error: any) {
      if (error.code==='23505') throw conflict('This mailbox cannot be used. Start a different change from Account.');
      throw error;
    }
    await client.query('UPDATE mailbox_changes SET old_proved=true,new_proved=true,finished_at=now() WHERE id=$1',[change.id]);
    await client.query('UPDATE sessions SET revoked_at=now() WHERE creator_id=$1 AND revoked_at IS NULL',[proof.creator_id]);
    return {destination:'/account/mailbox-changed',clear:true};
  }
}

export function postmark(token: string,from: string): SendMail {
  return async (to,subject,text)=>{
    const response=await fetch('https://api.postmarkapp.com/email',{
      method:'POST',signal:AbortSignal.timeout(8000),
      headers:{'content-type':'application/json','accept':'application/json','X-Postmark-Server-Token':token},
      body:JSON.stringify({From:from,To:to,Subject:subject,TextBody:text,TrackOpens:false,TrackLinks:'None',MessageStream:'outbound'}),
    });
    if (!response.ok) throw new Error('Email delivery failed');
  };
}
