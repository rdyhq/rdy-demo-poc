import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type pg from 'pg';
import { assetBytes, maxUpload, upload, type Objects } from './assets.ts';
import { Auth, type SendMail } from './auth.ts';
import { AppError, digest, emptyHome, equalSecret, invalid, mailbox, normalize, unavailable, uuidPattern } from './domain.ts';
import { invite, inviteList, revokeInvite } from './enrollment.ts';
import { editor, mutate, publicHome, refers } from './homes.ts';
import { caseAction, caseDetail, cases, holdReasons, inspectPublication, openCase } from './operator.ts';
import { accountPage, confirmation, editorPage, invitesPage, landing, message, opsCase, opsPage, renderHome, retiredCalendar, signIn } from './views.ts';

const stylesheet=readFileSync(new URL('./public/lobby.css',import.meta.url),'utf8');
const brandIcon=readFileSync(new URL('./public/linb.svg',import.meta.url),'utf8');
const editorScript=readFileSync(new URL('./public/editor.js',import.meta.url),'utf8');
const previewScript=readFileSync(new URL('./public/preview.js',import.meta.url),'utf8');
const verifyScript=readFileSync(new URL('./public/verify.js',import.meta.url),'utf8');

type Configuration={
  pool?:pg.Pool; origin?:string; redirectOrigins?:string[]; mail?:SendMail; objects?:Objects|null;
  reportContact?:string; clock?:()=>number; demo?:boolean;
  clientAddress?:(context:Context)=>string;
};

const parseJson=(raw:string)=>{
  try {return JSON.parse(raw);}
  catch {throw invalid('body','Send a valid JSON document.');}
};
const requestJson=async(c:Context)=>{
  if (!c.req.header('Content-Type')?.toLowerCase().startsWith('application/json')) {
    throw new AppError(415,'json_required','Use application/json.');
  }
  return parseJson(await c.req.text());
};
const forbidden=()=>new AppError(403,'forbidden','This action could not be authorized.');

export function createApp(config:Configuration={}) {
  const app=new Hono();
  const clock=config.clock??Date.now;
  const origin=config.origin?new URL(config.origin).origin:null;
  const originHost=origin?new URL(origin).host:null;
  const redirectHosts=new Set(config.redirectOrigins?.map(value=>new URL(value).host));
  const secure=origin?.startsWith('https:')??false;
  const contact=mailbox(config.reportContact)??undefined;
  const pool=config.pool;
  const objects=config.objects??null;
  const auth=pool&&config.mail&&origin?new Auth(pool,config.mail,origin):null;
  const cookieOptions={path:'/',httpOnly:true,secure,sameSite:'Lax' as const,maxAge:7*24*3600};
  const name=secure?'__Host-lobby':'lobby';
  const cookie=(c:Context)=>getCookie(c,name);
  const requirePool=()=>{
    if (!pool) throw new AppError(503,'unavailable','LINB is temporarily unavailable.');
    return pool;
  };
  const requireAuth=()=>{
    if (!auth) throw new AppError(503,'sign_in_unavailable','Creator sign-in is unavailable.');
    return auth;
  };
  const principal=(c:Context,role:'creator'|'operator')=>requireAuth().principal(cookie(c),role);
  const sameOrigin=(c:Context)=>{
    if (!origin || c.req.header('Origin')!==origin) throw forbidden();
  };
  const csrf=(value:string)=>digest('lobby:csrf:'+value);
  const checkCsrf=(c:Context,provided:unknown)=>{
    sameOrigin(c);
    const value=cookie(c);
    if (!value||typeof provided!=='string'||!equalSecret(csrf(value),provided)) throw forbidden();
  };
  const limit=bodyLimit({maxSize:96*1024});
  const fileLimit=bodyLimit({maxSize:maxUpload+64*1024});
  app.use('*',async(c,next)=>{
    if(c.req.path!=='/healthz') {
      c.header('Cache-Control','no-store');
      // A no-referrer policy strips Origin from same-origin browser form posts.
      c.header('Referrer-Policy','same-origin');
      c.header('X-Content-Type-Options','nosniff');
      c.header('X-Frame-Options','DENY');
      c.header('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    }
    if(redirectHosts.size&&origin&&c.req.path!=='/healthz') {
      // The Node adapter builds this URL from the request authority, not X-Forwarded-Host.
      const url=new URL(c.req.url);
      if(url.host!==originHost) {
        if(!redirectHosts.has(url.host)||!['GET','HEAD'].includes(c.req.method)) return c.notFound();
        const parts=url.pathname.split('/');
        if(url.pathname!=='/') {
          const [,root,id,kind,item,file]=parts;
          const isImage=parts.length===5&&kind==='images'&&uuidPattern.test(item);
          const isCalendar=parts.length===6&&kind==='calendar'&&uuidPattern.test(item)&&
            file.endsWith('.ics')&&uuidPattern.test(file.slice(0,-4));
          if(root!=='h'||!uuidPattern.test(id??'')||!(parts.length===3||isImage||isCalendar)) return c.notFound();
          const home=await publicHome(requirePool(),id);
          if(isImage&&!refers(home.content,item)) return c.notFound();
        }
        const target=new URL(origin);
        target.pathname=url.pathname;
        // None of the current public routes use query parameters. Never forward proofs or tracking.
        return c.redirect(target.href+'#',308);
      }
    }
    if(['POST','PUT','PATCH'].includes(c.req.method)) {
      await (c.req.path==='/api/editor/assets'?fileLimit:limit)(c,next);
    } else await next();
  });

  app.onError((error,c)=>{
    const known=error instanceof AppError;
    const status=known?error.status:503;
    const text=known?error.message:'LINB could not complete this request. Please try again.';
    const requestId=randomUUID();
    if(!known) console.error('LINB request failed',requestId);
    if(c.req.path.startsWith('/api/')) return c.json({code:known?error.code:'temporarily_unavailable',message:text,
      requestId,...(known&&error.fields?{fields:error.fields}:{})},status as 401);
    return c.html(message(status===404?'This home is not available':status===401?'Sign in again':'LINB could not complete this request',
      status===503?text+' Request ID: '+requestId:text,status===401?(c.req.path.startsWith('/ops')?'/ops/sign-in':'/sign-in'):'/',
      status===401?'Request a sign-in link':'Back to LINB'),status as 401);
  });

  app.get('/healthz',c=>{c.header('Cache-Control','no-store');return c.json({status:'ok'});});
  app.get('/assets/linb.svg',c=>c.text(brandIcon,200,{'Content-Type':'image/svg+xml','Cache-Control':'public, max-age=300'}));
  app.get('/assets/lobby.css',c=>c.text(stylesheet,200,{'Content-Type':'text/css; charset=utf-8','Cache-Control':'public, max-age=300'}));
  app.get('/assets/editor.js',c=>c.text(editorScript,200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'public, max-age=300'}));
  app.get('/assets/preview.js',c=>c.text(previewScript,200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'public, max-age=300'}));
  app.get('/assets/verify.js',c=>c.text(verifyScript,200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'public, max-age=300'}));
  app.get('/',c=>c.html(landing(Boolean(auth),Boolean(config.demo),origin?origin+'/':undefined)));
  app.get('/sign-in',c=>c.html(signIn(false,c.req.query('sent')==='1')));
  app.get('/ops/sign-in',c=>c.html(signIn(true,c.req.query('sent')==='1')));
  for(const [path,kind] of [['/sign-in','login'],['/ops/sign-in','operator']] as const) {
    app.post(path,async c=>{
      sameOrigin(c);
      const fields=await c.req.parseBody();
      await requireAuth().requestLink(fields.mailbox,config.clientAddress?.(c)??'local',kind);
      return c.redirect(path+'?sent=1',303);
    });
  }
  app.get('/verify',c=>c.html(confirmation()));
  app.post('/verify',async c=>{
    sameOrigin(c);
    const fields=await c.req.parseBody();
    const result=await requireAuth().redeem(fields.token);
    if ('sid' in result && result.sid) setCookie(c,name,result.sid,cookieOptions);
    if ('clear' in result && result.clear) deleteCookie(c,name,cookieOptions);
    return c.redirect(result.destination,303);
  });
  for(const [path,role] of [['/logout','creator'],['/ops/logout','operator']] as const) {
    app.post(path,async c=>{
      const fields=await c.req.parseBody();
      checkCsrf(c,fields.csrf);
      await principal(c,role);
      await requireAuth().logout(cookie(c)!);
      deleteCookie(c,name,cookieOptions);
      return c.redirect(role==='operator'?'/ops/sign-in':'/sign-in',303);
    });
  }
  app.get('/account',async c=>{
    const creator=await principal(c,'creator'),db=requirePool();
    const {rows}=await db.query('SELECT mailbox FROM creators WHERE id=$1',[creator]);
    const change=await db.query(`SELECT old_proved,new_proved FROM mailbox_changes WHERE creator_id=$1
      AND finished_at IS NULL AND cancelled_at IS NULL`,[creator]);
    return c.html(accountPage(rows[0].mailbox,change.rows[0],csrf(cookie(c)!),contact??null,
      c.req.query('sent')==='1'?'Check both mailboxes for verification links.':undefined));
  });
  app.post('/account/mailbox',async c=>{
    const creator=await principal(c,'creator');
    const fields=await c.req.parseBody();
    checkCsrf(c,fields.csrf);
    await requireAuth().startChange(creator,fields.mailbox,fields.replace==='on');
    return c.redirect('/account?sent=1',303);
  });
  app.get('/account/proof-received',c=>c.html(message('Proof received','Confirm the other mailbox to complete the change.','/account','Return to account')));
  app.get('/account/mailbox-changed',c=>c.html(message('Mailbox changed','Sign in with your new mailbox.','/sign-in','Sign in')));
  app.get('/editor',async c=>{
    const owner=await principal(c,'creator');
    return c.html(editorPage(await editor(requirePool(),owner),csrf(cookie(c)!),Boolean(objects)));
  });
  app.get('/api/editor',async c=>{
    const state=await editor(requirePool(),await principal(c,'creator'));
    const {owner_id,...safe}=state;
    return c.json({...safe,csrf:csrf(cookie(c)!)});
  });
  app.post('/editor/preview',async c=>{
    const owner=await principal(c,'creator');
    const fields=await c.req.parseBody();
    checkCsrf(c,fields.csrf);
    const db=requirePool(), state=await editor(db,owner);
    if(typeof fields.content!=='string') throw invalid('content','Enter home content.');
    const content=normalize(parseJson(fields.content),state.content,clock(),true);
    if(content.updates.length) {
      const {rows}=await db.query('SELECT update_id, first_published_at FROM update_dates WHERE home_id=$1',[state.id]);
      const dates=new Map(rows.map(row=>[row.update_id,row.first_published_at.toISOString()]));
      for(const update of content.updates) update.firstPublishedAt=dates.get(update.id);
    }
    return c.html(renderHome(content,{now:clock(),preview:true,asset:id=>'/editor/assets/'+id}));
  });
  for(const action of ['save','publish','unpublish'] as const) {
    app.post('/api/editor/'+action,async c=>{
      const owner=await principal(c,'creator');
      checkCsrf(c,c.req.header('x-csrf-token'));
      return c.json(await mutate(requirePool(),owner,action,await requestJson(c),clock()));
    });
  }
  app.post('/api/editor/assets',async c=>{
    const owner=await principal(c,'creator');
    checkCsrf(c,c.req.header('x-csrf-token'));
    if (!objects) throw new AppError(503,'storage_unavailable','Image storage is unavailable.');
    const files=await c.req.parseBody();
    return c.json(await upload(requirePool(),objects,owner,files.image as File),201);
  });
  const sendImage=(bytes:Uint8Array)=>new Response(Uint8Array.from(bytes),{headers:{
    'Content-Type':'image/webp','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  }});
  app.get('/editor/assets/:id',async c=>sendImage(await assetBytes(requirePool(),objects,await principal(c,'creator'),c.req.param('id'))));

  app.get('/h/:homeId/calendar/:sessionId/:file',async c=>{
    const file=c.req.param('file');
    if(!file.endsWith('.ics')||!uuidPattern.test(file.slice(0,-4))||!uuidPattern.test(c.req.param('sessionId'))) throw unavailable();
    const home=await publicHome(requirePool(),c.req.param('homeId'));
    return c.html(retiredCalendar(home.id),410);
  });
  app.get('/h/:homeId/images/:id',async c=>{
    const db=requirePool(),home=await publicHome(db,c.req.param('homeId')),id=c.req.param('id');
    if(!refers(home.content,id)) throw unavailable();
    const bytes=await assetBytes(db,objects,home.owner_id,id);
    if((await publicHome(db,home.id)).publication_id!==home.publication_id) throw unavailable();
    return sendImage(bytes);
  });
  app.get('/h/:homeId',async c=>{
    const home=await publicHome(requirePool(),c.req.param('homeId'));
    return c.html(renderHome(home.content,{now:clock(),report:contact,asset:id=>'/h/'+home.id+'/images/'+id,
      canonical:origin?origin+'/h/'+home.id:undefined}));
  });

  app.get('/ops',async c=>{
    const actor=await principal(c,'operator');
    return c.html(opsPage(await cases(requirePool(),actor),csrf(cookie(c)!),holdReasons));
  });
  app.get('/ops/invites',async c=>{
    await principal(c,'operator');
    return c.html(invitesPage(await inviteList(requirePool()),csrf(cookie(c)!),c.req.query('issued')==='1'));
  });
  app.post('/ops/invites',async c=>{
    const actor=await principal(c,'operator'), fields=await c.req.parseBody();
    checkCsrf(c,fields.csrf);
    await invite(requirePool(),actor,fields.mailbox,fields.alias);
    return c.redirect('/ops/invites?issued=1',303);
  });
  app.post('/ops/invites/:id/revoke',async c=>{
    const actor=await principal(c,'operator'), fields=await c.req.parseBody();
    checkCsrf(c,fields.csrf);
    await revokeInvite(requirePool(),actor,c.req.param('id'));
    return c.redirect('/ops/invites',303);
  });
  app.post('/ops/cases',async c=>{
    const actor=await principal(c,'operator');
    const fields=await c.req.parseBody();
    checkCsrf(c,fields.csrf);
    const id=await openCase(requirePool(),actor,fields);
    return c.redirect('/ops/cases/'+id,303);
  });
  app.get('/ops/cases/:id',async c=>{
    const actor=await principal(c,'operator');
    const {row,events}=await caseDetail(requirePool(),actor,c.req.param('id'));
    return c.html(opsCase(row,events,actor,csrf(cookie(c)!)));
  });
  app.get('/ops/cases/:id/publication',async c=>{
    const actor=await principal(c,'operator'),id=c.req.param('id');
    const result=await inspectPublication(requirePool(),actor,id);
    if(!result.content) return c.html(message('No current publication','The home remains held and no publication is set.','/ops/cases/'+id,'Back to case'));
    return c.html(renderHome(result.content,{now:clock(),review:true,asset:asset=>'/ops/cases/'+id+'/publication/'+result.publicationId+'/images/'+asset}));
  });
  app.get('/ops/cases/:id/publication/:publicationId/images/:asset',async c=>{
    const actor=await principal(c,'operator'),db=requirePool(),id=c.req.param('id');
    const asset=c.req.param('asset'),publication=c.req.param('publicationId');
    const result=await inspectPublication(db,actor,id,asset,publication);
    const bytes=await assetBytes(db,objects,result.owner,asset);
    await inspectPublication(db,actor,id,asset,publication,false);
    return sendImage(bytes);
  });
  for(const action of ['hold','review','release'] as const) {
    app.post('/ops/cases/:id/'+action,async c=>{
      const actor=await principal(c,'operator'),id=c.req.param('id');
      const fields=await c.req.parseBody();
      checkCsrf(c,fields.csrf);
      const notify=await caseAction(requirePool(),actor,id,action,{...fields,publicationId:fields.publicationId||null});
      if(notify&&config.mail) {
        void config.mail(notify,action==='hold'?'Public access to your LINB home is held':'Your LINB visibility hold was released',
          'Sign in to the LINB editor for the current status and review contact.').catch(()=>console.error('LINB status notification failed.'));
      }
      return c.redirect('/ops/cases/'+id,303);
    });
  }
  if(config.demo) app.get('/demo',c=>{
    const quiet=c.req.query('state')==='quiet';
    const future=new Date(clock()+86400000);
    const content={...emptyHome,displayName:'Mira Vale',intro:'Cozy strategy, questionable shortcuts.',game:'Hades II',
      streamUrl:'https://www.twitch.tv/',theme:'Midnight' as const,links:[{label:'Stream archive',url:'https://www.youtube.com/'}],
      updates:[{id:randomUUID(),text:'Another attempt at the surface route next time.',firstPublishedAt:new Date(clock()).toISOString()}],
      sessions:quiet?[]:[{id:randomUUID(),title:'Surface route practice',local:future.toISOString().slice(0,16),zone:'UTC',offset:'+00:00',instant:future.toISOString()}]};
    return c.html(renderHome(content,{now:clock(),asset:()=>'',demo:true}));
  });
  app.notFound(c=>c.html(message('This home is not available','The requested page is unavailable.'),404));
  return app;
}

export const app=createApp();
