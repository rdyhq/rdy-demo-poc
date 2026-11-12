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
import { Auth, throttle, type SendMail } from './auth.ts';
import { AppError, digest, emptyHome, equalSecret, invalid, mailbox, scheduleChange, themeNames, unavailable, uuidPattern, type ScheduleChange } from './domain.ts';
import { invite, inviteList, revokeInvite } from './enrollment.ts';
import { cardColumns, cardHeights, cardSpans, channelPlatform, newHome, normalizeHome, platforms, readHome, type EditableHome, type StoredHome } from './home-cards.ts';
import { liveState } from './live-state.ts';
import { TwitchActivity, type TwitchActivityConfig, type TwitchChannel } from './twitch-activity.ts';
import { acceptHandle, handleOffer, homeHandle, resolveHandle } from './handles.ts';
import { describeFailure } from './failure.ts';
import { accentCss, artPalette, paletteCss, paletteVersion, skinColours, skinPath } from './public/palette.js';
import { applySkin, chooseTheme } from './public/editor-support.js';
import { matchColours, suggestSkin } from './public/art-match.js';
import { accountTab, billingTab, linkTab, lookTab, pageTab, shareTexts, type EditorView } from './editor-screens.ts';
import { artPixels, channelDraft, matchChannel, twitchPicture, type ChannelMatch } from './twitch-channel.ts';
import { renderPage } from './page.ts';
import { buildingPage, confirmPage, landingPage, leavingPage, linksStep, liveStep, lookStep, messagePage, reportPage, signInPage } from './screens.ts';
import { editor, mutate, publicHome, refers } from './homes.ts';
import { approvedPreview, previewFields, previewFingerprint, type Selection } from './sharing.ts';
import { caseAction, caseDetail, cases, holdReasons, inspectPublication, openCase } from './operator.ts';
import { invitesPage, leaderboardDemo, proEditor, opsCase, opsPage, renderHome, retiredCalendar } from './views.ts';

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
const cardLayoutScript=readFileSync(new URL('./public/card-layout.js',import.meta.url),'utf8');
const previewScript=readFileSync(new URL('./public/preview.js',import.meta.url),'utf8');
const verifyScript=readFileSync(new URL('./public/verify.js',import.meta.url),'utf8');
const freshStyles=new Map(['page','app'].map(name=>[name+'.css',readFileSync(new URL('./public/'+name+'.css',import.meta.url),'utf8')]));
const auraScripts=new Map(['aura','handoff','localtime'].map(name=>[
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
  // Open sign-up with Twitch is a setting that an operator can switch off (RDY r-C8Z5D).
  openSignup?:boolean;
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
  const twitch=pool&&auth&&origin&&config.twitch?new Twitch(pool,config.twitch,origin,Boolean(config.openSignup)):null;
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
  // The channel of a creator who just claimed a page, read once for the first draft (RDY r-KQGNH).
  const matches=new Map<string,{until:number;value:Promise<ChannelMatch|null>}>();
  async function channelMatch(owner:string) {
    if(!activity) return null;
    const waiting=matches.get(owner);
    if(waiting&&waiting.until>clock()) return waiting;
    const {rows}=await requirePool().query<{subject:string}>('SELECT subject FROM twitch_identities WHERE creator_id=$1',[owner]);
    if(!rows[0]) return null;
    matches.delete(owner);
    if(matches.size>=200) matches.delete(matches.keys().next().value!);
    const entry={until:clock()+10*60_000,
      value:activity.profile(rows[0].subject).then(profile=>profile?matchChannel(profile,config.twitchActivity!.http):null)};
    matches.set(owner,entry);
    // Twitch gave no profile. Ask again at the next request.
    void entry.value.then(match=>{ if(!match&&matches.get(owner)===entry) matches.delete(owner); },()=>matches.delete(owner));
    return entry;
  }
  // A preview before sign-up waits here. linb.io does not store or publish it (RDY s-W8K47).
  const previews=new Map<string,{until:number;value:Promise<ChannelMatch|null|'unavailable'>}>();
  const previewHome='00000000-0000-4000-8000-000000000000';
  const twitchLogin=(value:unknown)=>{
    const name=typeof value==='string'?value.trim().toLowerCase():'';
    return /^[a-z0-9_]{3,25}$/.test(name)?name:null;
  };
  async function channelPreview(login:string,address:string):Promise<ChannelMatch|null|'limited'|'unavailable'> {
    const waiting=previews.get(login);
    if(waiting&&waiting.until>clock()) return waiting.value;
    // Each new name costs requests to Twitch, so each client address gets a limited number of them.
    if(!(await throttle(requirePool(),'preview:'+address,20))) return 'limited';
    previews.delete(login);
    if(previews.size>=200) previews.delete(previews.keys().next().value!);
    const entry={until:clock()+10*60_000,
      value:activity!.profileByLogin(login).then(profile=>
        profile&&profile!=='unavailable'?matchChannel(profile,config.twitchActivity!.http):profile)};
    previews.set(login,entry);
    // Only a built preview waits. An absent channel or a failed answer is asked again.
    void entry.value.then(match=>{ if((!match||match==='unavailable')&&previews.get(login)===entry) previews.delete(login); },()=>previews.delete(login));
    return entry.value;
  }
  // The picture of a live stream is kept for a minute, so that page views do not each ask the image host.
  const shots=new Map<string,{until:number;value:Promise<Buffer|null>}>();
  async function streamShot(channel:TwitchChannel) {
    const state=await activity!.get(channel);
    if(!state.live||!state.verified||!state.picture) return null;
    const waiting=shots.get(channel.subject);
    if(waiting&&waiting.until>clock()) return waiting.value;
    shots.delete(channel.subject);
    if(shots.size>=200) shots.delete(shots.keys().next().value!);
    const entry={until:clock()+60_000,value:twitchPicture(state.picture,config.twitchActivity!.http)};
    shots.set(channel.subject,entry);
    return entry.value;
  }
  // The clips of a channel for a page. linb.io remembers the picture of each clip that a page showed,
  // and serves only those pictures (RDY r-P20XP).
  const clipShots=new Map<string,{url:string;until:number;bytes?:Promise<Buffer|null>}>();
  async function clipCards(channel:TwitchChannel) {
    const clips=await activity!.clipList(channel);
    for(const clip of clips) {
      const known=clipShots.get(clip.id);
      if(known?.url===clip.picture) { known.until=clock()+3600_000; continue; }
      if(!known&&clipShots.size>=400) clipShots.delete(clipShots.keys().next().value!);
      clipShots.set(clip.id,{url:clip.picture,until:clock()+3600_000});
    }
    return clips.map(clip=>({title:clip.title,url:clip.url,views:clip.views,picture:'/assets/clip/'+clip.id}));
  }
  // The parts of a page that linb.io reads from the linked channel when the page is viewed (RDY D-TBSBC).
  // A part that the creator switched off is not read.
  async function channelParts(channel:TwitchChannel|undefined,content:EditableHome) {
    if(!channel) return {};
    const [clips,schedule]=await Promise.all([
      content.layout.clipsHidden?undefined:clipCards(channel),
      content.layout.supporting.find(card=>card.family==='schedule')?.hidden?undefined:activity!.schedule(channel)]);
    return {clips,schedule};
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
      const allowedForms=billing?' https://checkout.stripe.com https://billing.stripe.com':'';
      const frameSources=[...(['/editor','/editor/look','/editor/link'].includes(c.req.path)?["'self'"]:[]),...(pro?['https://www.youtube-nocookie.com']:[])];
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
      await (c.req.path==='/api/editor/assets'||c.req.path==='/editor/art'?fileLimit:limit)(c,next);
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
    return c.html(messagePage(status===404?'This home is not available':status===401?'Sign in again':'LINB could not complete this request',
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
    const current=c.req.param('version')===String(paletteVersion), file=c.req.param('file');
    const colours=current?skinColours(file):null;
    const palette=colours&&artPalette(colours);
    const styles=palette?paletteCss(palette):current?accentCss(file):null;
    if(!styles) return c.notFound();
    return c.text(styles,200,{'Content-Type':'text/css; charset=utf-8','Cache-Control':'public, max-age=31536000, immutable'});
  });
  app.get('/assets/linb.svg',c=>c.text(brandIcon,200,{'Content-Type':'image/svg+xml','Cache-Control':'public, max-age=300'}));
  for(const [file,styles] of freshStyles) {
    app.get('/assets/'+file,c=>c.text(styles,200,{'Content-Type':'text/css; charset=utf-8','Cache-Control':'public, max-age=300'}));
  }
  app.get('/assets/lobby.css',c=>c.text(stylesheet,200,{'Content-Type':'text/css; charset=utf-8','Cache-Control':'public, max-age=300'}));
  app.get('/assets/player.js',c=>c.text(playerScript,200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'public, max-age=300'}));
  app.get('/assets/share.js',c=>c.text(shareScript,200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'public, max-age=300'}));
  app.get('/assets/card-layout.js',c=>c.text(cardLayoutScript,200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'public, max-age=300'}));
  app.get('/assets/preview.js',c=>c.text(previewScript,200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'public, max-age=300'}));
  app.get('/assets/verify.js',c=>c.text(verifyScript,200,{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'public, max-age=300'}));
  app.get('/',c=>c.html(landingPage({preview:Boolean(activity&&pool),missing:twitchLogin(c.req.query('missing'))??undefined,
    invalid:c.req.query('invalid')==='1',limited:c.req.query('limited')==='1',unavailable:c.req.query('unavailable')==='1',closed:!twitch?.openSignup,canonical:origin?origin+'/':undefined})));
  app.get('/preview',c=>{
    if(!activity||!pool) return c.redirect('/',303);
    const login=twitchLogin(c.req.query('name'));
    return login?c.html(buildingPage(login)):c.redirect('/?invalid=1',303);
  });
  app.get('/preview/page',async c=>{
    if(!activity||!pool) return c.redirect('/',303);
    const login=twitchLogin(c.req.query('name'));
    if(!login) return c.redirect('/?invalid=1',303);
    const match=await channelPreview(login,config.clientAddress?.(c)??'local');
    if(match==='limited') return c.redirect('/?limited=1',303);
    if(match==='unavailable') return c.redirect('/?unavailable=1',303);
    if(!match) return c.redirect('/?missing='+login,303);
    const {profile,art}=match;
    const content=channelDraft(readHome(newHome(previewHome),previewHome),match,{avatar:art.avatar&&'avatar',banner:art.banner&&'banner'});
    c.header('Cache-Control','no-store');
    return c.html(renderPage(content,{now:clock(),claim:twitch?profile.login:undefined,
      liveState:await activity.get({subject:profile.subject,login:profile.login}),stream:'/preview/art/'+profile.login+'/stream',
      ...await channelParts({subject:profile.subject,login:profile.login},content),
      asset:kind=>'/preview/art/'+profile.login+'/'+kind}));
  });
  app.get('/preview/art/:login/:kind',async c=>{
    const waiting=previews.get(c.req.param('login'));
    const match=waiting&&waiting.until>clock()?await waiting.value:null;
    const kind=c.req.param('kind');
    const found=match&&match!=='unavailable'?match:null;
    const bytes=found&&kind==='stream'?await streamShot({subject:found.profile.subject,login:found.profile.login})
      :found&&(kind==='avatar'||kind==='banner')?found.art[kind]:null;
    if(!bytes) throw unavailable();
    return sendImage(bytes);
  });
  app.get('/sign-in',c=>c.html(signInPage({sent:c.req.query('sent')==='1',twitch:Boolean(twitch),state:c.req.query('twitch')})));
  app.get('/ops/sign-in',c=>c.html(signInPage({operator:true,sent:c.req.query('sent')==='1'})));
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
      return c.html(leavingPage(started.url));
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
      return c.html(leavingPage(started.url));
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
  app.get('/verify',c=>c.html(confirmPage()));
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
    return c.html(accountTab(await editorView(c,creator),{email:rows[0].mailbox,change:change.rows[0],contact:contact??null,
      notice:c.req.query('sent')==='1'?'Check both mailboxes for verification links.':undefined,
      twitch:connection?{linked:Boolean(connection.rowCount),login:connection.rows[0]?.login,status:c.req.query('twitch')}:undefined,billing:Boolean(billing),
      handle:{current:current?host+'/'+current:null,offer:offer?host+'/'+offer:null}}));
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
      return c.html(billingTab(await editorView(c,owner),home,await billing.status(owner),c.req.query('return')==='1'));
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
  app.get('/account/proof-received',c=>c.html(messagePage('Proof received','Confirm the other mailbox to complete the change.','/account','Return to account')));
  app.get('/account/mailbox-changed',c=>c.html(messagePage('Mailbox changed','Sign in with your new mailbox.','/sign-in','Sign in')));
  // The editor of the fresh start (RDY s-P8ZS4). Each action saves to the draft by itself; Publish puts the draft online.
  const editorView=async(c:Context,owner:string,error?:string):Promise<EditorView>=>{
    const db=requirePool(), state=await editor(db,owner);
    const handle=state.publication_id&&!state.held?await homeHandle(db,state.id):null;
    const path=state.publication_id&&!state.held?(handle?'/'+handle:'/h/'+state.id):undefined;
    return {state,csrf:csrf(cookie(c)!),error,path,address:path&&(originHost??new URL(c.req.url).host)+path,
      url:path&&(origin??new URL(c.req.url).origin)+path,
      twitch:Boolean(await linkedChannel(db,owner,state.content))};
  };
  // One editor action: check the request, change the draft, and return to the tab. A refused change shows on the same tab.
  function editorAction(path:string,tab:(view:EditorView)=>unknown,back:string,
    act:(owner:string,state:Awaited<ReturnType<typeof editor>>,fields:Record<string,unknown>)=>Promise<void>) {
    app.post(path,async c=>{
      const owner=await principal(c,'creator');
      const fields=await c.req.parseBody();
      checkCsrf(c,fields.csrf);
      requireHomeWrites();
      try {
        await act(owner,await editor(requirePool(),owner),fields);
      } catch(error) {
        if(!(error instanceof AppError)||error.status!==422) throw error;
        const message=Object.values(error.fields??{})[0]??error.message;
        return c.html(tab(await editorView(c,owner,message)) as string,422);
      }
      return c.redirect(back,303);
    });
  }
  const saveDraft=(owner:string,state:{draft_revision:number},content:EditableHome)=>
    mutate(requirePool(),owner,'save',{operationId:randomUUID(),revision:state.draft_revision,content},clock());
  app.get('/editor',async c=>c.html(pageTab(await editorView(c,await principal(c,'creator')))));
  app.get('/editor/look',async c=>c.html(lookTab(await editorView(c,await principal(c,'creator')))));
  app.get('/editor/link',async c=>c.html(linkTab(await editorView(c,await principal(c,'creator')))));
  app.get('/editor/view',async c=>{
    const owner=await principal(c,'creator');
    const state=await editor(requirePool(),owner);
    const policy=c.res.headers.get('Content-Security-Policy')!;
    c.header('Content-Security-Policy',policy.replace("frame-ancestors 'none'","frame-ancestors 'self'"));
    c.header('X-Frame-Options','SAMEORIGIN');
    c.header('Cache-Control','no-store');
    // The preview of a draft shows the clips that the published page shows.
    const channel=await linkedChannel(requirePool(),owner,state.content);
    return c.html(renderPage(state.content,{now:clock(),asset:id=>'/editor/assets/'+id,...await channelParts(channel,state.content)}));
  });
  editorAction('/editor/profile',pageTab,'/editor',async(owner,state,fields)=>{
    const {displayName,intro,game,streamUrl}=fields;
    await saveDraft(owner,state,{...state.content,displayName,intro,game,streamUrl} as EditableHome);
  });
  editorAction('/editor/links',pageTab,'/editor',async(owner,state,fields)=>{
    const links=[...state.content.links], index=Number(fields.index);
    const at=()=>{
      if(!Number.isInteger(index)||index<0||index>=links.length) throw invalid('index','Choose a link of your page.');
      return index;
    };
    if(fields.action==='add') links.push({label:fields.label,url:fields.url} as EditableHome['links'][number]);
    else if(fields.action==='remove') links.splice(at(),1);
    else if(fields.action==='up'||fields.action==='down') {
      const from=at(), to=from+(fields.action==='up'?-1:1);
      if(to<0||to>=links.length) throw invalid('index','That link is already at the end.');
      [links[from],links[to]]=[links[to],links[from]];
    } else throw invalid('action','Choose an action.');
    await saveDraft(owner,state,{...state.content,links});
  });
  // The creator switches a part from Twitch off or on (RDY r-RA9HG). The choice is in the draft, as every change is.
  editorAction('/editor/twitch',pageTab,'/editor',async(owner,state,fields)=>{
    const hidden=fields.show==='0'?true:fields.show==='1'?false:null;
    if(hidden===null) throw invalid('show','Choose On or Off.');
    const layout=structuredClone(state.content.layout);
    if(fields.part==='clips') layout.clipsHidden=hidden;
    else if(fields.part==='schedule') layout.supporting=layout.supporting.map(card=>card.family==='schedule'?{...card,hidden}:card);
    else throw invalid('part','Choose the schedule or the clips.');
    await saveDraft(owner,state,{...state.content,layout});
  });
  editorAction('/editor/art',pageTab,'/editor',async(owner,state,fields)=>{
    const field=fields.kind==='avatar'?'avatarId':fields.kind==='banner'?'coverId':null;
    if(!field) throw invalid('kind','Choose the avatar or the banner.');
    let id:string|null=null;
    if(fields.action!=='remove') {
      if(!objects) throw new AppError(503,'storage_unavailable','Image storage is unavailable.');
      id=(await upload(requirePool(),objects,owner,fields.image as File)).id;
    }
    await saveDraft(owner,state,{...state.content,[field]:id});
  });
  editorAction('/editor/look',lookTab,'/editor/look',async(owner,state,fields)=>{
    const content=structuredClone(state.content);
    if(fields.action==='match') {
      // Match my art reads the stored avatar and banner again (RDY r-GXT5V).
      const read=async(id:string|null)=>id?artPixels(await assetBytes(requirePool(),objects,owner,id).catch(()=>null)):null;
      const [avatar,banner]=[await read(content.avatarId),await read(content.coverId)];
      const skin=suggestSkin(matchColours({avatar,banner}),banner?'banner':'avatar');
      if(!skin) throw invalid('look','Add an avatar or a banner first.');
      applySkin(content,skin);
    } else if(fields.look==='art') {
      if(!content.aura.palette) throw invalid('look','Match your art first.');
      return;
    } else {
      if(typeof fields.look!=='string'||!(themeNames as readonly string[]).includes(fields.look)) throw invalid('look','Choose a look.');
      chooseTheme(content,fields.look,null);
    }
    await saveDraft(owner,state,content);
  });
  editorAction('/editor/publish',pageTab,'/editor',async(owner,state)=>{
    await mutate(requirePool(),owner,'publish',{operationId:randomUUID(),revision:state.draft_revision,publicationId:state.publication_id},clock());
  });
  editorAction('/editor/unpublish',linkTab,'/editor/link',async(owner,state)=>{
    if(state.publication_id) await mutate(requirePool(),owner,'unpublish',{operationId:randomUUID(),publicationId:state.publication_id},clock());
  });

  // The setup after a claim (RDY r-FYDDP): two steps that the creator can skip, then the address of the page.
  const platformNames:Record<string,[string,string,RegExp]>={
    youtube:['YouTube','https://www.youtube.com/@',/^@?([\w.-]{3,30})$/], tiktok:['TikTok','https://www.tiktok.com/@',/^@?([\w.]{2,24})$/],
    x:['X','https://x.com/',/^@?(\w{1,15})$/], instagram:['Instagram','https://www.instagram.com/',/^@?([\w.]{1,30})$/],
    kick:['Kick','https://kick.com/',/^@?(\w{3,25})$/],
  };
  // The claimed draft takes its fields from the Twitch channel (RDY r-KQGNH). A failure leaves the empty draft.
  async function firstDraft(owner:string,state:Awaited<ReturnType<typeof editor>>) {
    const match=config.readOnlyHomes?null:await (await channelMatch(owner))?.value;
    if(!match) return state;
    const db=requirePool(), art={avatar:null as string|null,banner:null as string|null};
    try {
      for(const kind of ['avatar','banner'] as const) {
        const bytes=match.art[kind];
        if(bytes&&objects) art[kind]=(await upload(db,objects,owner,new File([Uint8Array.from(bytes)],kind+'.webp',{type:'image/webp'}))).id;
      }
      await mutate(db,owner,'save',{operationId:randomUUID(),revision:0,content:channelDraft(state.content,match,art)},clock());
    } catch { return state; }
    matches.delete(owner);
    return editor(db,owner);
  }
  const operationOf=(fields:Record<string,unknown>)=>{
    const operationId=fields.operationId;
    if(typeof operationId!=='string'||!uuidPattern.test(operationId)) throw invalid('operationId','Provide a valid operation ID.');
    return operationId;
  };
  // A second send of the same form finds the receipt of the first.
  const sentBefore=async(homeId:string,operationId:string)=>
    Boolean((await requirePool().query('SELECT 1 FROM mutation_receipts WHERE home_id=$1 AND operation_id=$2',[homeId,operationId])).rowCount);
  app.get('/start',async c=>{
    const owner=await principal(c,'creator');
    let state=await editor(requirePool(),owner);
    if(state.publication_id) return c.redirect('/start/live',303);
    if(!state.draft_revision) state=await firstDraft(owner,state);
    return c.html(linksStep({csrf:csrf(cookie(c)!),operation:randomUUID()}));
  });
  app.post('/start/links',async c=>{
    const owner=await principal(c,'creator');
    const fields=await c.req.parseBody();
    checkCsrf(c,fields.csrf);
    requireHomeWrites();
    const state=await editor(requirePool(),owner), operationId=operationOf(fields);
    if(await sentBefore(state.id,operationId)) return c.redirect('/start/look',303);
    const links=[...state.content.links], values:Record<string,string>={};
    const refuse=(error:string)=>c.html(linksStep({csrf:csrf(cookie(c)!),operation:operationId,error,values}),422);
    for(const [platform,[label,address,pattern]] of Object.entries(platformNames)) {
      const value=values[platform]=typeof fields[platform]==='string'?(fields[platform] as string).trim():'';
      if(!value) continue;
      const name=pattern.exec(value)?.[1], url=name?address+name:null;
      if(!url||channelPlatform(url)!==platform) return refuse('Check the '+label+' name.');
      if(!links.some(link=>link.url===url)) links.push({label,url});
    }
    if(links.length>5) return refuse('Add up to four here. You can add more in the editor.');
    if(links.length>state.content.links.length) {
      await mutate(requirePool(),owner,'save',{operationId,revision:state.draft_revision,content:{...state.content,links}},clock());
    }
    return c.redirect('/start/look',303);
  });
  app.get('/start/look',async c=>{
    const owner=await principal(c,'creator');
    const state=await editor(requirePool(),owner);
    if(state.publication_id) return c.redirect('/start/live',303);
    const {aura,theme}=state.content;
    const art=aura.palette&&artPalette({...aura.palette,accent:aura.accent});
    return c.html(lookStep({csrf:csrf(cookie(c)!),operation:randomUUID(),theme,skin:art?skinPath(aura.palette,aura.accent):undefined}));
  });
  app.post('/start/look',async c=>{
    const owner=await principal(c,'creator');
    const fields=await c.req.parseBody();
    checkCsrf(c,fields.csrf);
    requireHomeWrites();
    const db=requirePool(), state=await editor(db,owner), operationId=operationOf(fields);
    if(await sentBefore(state.id,operationId)) return c.redirect('/start/live',303);
    const look=fields.look, content=structuredClone(state.content);
    let revision=state.draft_revision;
    if(look!=='art'||!content.aura.palette) {
      if(typeof look!=='string'||!(themeNames as readonly string[]).includes(look)) throw invalid('look','Choose a look.');
      chooseTheme(content,look,null);
      revision=(await mutate(db,owner,'save',{operationId,revision,content},clock())).revision;
    }
    // The matched look needs no save, so the publication carries the operation of the form.
    await mutate(db,owner,'publish',{operationId:revision===state.draft_revision?operationId:randomUUID(),revision,publicationId:state.publication_id},clock());
    return c.redirect('/start/live',303);
  });
  app.get('/start/live',async c=>{
    const owner=await principal(c,'creator');
    const db=requirePool(), state=await editor(db,owner);
    if(!state.publication_id) return c.redirect('/start',303);
    const handle=await homeHandle(db,state.id), path=handle?'/'+handle:'/h/'+state.id;
    return c.html(liveStep({address:(originHost??new URL(c.req.url).host)+path,path}));
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
    return c.html(shareTexts(await editorView(c,owner),home,(origin??new URL(c.req.url).origin)+(handle?'/'+handle:'/h/'+home.id),
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
  app.get('/assets/clip/:id',async c=>{
    const known=clipShots.get(c.req.param('id'));
    if(!known||known.until<=clock()) throw unavailable();
    known.bytes??=twitchPicture(known.url,config.twitchActivity!.http);
    const bytes=await known.bytes;
    if(!bytes) { known.bytes=undefined; throw unavailable(); }
    // The picture of a clip does not change, so a browser can keep it.
    return new Response(Uint8Array.from(bytes),{headers:{'Content-Type':'image/webp','Cache-Control':'public, max-age=3600',
      'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
  });
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
      // The form names the page by the address that fans know: the handle address when the Home has one.
      const handle=await homeHandle(db,home.id);
      const url=(origin??new URL(c.req.url).origin)+(handle?'/'+handle:'/h/'+home.id);
      if(method==='get') return c.html(reportPage(home.id,url,reportReasons));
      sameOrigin(c);
      const fields=await c.req.parseBody();
      try { await acceptReport(db,home,config.clientAddress?.(c)??'local',fields); }
      catch(error) {
        if(error instanceof AppError) return c.html(reportPage(home.id,url,reportReasons,fields,error.message),error.status as 422);
        return c.html(reportPage(home.id,url,reportReasons,fields,'The report could not be submitted. Try again.'),503);
      }
      return c.html(messagePage('Report received','An operator can review your report.','/h/'+home.id,'Return to the creator page'),201);
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
    const metadata={title:preview.title,description:preview.description,
      image:preview.coverId?homeUrl+'/share-image/'+home.publication_id:undefined};
    const asset=(id:string)=>'/h/'+home.id+'/images/'+id;
    // A Home with Pro content keeps the old page until the Pro parts have a place on the new one.
    if(paid) return c.html(renderHome(home.content,{now:clock(),liveState:signal,refreshActivity:Boolean(channel),appHandoff:config.appHandoff,
      report:'/h/'+home.id+'/report',homeId:home.id,pro:paid,notice:home.schedule_change,asset,canonical,metadata}));
    return c.html(renderPage(home.content,{now:clock(),liveState:signal,stream:'/h/'+home.id+'/stream',
      ...await channelParts(channel,home.content),appHandoff:config.appHandoff,
      report:'/h/'+home.id+'/report',notice:home.schedule_change,asset,canonical,metadata}));
  }
  app.get('/h/:homeId',c=>renderPublicHome(c,c.req.param('homeId')));
  app.get('/h/:homeId/stream',async c=>{
    const db=requirePool(),home=await publicHome(db,c.req.param('homeId'));
    const channel=await linkedChannel(db,home.owner_id,home.content);
    const bytes=channel?await streamShot(channel):null;
    if(!bytes) throw unavailable();
    return sendImage(bytes);
  });

  if(pro?.multipage) app.get('/h/:homeId/p/:pageId',async c=>{
    const db=requirePool(),home=await publicHome(db,c.req.param('homeId')),page=c.req.param('pageId');
    if(!uuidPattern.test(page)) throw unavailable();
    const paid=await publicPro(db,home.id,home.publication_id);
    if(!paid||![paid.highlights?.id,paid.recommendations?.id].includes(page)) {
      const known=await db.query('SELECT 1 FROM pro_page_history WHERE home_id=$1 AND page_id=$2',[home.id,page]);
      if(!known.rowCount) throw unavailable();
      return c.html(messagePage('This page is no longer available','The creator’s Home is still available.','/h/'+home.id,'Open creator home'),410);
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
    if(!result.content) return c.html(messagePage('No current publication','The home remains held and no publication is set.','/ops/cases/'+id,'Back to case'));
    const asset=(asset:string)=>'/ops/cases/'+id+'/publication/'+result.publicationId+'/images/'+asset;
    // The reviewer sees the publication on the page that fans see. A Home with Pro content keeps the old page, as it does for fans.
    if(!pro||!result.pro) return c.html(renderPage(result.content,{now:clock(),review:'/ops/cases/'+id,asset}));
    return c.html(renderHome(result.content,{now:clock(),review:true,pro:result.pro,
      proBase:'/ops/cases/'+id+'/publication/'+result.publicationId,asset}));
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
  app.notFound(c=>c.html(messagePage('This home is not available','The requested page is unavailable.'),404));
  return app;
}

export const app=createApp();
