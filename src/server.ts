import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from './app.ts';
import { postmark } from './auth.ts';
import { localObjects, r2Objects } from './assets.ts';
import { connect } from './db.ts';

const port=Number(process.env.PORT??3000);
if(!Number.isInteger(port)||port<1||port>65535) throw new Error('PORT must be an integer between 1 and 65535');
const dev=process.env.LOBBY_DEV_DIR;
const host=dev?'127.0.0.1':'0.0.0.0';
const origin=new URL(process.env.PUBLIC_ORIGIN??process.env.RENDER_EXTERNAL_URL??('http://127.0.0.1:'+port));
if(origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password) throw new Error('PUBLIC_ORIGIN must contain only scheme and host');
if(origin.protocol!=='https:'&&!(dev&&['127.0.0.1','localhost'].includes(origin.hostname)&&origin.protocol==='http:')&&process.env.DATABASE_URL) {
  throw new Error('LINB requires an HTTPS origin outside local development');
}
if(dev&&(!['127.0.0.1','localhost'].includes(origin.hostname)||process.env.RENDER_EXTERNAL_URL)) throw new Error('Local mail and object fixtures require loopback');

const redirectOrigins=process.env.PUBLIC_REDIRECT_ORIGINS?.split(',').map(value=>{
  const alias=new URL(value.trim());
  if(origin.protocol!=='https:'||alias.protocol!=='https:'||alias.pathname!=='/'||alias.search||alias.hash||
    alias.username||alias.password||alias.host===origin.host) throw new Error('PUBLIC_REDIRECT_ORIGINS requires distinct HTTPS origins');
  return alias.origin;
});

const pool=process.env.DATABASE_URL?connect(process.env.DATABASE_URL):undefined;
pool?.on('error',()=>console.error('LINB database connection failed.'));
const {POSTMARK_TOKEN,POSTMARK_FROM,R2_ENDPOINT,R2_BUCKET,R2_ACCESS_KEY_ID,R2_SECRET_ACCESS_KEY}=process.env;
const mail=dev
  ?async (to:string,subject:string,text:string)=>{
    const dir=resolve(dev,'mail');
    await mkdir(dir,{recursive:true,mode:0o700});
    await writeFile(resolve(dir,randomUUID()+'.txt'),'To: '+to+'\nSubject: '+subject+'\n\n'+text,{mode:0o600,flag:'wx'});
  }
  :POSTMARK_TOKEN&&POSTMARK_FROM?postmark(POSTMARK_TOKEN,POSTMARK_FROM):undefined;
const objects=dev?localObjects(resolve(dev,'objects')):
  R2_ENDPOINT&&R2_BUCKET&&R2_ACCESS_KEY_ID&&R2_SECRET_ACCESS_KEY?r2Objects(R2_ENDPOINT,R2_BUCKET,R2_ACCESS_KEY_ID,R2_SECRET_ACCESS_KEY):null;

const {TWITCH_CLIENT_ID,TWITCH_CLIENT_SECRET,TWITCH_SESSION_KEY,LINB_TWITCH}=process.env;
if(LINB_TWITCH==='1'&&(!TWITCH_CLIENT_ID||!TWITCH_CLIENT_SECRET||!TWITCH_SESSION_KEY?.match(/^[0-9a-f]{64}$/i))) {
  throw new Error('Twitch requires client ID, secret and a 32-byte hex session key');
}
const twitch=LINB_TWITCH==='1'?{clientId:TWITCH_CLIENT_ID!,clientSecret:TWITCH_CLIENT_SECRET!,key:Buffer.from(TWITCH_SESSION_KEY!,'hex')}:undefined;
const {LINB_STRIPE_TEST,STRIPE_TEST_SECRET,STRIPE_TEST_PRICE,STRIPE_TEST_WEBHOOK_SECRET}=process.env;
if(LINB_STRIPE_TEST==='1'&&(!STRIPE_TEST_SECRET||!STRIPE_TEST_PRICE||!STRIPE_TEST_WEBHOOK_SECRET)) {
  throw new Error('Stripe test mode requires its secret, price and webhook secret');
}
const billing=LINB_STRIPE_TEST==='1'?{secret:STRIPE_TEST_SECRET!,price:STRIPE_TEST_PRICE!,webhookSecret:STRIPE_TEST_WEBHOOK_SECRET!}:undefined;
const app=createApp({pool,origin:origin.origin,redirectOrigins,twitch,billing,pro:process.env.LINB_PRO_SYNTHETIC==='1'?{multipage:process.env.LINB_MULTIPAGE_SYNTHETIC==='1'}:undefined,mail,objects,reportContact:process.env.REPORT_CONTACT,
  demo:Boolean(dev&&process.env.LOBBY_DEMO==='1'),
  clientAddress:context=>{
    const address=getConnInfo(context).remote.address??'unknown';
    // Enable only behind the configured ingress that appends the actual connecting client.
    if(process.env.LOBBY_TRUST_PROXY!=='1') return address;
    return context.req.header('X-Forwarded-For')?.split(',').at(-1)?.trim()||address;
  }});
const server=serve({fetch:app.fetch,hostname:host,port});
for(const signal of ['SIGINT','SIGTERM'] as const) {
  process.once(signal,()=>server.close(()=>{void pool?.end();}));
}
