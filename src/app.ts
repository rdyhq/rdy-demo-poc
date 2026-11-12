import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type pg from 'pg';
import { normalizePro, proDraft, publicPro } from './pro.ts';
import { Billing, type BillingConfig } from './billing.ts';
import { Twitch, twitchCallback, type TwitchConfig } from './twitch.ts';
import { transaction } from './db.ts';
import { acceptReport, reportInbox, reportReasons } from './reports.ts';
import { assetBytes, maxUpload, upload, type Objects } from './assets.ts';
import { Auth, type SendMail } from './auth.ts';
import { AppError, digest, emptyHome, equalSecret, invalid, mailbox, scheduleChange, unavailable, uuidPattern, type ScheduleChange } from './domain.ts';
import { invite, inviteList, revokeInvite } from './enrollment.ts';
import { cardColumns, cardHeights, cardSpans, channelPlatform, normalizeHome, platforms, readHome, type EditableHome, type StoredHome } from './home-cards.ts';
import { liveState } from './live-state.ts';
import { TwitchActivity, type TwitchActivityConfig, type TwitchChannel } from './twitch-activity.ts';
import { acceptHandle, handleOffer, homeHandle, resolveHandle } from './handles.ts';
import { describeFailure } from './failure.ts';
import { artPalette, paletteCss, paletteVersion, skinColours } from './public/palette.js';
import { editor, mutate, publicHome, refers } from './homes.ts';
import { approvedPreview, previewFields, previewFingerprint, type Selection } from './sharing.ts';
import { caseAction, caseDetail, cases, holdReasons, inspectPublication, openCase } from './operator.ts';
import { accountPage, billingPage, confirmation, editorPage, editorShare, invitesPage, landing, leaderboardDemo, message, proEditor, opsCase, opsPage, renderHome, reportPage, retiredCalendar, signIn } from './views.ts';

const stylesheet=[
  readFileSync(new URL('./public/lobby.css',import.meta.url),'utf8'),
  ...cardSpans.map(span=>`.card-home > [data-span="${span}"] { --preferred-span:${span}; }`),
  ...cardColumns.map(column=>`.card-home > [data-column="${column}"] { --resolved-column:min(${column},13 - var(--resolved-span)); }`),
  ...cardHeights.filter(Boolean).map(height=>`.card-home > [data-height="${height}"] { --card-height:${height}px; }`),
  // Use the requested minimum height, so revealed content cannot trigger its own breakpoint.
  ...[
    [160, '--dock-summary:none; --dock-full:block;'],
    [416, '--schedule-summary:none; --schedule-two:block; --schedule-three:block; --schedule-tall-after-two:none;'],
  ].map(([minimum, rules]) => `${cardHeights.filter(height=>height>=Number(minimum))
    .map(height=>`.card-home > [data-height="${height}"]`).join(', ')} { ${rules} }`),
].join('\n');
const brandIcon=readFileSync(new URL('./public/linb.svg',import.meta.url),'utf8');
const playerScript=readFileSync(new URL('./public/player.js',import.meta.url),'utf8');
const shareScript=readFileSync(new URL('./public/share.js',import.meta.url),'utf8');
const editorScript=readFileSync(new URL('./public/editor.js',import.meta.url),'utf8');
const cardLayoutScript=readFileSync(new URL('./public/card-layout.js',import.meta.url),'utf8');
const previewScript=readFileSync(new URL('./public/preview.js',import.meta.url),'utf8');
const verifyScript=readFileSync(new URL('./public/verify.js',import.meta.url),'utf8');
const auraScripts=new Map(['aura','contrast','art-accent','handoff','editor-support'].map(name=>[
  name+'.js',readFileSync(new URL('./public/'+name+'.js',import.meta.url),'utf8'),
]));
const fonts=new Map(['inter','bricolage-grotesque','unbounded','jetbrains-mono','silkscreen'].map(name=>[
  name+'-latin.woff2',readFileSync(new URL('./public/fonts/'+name+'-latin.woff2',import.meta.url)),
]));
const platformIcons=new Map(Object.keys(platforms).map(name=>[
  name,readFileSync(new URL('./public/platforms/'+name+'.svg',import.meta.url),'utf8'),
]));

type Configuration={
  twitchActivity?:TwitchActivityConfig;
  pool?:pg.Pool; origin?:string; twitch?:TwitchConfig; billing?:BillingConfig; pro?:{multipage:boolean}; redirectOrigins?:string[]; mail?:SendMail; objects?:Objects|null;
  reportContact?:string; clock?:()=>number; demo?:boolean; readOnlyHomes?:boolean; appHandoff?:boolean;
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
  const activity=config.twitchActivity?new TwitchActivity(config.twitchActivity,clock):null;
  const origin=config.origin?new URL(config.origin).origin:null;
  const originHost=origin?new URL(origin).host:null;
  const redirectHosts=new Set(config.redirectOrigins?.map(value=>new URL(value).host));
  const secure=origin?.startsWith('https:')??false;
  const contact=mailbox(config.reportContact)??undefined;
  const pool=config.pool;
  const objects=config.objects??null;
  const auth=pool&&config.mail&&origin?new Auth(pool,config.mail,origin,Boolean(config.twitch),config.readOnlyHomes):null;
  const twitch=pool&&auth&&origin&&config.twitch?new Twitch(pool,config.twitch,origin):null;
  const billing=pool&&auth&&origin&&config.billing?new Billing(pool,origin,config.billing):null;
  const pro=billing?config.pro:null;
  const twitchState=secure?'__Host-linb-twitch':'linb-twitch';
  const twitchPending=secure?'__Host-linb-twitch-pending':'linb-twitch-pending';
  const twitchCookie={path:'/',secure,httpOnly:true,sameSite:'Lax' as const,maxAge:600};
  const cookieOptions={path:'/',httpOnly:true,secure,sameSite:'Lax' as const,maxAge:7*24*3600};
  const name=secure?'__Host-lobby':'lobby';
  const cookie=(c:Context)=>getCookie(c,name);
  const requirePool=()=>{
    if (!pool) throw new AppError(503,'unavailable','LINB is temporarily unavailable.');
    return pool;
  };
  async function linkedChannel(db:pg.Pool,owner:string,content:EditableHome):Promise<TwitchChannel|undefined> {
    if(!activity||!content.streamUrl||channelPlatform(content.streamUrl)!=='twitch') return;
    const login=new URL(content.streamUrl).pathname.split('/')[1].toLowerCase();
    const {rows}=await db.query<{subject:string}>('SELECT subject FROM twitch_identities WHERE creator_id=$1',[owner]);
    // Twitch confirms that this subject's current login is the stream destination.
    // The login stored when the creator linked Twitch goes stale after a rename.
    if(rows[0]) return {subject:rows[0].subject,login};
  }
  const requireHomeWrites=()=>{
    if(config.readOnlyHomes) throw new AppError(503,'home_writes_paused','Home changes are temporarily paused.');
  };
  const requireAuth=()=>{
    if (!auth) throw new AppError(503,'sign_in_unavailable','Creator sign-in is unavailable.');
    return auth;
  };
  const principal=async(c:Context,role:'creator'|'operator')=>{
    const sid=cookie(c);
    const owner=await requireAuth().principal(sid,role);
    if(twitch&&role==='creator'&&sid) await twitch.checkSession(sid);
    return owner;
  };
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
      const allowedForms=(twitch?' https://id.twitch.tv':'')+(billing?' https://checkout.stripe.com https://billing.stripe.com':'');
      const frameSources=[...(c.req.path==='/editor'?["'self'"]:[]),...(pro?['https://www.youtube-nocookie.com']:[])];
      const allowedFrames=frameSources.length?'frame-src '+frameSources.join(' ')+'; ':'';
      c.header('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'"+allowedForms+"; "+allowedFrames+"base-uri 'none'; frame-ancestors 'none'");
    }
    if(redirectHosts.size&&origin&&c.req.path!=='/healthz') {
      // The Node adapter builds this URL from the request authority, not X-Forwarded-Host.
      const url=new URL(c.req.url);
      if(url.host!==originHost) {
        if(!redirectHosts.has(url.host)||!['GET','HEAD'].includes(c.req.method)) return c.notFound();
        const parts=url.pathname.split('/');
        const target=new URL(origin);
        target.pathname=url.pathname;
        if(parts.length===2&&parts[1]) {
          if(!pool) return c.notFound();
          // A handle path forwards to the Home's current handle on the canonical origin.
          const db=pool,found=await resolveHandle(db,parts[1]);
          if(!found) return c.notFound();
          await publicHome(db,found.homeId);
          target.pathname='/'+found.canonical;
        } else if(url.pathname!=='/') {
          const [,root,id,kind,item,file]=parts;
          const isImage=parts.length===5&&kind==='images'&&uuidPattern.test(item);
          const isSubpage=Boolean(pro?.multipage&&parts.length===5&&kind==='p'&&uuidPattern.test(item));
          const isShareImage=parts.length===5&&kind==='share-image'&&uuidPattern.test(item);
          const isCalendar=parts.length===6&&kind==='calendar'&&uuidPattern.test(item)&&
            file.endsWith('.ics')&&uuidPattern.test(file.slice(0,-4));
          if(root!=='h'||!uuidPattern.test(id??'')||!(parts.length===3||isImage||isCalendar||isShareImage||isSubpage)) return c.notFound();
          const db=requirePool(),home=await publicHome(db,id);
          if(isSubpage) {
            const content=await publicPro(db,id,home.publication_id);
            if(![content?.highlights?.id,content?.recommendations?.id].includes(item)) {
              const known=await db.query('SELECT 1 FROM pro_page_history WHERE home_id=$1 AND page_id=$2',[id,item]);
              if(!known.rowCount) return c.notFound();
            }
          }
          if(isShareImage&&(item!==home.publication_id||!(await approvedPreview(db,home))?.coverId)) return c.notFound();
          if(isImage&&!refers(home.content,item)) return c.notFound();
        }
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
    if(!known) console.error('LINB request failed',requestId,describeFailure(error));
    if(c.req.path.startsWith('/api/')) return c.json({code:known?error.code:'temporarily_unavailable',message:text,
      requestId,...(known&&error.fields?{fields:error.fields}:{})},status as 401);
    return c.html(message(status===404?'This home is not available':status===401?'Sign in again':'LINB could not complete this request',
      status===503?text+' Request ID: '+requestId:text,status===401?(c.req.path.startsWith('/ops')?'/ops/sign-in':'/sign-in'):'/',
      status===401?'Request a sign-in link':'Back to LINB'),status as 401);
  });

  app.get('/healthz',c=>{c.header('Cache-Control','no-store');return c.json({status:'ok'});});
  app.get('/assets/fonts/:file',c=>{
    const bytes=fonts.get(c.req.param('file'));
    if(!bytes) return c.notFound();
    return c.body(new Uint8Array(bytes),200,{'Content-Type':'font/woff2','Cache-Control':'public, max-age=31536000'});
  });
  for(const [file,script] of auraScripts) {
    app.get('/assets/'+file,c=>c.text(script,200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'public, max-age=300'}));
  }
  app.get('/assets/platforms/:file',c=>{
    const file=c.req.param('file');
    const asset=file.endsWith('.svg')?platformIcons.get(file.slice(0,-4)):undefined;
    if(!asset) throw unavailable();
    return c.text(asset,200,{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'public, max-age=300'});
  });
  app.get('/assets/skin/:version/:file',c=>{
    // The address holds the source colours of an art palette, so the answer never changes for one address.
    const colours=c.req.param('version')===String(paletteVersion)?skinColours(c.req.param('file')):null;
    const palette=colours&&artPalette(colours);
    if(!palette) return c.notFound();
    return c.text(paletteCss(palette),200,{'Content-Type':'text/css; charset=utf-8','Cache-Control':'public, max-age=31536000, immutable'});
  });
  app.get('/assets/linb.svg',c=>c.text(brandIcon,200,{'Content-Type':'image/svg+xml','Cache-Control':'public, max-age=300'}));
  app.get('/assets/lobby.css',c=>c.text(stylesheet,200,{'Content-Type':'text/css; charset=utf-8','Cache-Control':'public, max-age=300'}));
  app.get('/assets/player.js',c=>c.text(playerScript,200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'public, max-age=300'}));
  app.get('/assets/share.js',c=>c.text(shareScript,200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'public, max-age=300'}));
  app.get('/assets/editor.js',c=>c.text(editorScript,200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'public, max-age=300'}));
  app.get('/assets/card-layout.js',c=>c.text(cardLayoutScript,200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'public, max-age=300'}));
  app.get('/assets/preview.js',c=>c.text(previewScript,200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'public, max-age=300'}));
  app.get('/assets/verify.js',c=>c.text(verifyScript,200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'public, max-age=300'}));
  app.get('/',c=>c.html(landing(Boolean(auth),Boolean(config.demo),origin?origin+'/':undefined)));
  app.get('/sign-in',c=>c.html(signIn(false,c.req.query('sent')==='1',Boolean(twitch),c.req.query('twitch'))));
  app.get('/ops/sign-in',c=>c.html(signIn(true,c.req.query('sent')==='1')));
  for(const [path,kind] of [['/sign-in','login'],['/ops/sign-in','operator']] as const) {
    app.post(path,async c=>{
      sameOrigin(c);
      const fields=await c.req.parseBody();
      await requireAuth().requestLink(fields.mailbox,config.clientAddress?.(c)??'local',kind);
      return c.redirect(path+'?sent=1',303);
    });
  }
  if(twitch) {
    app.post('/auth/twitch',async c=>{
      sameOrigin(c);
      const started=await twitch.begin('sign-in');
      setCookie(c,twitchState,started.state,twitchCookie);
      return c.redirect(started.url,303);
    });
    app.post('/account/twitch',async c=>{
      const creator=await principal(c,'creator'),fields=await c.req.parseBody(),sid=cookie(c)!;
      checkCsrf(c,fields.csrf);
      if(!await twitch.recentEmail(sid,creator)) return c.redirect('/account?twitch=verify',303);
      if(fields.action==='unlink') {
        await twitch.unlink(creator);
        return c.redirect('/account?twitch=unlinked',303);
      }
      const started=await twitch.begin('link',sid);
      setCookie(c,twitchState,started.state,twitchCookie);
      return c.redirect(started.url,303);
    });
    app.get(twitchCallback,async c=>{
      c.header('Referrer-Policy','no-referrer');
      const state=getCookie(c,twitchState);
      deleteCookie(c,twitchState,twitchCookie);
      try {
        const result=await twitch.finish(c.req.query('state'),state,c.req.query('code'),cookie(c));
        if(result.sid) setCookie(c,name,result.sid,cookieOptions);
        if(result.pending) setCookie(c,twitchPending,result.pending,twitchCookie);
        return c.redirect(result.destination,303);
      } catch {
        return c.redirect('/sign-in?twitch=retry',303);
      }
    });
  }
  app.get('/verify',c=>c.html(confirmation()));
  app.post('/verify',async c=>{
    sameOrigin(c);
    const fields=await c.req.parseBody();
    const result=await requireAuth().redeem(fields.token,twitch?getCookie(c,twitchPending):undefined);
    if(twitch) deleteCookie(c,twitchPending,twitchCookie);
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
    const connection=twitch?await db.query('SELECT login FROM twitch_identities WHERE creator_id=$1',[creator]):null;
    const home=await db.query<{id:string}>('SELECT id FROM homes WHERE owner_id=$1',[creator]);
    const host=new URL(origin??c.req.url).host;
    const current=home.rows[0]?await homeHandle(db,home.rows[0].id):null,offer=(await handleOffer(db,creator))?.handle;
    return c.html(accountPage(rows[0].mailbox,change.rows[0],csrf(cookie(c)!),contact??null,
      c.req.query('sent')==='1'?'Check both mailboxes for verification links.':undefined,
      connection?{linked:Boolean(connection.rowCount),login:connection.rows[0]?.login,status:c.req.query('twitch')}:undefined,Boolean(billing),
      {current:current?host+'/'+current:null,offer:offer?host+'/'+offer:null}));
  });
  app.post('/account/handle',async c=>{
    const creator=await principal(c,'creator'),fields=await c.req.parseBody();
    checkCsrf(c,fields.csrf);
    requireHomeWrites();
    await acceptHandle(requirePool(),creator);
    return c.redirect('/account',303);
  });
  if(billing) {
    app.get('/account/billing',async c=>{
      const owner=await principal(c,'creator'),db=requirePool(),state=await editor(db,owner);
      const home=state.publication_id&&!state.held?await publicHome(db,state.id):null;
      return c.html(billingPage(home,csrf(cookie(c)!),await billing.status(owner),c.req.query('return')==='1'));
    });
    app.post('/account/billing',async c=>{
      const owner=await principal(c,'creator'),db=requirePool(),fields=await c.req.parseBody();
      checkCsrf(c,fields.csrf);
      const {rowCount}=await db.query(`SELECT 1 FROM sessions WHERE digest=$1 AND creator_id=$2 AND revoked_at IS NULL
        AND expires_at>now() AND mailbox_proved_at>now()-interval '15 minutes'`,[digest(cookie(c)!),owner]);
      if(!rowCount) throw new AppError(401,'sign_in','Verify your mailbox again before managing billing.');
      if(fields.action==='portal') return c.redirect(await billing.portal(owner),303);
      const home=await publicHome(db,(await editor(db,owner)).id);
      if(fields.action!=='checkout'||fields.approved!=='1'||fields.publication!==home.publication_id) throw invalid('approval','Review the exact Free page before trying checkout.');
      return c.redirect(await billing.checkout(owner,home),303);
    });
    app.post('/webhooks/stripe',async c=>{
      await billing.receive(await c.req.text(),c.req.header('stripe-signature')??'');
      return c.json({received:true});
    });
  }
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
    const state=await editor(requirePool(),owner);
    const linked=twitch&&!state.draft_revision?await requirePool().query('SELECT login FROM twitch_identities WHERE creator_id=$1',[owner]):null;
    const clips=Boolean(await linkedChannel(requirePool(),owner,state.content));
    return c.html(editorPage(state,csrf(cookie(c)!),Boolean(objects),linked?.rows[0]?.login,Boolean(pro&&state.publication_id),clips));
  });
  if(pro) {
    app.get('/editor/pro',async c=>{
      const owner=await principal(c,'creator'),db=requirePool(),state=await editor(db,owner);
      if(!state.publication_id) throw unavailable();
      const draft=await proDraft(db,state.id);
      return c.html(proEditor(state,draft,csrf(cookie(c)!),pro.multipage,Boolean((await billing!.status(owner))?.active),c.req.query('review')==='1'&&draft.revision>0));
    });
    app.post('/editor/pro',async c=>{
      const owner=await principal(c,'creator'),db=requirePool(),state=await editor(db,owner),fields=await c.req.parseBody();
      checkCsrf(c,fields.csrf);
      if(!state.publication_id) throw unavailable();
      const draft=await proDraft(db,state.id);
      const content=normalizePro(fields,draft,pro.multipage);
      const version=typeof fields.version==='string'&&/^\d{1,9}$/.test(fields.version)?Number(fields.version):null;
      const saved=version===null?null:await db.query('UPDATE pro_drafts SET content=$1,revision=revision+1 WHERE home_id=$2 AND revision=$3',
        [content,state.id,version]);
      if(!saved?.rowCount) throw new AppError(409,'conflict','The Pro draft changed. Reopen it before saving.');
      return c.redirect('/editor/pro?review=1',303);
    });
    for(const kind of ['preview','free-preview'] as const) app.post('/editor/pro/'+kind,async c=>{
      const owner=await principal(c,'creator'),db=requirePool(),state=await editor(db,owner),fields=await c.req.parseBody();
      checkCsrf(c,fields.csrf);
      if(state.draft_revision!==Number(fields.revision)) throw new AppError(409,'conflict','The Free draft changed. Review it again.');
      const draft=kind==='preview'?await proDraft(db,state.id):null;
      const page=typeof fields.page==='string'&&fields.page?fields.page:undefined;
      if(draft&&(draft.revision!==Number(fields.version)||(page&&![draft.content.highlights?.id,draft.content.recommendations?.id].includes(page)))) throw unavailable();
      return c.html(renderHome(state.content,{now:clock(),preview:true,asset:id=>'/editor/assets/'+id,
        pro:draft?.content,currentPage:page}));
    });
    app.post('/editor/pro/publish',async c=>{
      const owner=await principal(c,'creator'),fields=await c.req.parseBody();
      checkCsrf(c,fields.csrf);
      requireHomeWrites();
      if(fields.approved!=='1') throw invalid('approved','Review the Free fallback and Pro pages before publishing.');
      await mutate(requirePool(),owner,'publish',{revision:Number(fields.revision),proVersion:Number(fields.version),
        publicationId:fields.publication||null,operationId:fields.operation},clock(),pro);
      return c.redirect('/editor',303);
    });
  }
  const selection=(value:Record<string,unknown>):Selection=>({name:value.name==='1',intro:value.intro==='1',image:value.image==='1'});
  const shareProof=(session:string,pub:string,fingerprint:string)=>createHmac('sha256',session).update('lobby:preview:'+pub+':'+fingerprint).digest('hex');
  app.get('/editor/share',async c=>{
    const db=requirePool(),owner=await principal(c,'creator'),state=await editor(db,owner);
    const home=await publicHome(db,state.id);
    const selected=c.req.query('review')==='1'?selection(c.req.query()):null;
    const proof=selected?shareProof(cookie(c)!,home.publication_id,previewFingerprint(home.content,selected)):null;
    const handle=await homeHandle(db,home.id);
    return c.html(editorShare(home,(origin??new URL(c.req.url).origin)+(handle?'/'+handle:'/h/'+home.id),csrf(cookie(c)!),
      await approvedPreview(db,home),selected,proof,clock()));
  });
  app.post('/editor/share',async c=>{
    const db=requirePool(),owner=await principal(c,'creator'),fields=await c.req.parseBody();
    checkCsrf(c,fields.csrf);
    const state=await editor(db,owner);
    if(fields.action==='disable') {
      await db.query('DELETE FROM share_preview_consents WHERE home_id=$1',[state.id]);
      return c.redirect('/editor/share',303);
    }
    const home=await publicHome(db,state.id);
    const selected=selection(fields);
    if(fields.action!=='enable'||fields.publication!==home.publication_id||!Object.values(selected).some(Boolean)||
        (selected.image&&!objects)||(selected.image&&!home.content.coverId)) throw invalid('preview','Review the current preview and select at least one available field.');
    const fingerprint=previewFingerprint(home.content,selected);
    if(typeof fields.proof!=='string'||!equalSecret(fields.proof,shareProof(cookie(c)!,home.publication_id,fingerprint))) throw forbidden();
    const consent=await transaction(db,async client=>{
      await client.query('SELECT id FROM homes WHERE id=$1 FOR UPDATE',[home.id]);
      return client.query(`INSERT INTO share_preview_consents(home_id,selection,fingerprint)
      SELECT id,$2,$3 FROM homes h WHERE id=$1 AND publication_id=$4
        AND NOT EXISTS(SELECT 1 FROM visibility_holds v WHERE v.home_id=h.id AND v.released_at IS NULL)
      ON CONFLICT(home_id) DO UPDATE SET selection=excluded.selection,fingerprint=excluded.fingerprint,enabled_at=now()`,
      [home.id,selected,fingerprint,home.publication_id]);
    });
    if(!consent.rowCount) throw unavailable();
    return c.redirect('/editor/share',303);
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
    const now=clock();
    const content=normalizeHome(parseJson(fields.content),state.content,now,true);
    if(content.updates.length) {
      const {rows}=await db.query('SELECT update_id, first_published_at FROM update_dates WHERE home_id=$1',[state.id]);
      const dates=new Map(rows.map(row=>[row.update_id,row.first_published_at.toISOString()]));
      for(const update of content.updates) update.firstPublishedAt=dates.get(update.id);
    }
    const prior=state.publication_id?await db.query<{content:StoredHome;schedule_change:ScheduleChange|null}>(
      'SELECT content,schedule_change FROM publications WHERE home_id=$1 AND id=$2',[state.id,state.publication_id]):null;
    const current=prior?.rows[0];
    const notice=current?scheduleChange(readHome(current.content,state.id),content,now,current.schedule_change):null;
    const embedded=fields.embedded==='1';
    if(embedded) {
      const policy=c.res.headers.get('Content-Security-Policy')!;
      c.header('Content-Security-Policy',policy.replace("frame-ancestors 'none'","frame-ancestors 'self'"));
      c.header('X-Frame-Options','SAMEORIGIN');
    }
    const channel=await linkedChannel(db,owner,content);
    const signal=channel?await activity!.get(channel,content.layout.spotlight.offlineLead==='clip'):undefined;
    return c.html(renderHome(content,{now,notice,liveState:signal,preview:true,embedded,editCanvas:embedded&&fields.mode==='edit',phone:fields.width==='phone',asset:id=>'/editor/assets/'+id}));
  });
  for(const action of ['save','publish','unpublish'] as const) {
    app.post('/api/editor/'+action,async c=>{
      const owner=await principal(c,'creator');
      checkCsrf(c,c.req.header('x-csrf-token'));
      requireHomeWrites();
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
  app.get('/h/:homeId/share-image/:publicationId',async c=>{
    const db=requirePool(),home=await publicHome(db,c.req.param('homeId'));
    if(home.publication_id!==c.req.param('publicationId')) throw unavailable();
    const approved=await approvedPreview(db,home);
    if(!approved?.coverId) throw unavailable();
    const bytes=await assetBytes(db,objects,home.owner_id,approved.coverId);
    const current=await publicHome(db,home.id);
    if(current.publication_id!==home.publication_id||(await approvedPreview(db,current))?.coverId!==approved.coverId) throw unavailable();
    return sendImage(bytes);
  });
  for(const method of ['get','post'] as const) {
    app[method]('/h/:homeId/report',async c=>{
      const db=requirePool(),home=await publicHome(db,c.req.param('homeId'));
      const url=(origin??new URL(c.req.url).origin)+'/h/'+home.id;
      if(method==='get') return c.html(reportPage(home.id,url,reportReasons));
      sameOrigin(c);
      const fields=await c.req.parseBody();
      try { await acceptReport(db,home,config.clientAddress?.(c)??'local',fields); }
      catch(error) {
        if(error instanceof AppError) return c.html(reportPage(home.id,url,reportReasons,fields,error.message),error.status as 422);
        return c.html(reportPage(home.id,url,reportReasons,fields,'The report could not be submitted. Try again.'),503);
      }
      return c.html(message('Report received','An operator can review your report.','/h/'+home.id,'Return to the creator page'),201);
    });
  }
  async function renderPublicHome(c:Context,id:string) {
    const db=requirePool(),home=await publicHome(db,id);
    const siteOrigin=origin??new URL(c.req.url).origin;
    const homeUrl=siteOrigin+'/h/'+home.id;
    // The stable ID address stays. A Home with a handle names the handle address as canonical.
    const handle=await homeHandle(db,home.id);
    const canonical=handle?siteOrigin+'/'+handle:homeUrl;
    const channel=await linkedChannel(db,home.owner_id,home.content);
    const fixture=await liveState(home.id,config.demo?c.req.query('demo-live'):undefined);
    const signal=fixture.live?fixture:channel?await activity!.get(channel,home.content.layout.spotlight.offlineLead==='clip'):fixture;
    const paid=pro?await publicPro(db,home.id,home.publication_id):null;
    if(paid&&!pro?.multipage) { paid.highlights=null; paid.recommendations=null; }
    const preview=await approvedPreview(db,home)??previewFields(home.content,{name:false,intro:false,image:false});
    if(channel) {
      const current=await publicHome(db,id,channel.subject);
      if(current.publication_id!==home.publication_id) throw unavailable();
    }
    return c.html(renderHome(home.content,{now:clock(),liveState:signal,refreshActivity:Boolean(channel),appHandoff:config.appHandoff,
      report:'/h/'+home.id+'/report',homeId:home.id,pro:paid,notice:home.schedule_change,asset:id=>'/h/'+home.id+'/images/'+id,canonical,
      metadata:{title:preview.title,description:preview.description,
        image:preview.coverId?homeUrl+'/share-image/'+home.publication_id:undefined}}));
  }
  app.get('/h/:homeId',c=>renderPublicHome(c,c.req.param('homeId')));

  if(pro?.multipage) app.get('/h/:homeId/p/:pageId',async c=>{
    const db=requirePool(),home=await publicHome(db,c.req.param('homeId')),page=c.req.param('pageId');
    if(!uuidPattern.test(page)) throw unavailable();
    const paid=await publicPro(db,home.id,home.publication_id);
    if(!paid||![paid.highlights?.id,paid.recommendations?.id].includes(page)) {
      const known=await db.query('SELECT 1 FROM pro_page_history WHERE home_id=$1 AND page_id=$2',[home.id,page]);
      if(!known.rowCount) throw unavailable();
      return c.html(message('This page is no longer available','The creator’s Home is still available.','/h/'+home.id,'Open creator home'),410);
    }
    return c.html(renderHome(home.content,{now:clock(),asset:id=>'/h/'+home.id+'/images/'+id,pro:paid,
      homeId:home.id,currentPage:page,canonical:(origin??new URL(c.req.url).origin)+'/h/'+home.id+'/p/'+page}));
  });
  app.post('/ops/fan-reports/:id/resolve',async c=>{
    const actor=await principal(c,'operator'), fields=await c.req.parseBody(),id=c.req.param('id');
    checkCsrf(c,fields.csrf);
    if(!uuidPattern.test(id)) throw unavailable();
    await requirePool().query('UPDATE fan_reports SET resolved_at=now(),resolved_by=$1 WHERE id=$2 AND resolved_at IS NULL',[actor,id]);
    return c.redirect('/ops',303);
  });
  app.get('/ops',async c=>{
    const actor=await principal(c,'operator');
    return c.html(opsPage(await cases(requirePool(),actor),csrf(cookie(c)!),holdReasons,await reportInbox(requirePool())));
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
    return c.html(renderHome(result.content,{now:clock(),review:true,pro:pro?result.pro:null,
      proBase:'/ops/cases/'+id+'/publication/'+result.publicationId,asset:asset=>'/ops/cases/'+id+'/publication/'+result.publicationId+'/images/'+asset}));
  });
  if(pro?.multipage) app.get('/ops/cases/:id/publication/:publicationId/p/:pageId',async c=>{
    const actor=await principal(c,'operator'),id=c.req.param('id'),publication=c.req.param('publicationId'),page=c.req.param('pageId');
    if(!uuidPattern.test(publication)||!uuidPattern.test(page)) throw unavailable();
    const result=await inspectPublication(requirePool(),actor,id,undefined,publication);
    if(!result.content||!result.pro||![result.pro.highlights?.id,result.pro.recommendations?.id].includes(page)) throw unavailable();
    return c.html(renderHome(result.content,{now:clock(),review:true,pro:result.pro,
      proBase:'/ops/cases/'+id+'/publication/'+publication,currentPage:page,asset:asset=>'/ops/cases/'+id+'/publication/'+publication+'/images/'+asset}));
  });
  if(pro) app.get('/ops/cases/:id/publication/:publicationId',async c=>{
    const actor=await principal(c,'operator'),id=c.req.param('id'),publication=c.req.param('publicationId');
    const result=await inspectPublication(requirePool(),actor,id,undefined,publication);
    if(!result.content) throw unavailable();
    return c.html(renderHome(result.content,{now:clock(),review:true,pro:result.pro,
      proBase:'/ops/cases/'+id+'/publication/'+publication,asset:asset=>'/ops/cases/'+id+'/publication/'+publication+'/images/'+asset}));
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
  if(config.demo) app.get('/demo/leaderboard',c=>c.html(leaderboardDemo(clock(),c.req.query('state')==='low')));
  if(config.demo) app.get('/demo',async c=>{
    const quiet=c.req.query('state')==='quiet';
    const future=new Date(clock()+86400000);
    const content={...emptyHome,displayName:'Mira Vale',intro:'Cozy strategy, questionable shortcuts.',game:'Hades II',
      streamUrl:'https://www.twitch.tv/',theme:'Nebula' as const,links:[{label:'Stream archive',url:'https://www.youtube.com/'}],
      updates:[{id:randomUUID(),text:'Another attempt at the surface route next time.',firstPublishedAt:new Date(clock()).toISOString()}],
      sessions:quiet?[]:[{id:randomUUID(),title:'Surface route practice',local:future.toISOString().slice(0,16),zone:'UTC',offset:'+00:00',instant:future.toISOString()}]};
    return c.html(renderHome(content,{now:clock(),asset:()=>'',demo:true,liveState:await liveState('demo',c.req.query('demo-live'))}));
  });
  // Every route above wins over a handle. An earlier handle or another letter case forwards to the current handle.
  app.get('/:handle',async c=>{
    if(!pool) return c.notFound();
    const db=pool,raw=c.req.param('handle'),found=await resolveHandle(db,raw);
    if(!found) return c.notFound();
    if(raw===found.canonical) return renderPublicHome(c,found.homeId);
    await publicHome(db,found.homeId);
    return c.redirect('/'+found.canonical,308);
  });
  app.notFound(c=>c.html(message('This home is not available','The requested page is unavailable.'),404));
  return app;
}

export const app=createApp();
