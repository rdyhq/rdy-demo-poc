import { createCipheriv, createDecipheriv, createPublicKey, randomBytes, verify } from 'node:crypto';
import type pg from 'pg';
import { transaction } from './db.ts';
import { AppError, conflict, digest, mailbox, secret, tokenPattern } from './domain.ts';
import { createCreator } from './homes.ts';
import { assignHandle } from './handles.ts';

export const issuer='https://id.twitch.tv/oauth2';
export const twitchCallback='/auth/twitch/callback';
export type TwitchConfig={clientId:string;clientSecret:string;key:Buffer;http?:typeof fetch};
// The email is present only when Twitch says that the account verified it.
type Identity={subject:string;login:string|null;email?:string|null};
const failed=()=>new AppError(401,'twitch_unavailable','Twitch could not verify access. You can continue with email.');

export function verifyIdentity(token:string,keys:JsonWebKey[],clientId:string,nonce:string,now=Date.now()):Identity {
  try {
    if(token.length>16000) throw failed();
    const [head,body,sig,extra]=token.split('.');
    if(!head||!body||!sig||extra!==undefined) throw failed();
    const h=JSON.parse(Buffer.from(head,'base64url').toString());
    const c=JSON.parse(Buffer.from(body,'base64url').toString());
    const key=keys.find(k=>(k as any).kid===h.kid&&k.kty==='RSA');
    if(h.alg!=='RS256'||typeof h.kid!=='string'||!key||
       !verify('RSA-SHA256',Buffer.from(head+'.'+body),createPublicKey({key,format:'jwk'}),Buffer.from(sig,'base64url'))) throw failed();
    if(c.iss!==issuer||c.aud!==clientId||c.nonce!==nonce||typeof c.exp!=='number'||c.exp<=now/1000||
       typeof c.iat!=='number'||c.iat>now/1000+60||!/^\d{1,30}$/.test(c.sub)||typeof c.sub!=='string') throw failed();
    return {subject:c.sub,login:typeof c.preferred_username==='string'&&/^[A-Za-z0-9_]{1,25}$/.test(c.preferred_username)?c.preferred_username:null,
      email:c.email_verified===true?mailbox(c.email):null};
  } catch { throw failed(); }
}

export class Twitch {
  db:pg.Pool;
  config:TwitchConfig;
  callback:string;
  // With open sign-up, a new Twitch identity creates an account (RDY D-AD8F2).
  openSignup:boolean;
  constructor(db:pg.Pool,config:TwitchConfig,origin:string,openSignup=false) {
    this.db=db; this.config=config; this.callback=origin+twitchCallback; this.openSignup=openSignup;
  }

  async begin(intent:'sign-in'|'link',sid?:string) {
    const state=secret(),nonce=secret();
    await this.db.query('DELETE FROM twitch_attempts WHERE expires_at<=now()');
    await this.db.query('DELETE FROM twitch_pending WHERE expires_at<=now()');
    await this.db.query(`INSERT INTO twitch_attempts VALUES($1,$2,$3,$4,now()+interval '10 minutes')`,
      [digest(state),nonce,intent,sid?digest(sid):null]);
    // The verified email of the Twitch account becomes the recovery mailbox of a new creator.
    const claims=this.openSignup?{preferred_username:null,email:null,email_verified:null}:{preferred_username:null};
    const query=new URLSearchParams({client_id:this.config.clientId,redirect_uri:this.callback,response_type:'code',
      scope:this.openSignup?'openid user:read:email':'openid',state,nonce,claims:JSON.stringify({id_token:claims})});
    return {state,url:issuer+'/authorize?'+query};
  }

  async json(path:string,init:RequestInit={}) {
    const response=await (this.config.http??fetch)(issuer+'/'+path,{...init,redirect:'error',signal:AbortSignal.timeout(6000)});
    if(!response.ok) throw failed();
    return response.json();
  }

  async validate(token:string,subject:string) {
    const validated=await this.json('validate',{headers:{Authorization:'OAuth '+token}});
    if(validated.client_id!==this.config.clientId||validated.user_id!==subject||!(validated.expires_in>0)) throw failed();
    return Number(validated.expires_in);
  }

  encrypt(token:string) {
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.config.key,iv);
    const payload=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
    return Buffer.concat([iv,cipher.getAuthTag(),payload]).toString('base64url');
  }

  decrypt(box:string) {
    const payload=Buffer.from(box,'base64url');
    const decipher=createDecipheriv('aes-256-gcm',this.config.key,payload.subarray(0,12));
    decipher.setAuthTag(payload.subarray(12,28));
    return Buffer.concat([decipher.update(payload.subarray(28)),decipher.final()]).toString();
  }

  async recentEmail(sid:string,creator:string) {
    const {rowCount}=await this.db.query(`SELECT 1 FROM sessions WHERE digest=$1 AND creator_id=$2 AND revoked_at IS NULL
      AND expires_at>now() AND mailbox_proved_at>now()-interval '15 minutes'`,[digest(sid),creator]);
    return Boolean(rowCount);
  }

  async finish(state:string|undefined,browserState:string|undefined,code:string|undefined,sid?:string) {
    if(!state||!tokenPattern.test(state)||state!==browserState||!code||code.length>1024) throw failed();
    const {rows}=await this.db.query(`DELETE FROM twitch_attempts WHERE state_hash=$1 AND expires_at>now() RETURNING *`,[digest(state)]);
    const attempt=rows[0];
    if(!attempt||(attempt.intent==='link'&&(!sid||digest(sid)!==attempt.session_hash))) throw failed();
    const payload=await this.json('token',{method:'POST',body:new URLSearchParams({client_id:this.config.clientId,
      client_secret:this.config.clientSecret,code,grant_type:'authorization_code',redirect_uri:this.callback})});
    if(typeof payload.id_token!=='string'||typeof payload.access_token!=='string') throw failed();
    const keys=(await this.json('keys')).keys;
    const identity=verifyIdentity(payload.id_token,keys,this.config.clientId,attempt.nonce);
    const expiry=await this.validate(payload.access_token,identity.subject);
    return transaction(this.db,async client=>{
      if(attempt.intent==='link') {
        const {rows}=await client.query(`SELECT creator_id FROM sessions WHERE digest=$1 AND revoked_at IS NULL AND expires_at>now()
          AND mailbox_proved_at>now()-interval '15 minutes'`,[attempt.session_hash]);
        if(!rows[0]?.creator_id) throw failed();
        if(!await attachTwitch(client,rows[0].creator_id,identity)) throw conflict('This Twitch identity is already linked. Sign in with your verified mailbox.');
        return {destination:'/account?twitch=linked'};
      }
      const {rows}=await client.query('SELECT creator_id FROM twitch_identities WHERE subject=$1 FOR UPDATE',[identity.subject]);
      let destination='/editor';
      if(!rows[0]&&this.openSignup) {
        if(!identity.email) return {destination:'/sign-in?twitch=email'};
        // linb.io never joins two accounts by itself. A mailbox that it knows signs in with that mailbox.
        const known=await client.query('SELECT 1 FROM creators WHERE lower(mailbox)=lower($1)',[identity.email]);
        if(!known.rowCount) {
          const creator=await createCreator(client,identity.email);
          if(!await attachTwitch(client,creator,identity)) throw failed();
          rows[0]={creator_id:creator};
          destination='/start';
        }
      }
      if(!rows[0]) {
        const pending=secret();
        await client.query(`INSERT INTO twitch_pending VALUES($1,$2,$3,now()+interval '15 minutes')`,[digest(pending),identity.subject,identity.login]);
        return {pending,destination:'/sign-in?twitch=mailbox'};
      }
      const next=secret(),key=digest(next),creator=rows[0].creator_id;
      // Twitch names the current login at each sign-in. A new login is offered as the handle.
      if(identity.login) await client.query('UPDATE twitch_identities SET login=$2 WHERE subject=$1',[identity.subject,identity.login]);
      await assignHandle(client,creator,identity);
      await client.query('UPDATE sessions SET revoked_at=now() WHERE creator_id=$1 AND revoked_at IS NULL',[creator]);
      await client.query(`INSERT INTO sessions(digest,creator_id,expires_at) VALUES($1,$2,now()+$3*interval '1 second')`,
        [key,creator,Math.min(expiry,7*86400)]);
      await client.query('INSERT INTO twitch_sessions(session_hash,subject,token_box) VALUES($1,$2,$3)',
        [key,identity.subject,this.encrypt(payload.access_token)]);
      return {sid:next,destination};
    });
  }

  async checkSession(sid:string) {
    const hash=digest(sid);
    const {rows}=await this.db.query(`SELECT subject,token_box FROM twitch_sessions
      WHERE session_hash=$1 AND checked_at<now()-interval '45 minutes'`,[hash]);
    if(!rows[0]) return;
    const state=await this.tokenState(rows[0].token_box,rows[0].subject);
    if(state==='accepted') {
      await this.db.query('UPDATE twitch_sessions SET checked_at=now() WHERE session_hash=$1',[hash]);
    } else if(state==='unanswered') {
      // Twitch gave no answer. Keep the session and ask again in five minutes.
      await this.db.query(`UPDATE twitch_sessions SET checked_at=now()-interval '40 minutes' WHERE session_hash=$1`,[hash]);
    } else {
      await this.db.query('UPDATE sessions SET revoked_at=now() WHERE digest=$1',[hash]);
      await this.db.query('DELETE FROM twitch_sessions WHERE session_hash=$1',[hash]);
      throw failed();
    }
  }

  // Only an answer from Twitch can reject a token. An outage or a timeout cannot.
  private async tokenState(box:string,subject:string):Promise<'accepted'|'rejected'|'unanswered'> {
    let token:string;
    try { token=this.decrypt(box); } catch { return 'rejected'; }
    let response:Response;
    try {
      response=await (this.config.http??fetch)(issuer+'/validate',{headers:{Authorization:'OAuth '+token},
        redirect:'error',signal:AbortSignal.timeout(6000)});
    } catch { return 'unanswered'; }
    if(response.status===401) return 'rejected';
    const validated=response.ok?await response.json().catch(()=>null):null;
    if(!validated) return 'unanswered';
    return validated.client_id===this.config.clientId&&validated.user_id===subject&&validated.expires_in>0?'accepted':'rejected';
  }

  async unlink(creator:string) {
    const {rows}=await this.db.query(`SELECT t.session_hash,t.token_box FROM twitch_sessions t JOIN twitch_identities i USING(subject)
      WHERE i.creator_id=$1`,[creator]);
    await transaction(this.db,async client=>{
      await client.query(`UPDATE sessions SET revoked_at=now() WHERE creator_id=$1 AND digest IN(SELECT session_hash FROM twitch_sessions)`,[creator]);
      await client.query('DELETE FROM twitch_identities WHERE creator_id=$1',[creator]);
    });
    // Best-effort revocation. Local access is already disabled.
    await Promise.allSettled(rows.map(row=>this.json('revoke',{method:'POST',body:new URLSearchParams({
      client_id:this.config.clientId,token:this.decrypt(row.token_box),
    })})));
  }
}

export async function attachTwitch(client:pg.PoolClient,creator:string,identity:Identity) {
  const result=await client.query(`INSERT INTO twitch_identities(subject,creator_id,login) VALUES($1,$2,$3)
    ON CONFLICT DO NOTHING RETURNING subject`,[identity.subject,creator,identity.login]);
  const attached=Boolean(result.rowCount)||
    Boolean((await client.query('SELECT 1 FROM twitch_identities WHERE creator_id=$1 AND subject=$2',[creator,identity.subject])).rowCount);
  if(attached) await assignHandle(client,creator,identity);
  return attached;
}

export async function consumePendingTwitch(client:pg.PoolClient,pending:string,creator:string) {
  if(!tokenPattern.test(pending)) return;
  const {rows}=await client.query(`DELETE FROM twitch_pending WHERE browser_hash=$1 AND expires_at>now() RETURNING subject,login`,[digest(pending)]);
  if(rows[0]) await attachTwitch(client,creator,rows[0]);
}
