import { createHmac, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { transaction } from './db.ts';
import { AppError, conflict, equalSecret, uuidPattern } from './domain.ts';

export type BillingConfig={secret:string;price:string;webhookSecret:string;http?:typeof fetch};
const unavailable=()=>new AppError(503,'billing_unavailable','Test billing is unavailable. Your published home is unchanged.');

export function signedEvent(body:string,header:string,secret:string,now=Date.now()) {
  const fields=header.split(',').map(part=>part.trim().split('='));
  const when=fields.find(([name])=>name==='t')?.[1]??'';
  if(!/^\d{8,12}$/.test(when)||Math.abs(Number(when)-Math.floor(now/1000))>300) return false;
  const expected=createHmac('sha256',secret).update(when+'.'+body).digest('hex');
  return fields.some(([name,sig])=>name==='v1'&&Boolean(sig)&&equalSecret(expected,sig));
}
const validId=(value:unknown,prefix:string):value is string=>typeof value==='string'&&
  value.startsWith(prefix)&&/^[A-Za-z0-9_]{8,140}$/.test(value);

export class Billing {
  db:pg.Pool;
  origin:string;
  config:BillingConfig;
  constructor(db:pg.Pool,origin:string,config:BillingConfig) {
    if(!/^(sk|rk)_test_/.test(config.secret)||!validId(config.price,'price_')||!config.webhookSecret.startsWith('whsec_')) throw new Error('Use Stripe test credentials only');
    this.db=db; this.origin=origin; this.config=config;
  }

  async stripe(path:string,body?:Record<string,string>,key?:string) {
    const response=await (this.config.http??fetch)('https://api.stripe.com/v1/'+path,{
      method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(6000),
      headers:{Authorization:'Bearer '+this.config.secret,'Stripe-Version':'2024-06-20',...(key?{'Idempotency-Key':key}:{})},
      ...(body?{body:new URLSearchParams(body)}:{})});
    if(!response.ok) throw unavailable();
    return response.json();
  }

  redirect(value:unknown,host:string) {
    if(typeof value!=='string') throw unavailable();
    const url=new URL(value);
    if(url.protocol!=='https:'||url.host!==host||url.username||url.password) throw unavailable();
    return url.href;
  }

  async status(creator:string) {
    const {rows}=await this.db.query(`SELECT status,access_until,stripe_customer_id,
      (status IN('active','trialing') AND access_until>now()) AS active
      FROM stripe_subscriptions WHERE creator_id=$1`,[creator]);
    return rows[0]??null;
  }

  async checkout(creator:string,home:{id:string;publication_id:string}) {
    return transaction(this.db,async client=>{
      await client.query('SELECT id FROM creators WHERE id=$1 FOR UPDATE',[creator]);
      const existing=await client.query('SELECT 1 FROM stripe_subscriptions WHERE creator_id=$1',[creator]);
      if(existing.rowCount) throw conflict('Manage the existing test subscription before starting another.');
      const current=await client.query(`SELECT 1 FROM homes h WHERE h.id=$1 AND publication_id=$2 AND owner_id=$3
        AND NOT EXISTS(SELECT 1 FROM visibility_holds v WHERE v.home_id=h.id AND v.released_at IS NULL) FOR UPDATE`,
        [home.id,home.publication_id,creator]);
      if(!current.rowCount) throw conflict('Review the current Free page before trying checkout.');
      const {rows}=await client.query(`SELECT *,created_at<=now()-interval '25 hours' AS ended
        FROM billing_attempts WHERE creator_id=$1`,[creator]);
      let attempt=rows[0], replaced='';
      // Stripe ends an unpaid Checkout Session 24 hours after its creation. With an hour of margin,
      // the ended attempt gives way to a new one. The key changes, so Stripe starts a new session.
      if(attempt?.ended) {
        await client.query('DELETE FROM billing_attempts WHERE id=$1',[attempt.id]);
        replaced='-after-'+attempt.id;
        attempt=undefined;
      }
      if(attempt&&attempt.publication_id!==home.publication_id) throw conflict('An earlier test checkout must be reviewed before starting another.');
      if(attempt?.checkout_url) return this.redirect(attempt.checkout_url,'checkout.stripe.com');
      const id=attempt?.id??randomUUID();
      // A stable key across database retries also guards against a successful remote call with a lost reply.
      const remote=await this.stripe('checkout/sessions',{
        mode:'subscription','line_items[0][price]':this.config.price,'line_items[0][quantity]':'1',
        client_reference_id:creator,'subscription_data[metadata][linb_creator]':creator,
        'subscription_data[metadata][linb_publication]':home.publication_id,
        success_url:this.origin+'/account/billing?return=1',cancel_url:this.origin+'/account/billing',
      },'linb-checkout-'+creator+'-'+home.publication_id+replaced);
      if(remote.livemode!==false||!validId(remote.id,'cs_test_')) throw unavailable();
      const url=this.redirect(remote.url,'checkout.stripe.com');
      await client.query(`INSERT INTO billing_attempts(id,creator_id,home_id,publication_id,stripe_checkout_id,checkout_url)
        VALUES($1,$2,$3,$4,$5,$6)`,[id,creator,home.id,home.publication_id,remote.id,url]);
      return url;
    });
  }

  async portal(creator:string) {
    const state=await this.status(creator);
    if(!state||!validId(state.stripe_customer_id,'cus_')) throw unavailable();
    const response=await this.stripe('billing_portal/sessions',{customer:state.stripe_customer_id,return_url:this.origin+'/account/billing'});
    return this.redirect(response.url,'billing.stripe.com');
  }

  async receive(body:string,signature:string) {
    if(!signedEvent(body,signature,this.config.webhookSecret)) throw new AppError(400,'invalid_signature','Invalid test event.');
    let event;
    try { event=JSON.parse(body); } catch { throw new AppError(400,'invalid_event','Invalid test event.'); }
    if(event?.livemode!==false||!validId(event.id,'evt_')) throw new AppError(400,'invalid_event','Invalid test event.');
    const object=event?.data?.object;
    const subscriptionId=event.type==='checkout.session.completed'?object?.subscription:
      ['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted'].includes(event.type)?object?.id:null;
    if(!validId(subscriptionId,'sub_')) return;
    await transaction(this.db,async client=>{
      const receipt=await client.query('INSERT INTO stripe_events(id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id',[event.id]);
      if(!receipt.rowCount) return;
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[subscriptionId]);
      const state=await this.stripe('subscriptions/'+subscriptionId);
      const creator=state?.metadata?.linb_creator,publication=state?.metadata?.linb_publication;
      if(state?.livemode!==false||state.id!==subscriptionId||!uuidPattern.test(creator??'')||
        !uuidPattern.test(publication??'')||!validId(state.customer,'cus_')||
        state.items?.data?.length!==1||state.items.data[0]?.price?.id!==this.config.price) throw unavailable();
      await client.query('SELECT id FROM creators WHERE id=$1 FOR UPDATE',[creator]);
      const attempt=await client.query('SELECT 1 FROM billing_attempts WHERE creator_id=$1 AND publication_id=$2',[creator,publication]);
      if(!attempt.rowCount) throw unavailable();
      const until=typeof state.current_period_end==='number'&&Number.isFinite(state.current_period_end)?
        new Date(state.current_period_end*1000):null;
      const reconciled=await client.query(`INSERT INTO stripe_subscriptions(creator_id,stripe_subscription_id,stripe_customer_id,status,access_until)
        VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(creator_id) DO UPDATE SET status=excluded.status,access_until=excluded.access_until,reconciled_at=now(),
          grant_id=CASE WHEN stripe_subscriptions.status NOT IN('active','trialing') OR stripe_subscriptions.access_until<=now()
                        OR stripe_subscriptions.access_until IS NULL THEN gen_random_uuid() ELSE stripe_subscriptions.grant_id END
        WHERE stripe_subscriptions.stripe_subscription_id=excluded.stripe_subscription_id
          AND stripe_subscriptions.stripe_customer_id=excluded.stripe_customer_id RETURNING creator_id`,
        [creator,subscriptionId,state.customer,state.status,until]);
      if(!reconciled.rowCount) throw unavailable();
    });
  }
}
