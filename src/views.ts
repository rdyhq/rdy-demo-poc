import { appLink } from './app-link.ts';
import { html, raw } from 'hono/html';
import { randomUUID } from 'node:crypto';
import { futureSessions, nextSession, themeNames, type HomeContent, type ScheduleChange, type SessionSlot } from './domain.ts';
import { channelPlatform, defaultLayout, platforms, cardSpans, cardHeights, promoCategories, type EditableHome } from './home-cards.ts';
import { auraOptions, defaultAura, type Aura } from './aura.ts';
import { artPalette, skinPath } from './public/palette.js';
import type { LiveState } from './live-state.ts';
import { demoRanking } from './leaderboard.ts';
import type { ProContent, ProDraft } from './pro.ts';
import { discordSchedule, type Selection } from './sharing.ts';
import type { HomeState } from './homes.ts';

const mark=html`<img class="mark" src="/assets/linb.svg" width="32" height="32" alt="">`;
const art=html`<svg class="art" viewBox="0 0 920 380" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
<defs><linearGradient id="sky" x2="1" y2="1"><stop stop-color="#131a3b"/><stop offset="1" stop-color="#29276f"/></linearGradient>
<radialGradient id="sun"><stop stop-color="#f4d0ff"/><stop offset=".52" stop-color="#f1a9e9"/><stop offset="1" stop-color="#a070ff"/></radialGradient>
<pattern id="stars" width="56" height="44" patternUnits="userSpaceOnUse"><path d="M0 44h56V0" stroke="#8bb6f5" opacity=".16" fill="none"/><circle cx="37" cy="10" r="1.3" fill="#b9ccff" opacity=".56"/></pattern></defs>
<rect width="920" height="380" fill="url(#sky)"/><rect width="920" height="380" fill="url(#stars)"/>
<circle cx="599" cy="147" r="100" fill="url(#sun)"/><g fill="none" stroke="#e6c6ff"><ellipse cx="599" cy="147" rx="188" ry="29" transform="rotate(-14 599 147)" opacity=".8"/><ellipse cx="599" cy="149" rx="197" ry="38" transform="rotate(-14 599 149)" opacity=".35"/></g>
<path d="m0 344 148-90 54 22 63-64 106 87 83-56 67 58 102-29 78 40 100-56 119 61v63H0Z" fill="#191943"/>
<path d="m0 380 117-48 92 17 112-37 128 47 65-12 88 29 111-46 69 19 138-35v66Z" fill="#14182d"/>
<g fill="#b7d9ff"><circle cx="170" cy="122" r="3"/><circle cx="342" cy="103" r="3"/><circle cx="803" cy="106" r="3"/><path d="M97 54v22m-11-11h22m679 158v19m-9-9h18" stroke="#b7d9ff" stroke-width="1.7"/></g></svg>`;

function frame(title:string,body:any,options:{theme?:string;skin?:{path:string;scheme:string};privatePage?:boolean;script?:boolean;verify?:boolean;preview?:boolean;handoff?:boolean;wide?:boolean;creator?:boolean;canonical?:string;standalone?:boolean;editor?:boolean;cardLayout?:boolean;aura?:boolean;motionSwitch?:boolean;phone?:boolean;share?:boolean;player?:boolean;newTabLinks?:boolean;metadata?:{title:string;description:string;image?:string}}={}) {
  return html`<!doctype html><html lang="en" data-theme="${options.theme??'LINB'}"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="${options.skin?.scheme??(options.theme==='Paper'?'light':'dark')}">
    <title>${title} · LINB</title><link rel="stylesheet" href="/assets/lobby.css?v=art-match">
    ${options.skin?html`<link rel="stylesheet" href="${options.skin.path}">`:''}
    <link rel="icon" href="/assets/linb.svg" type="image/svg+xml">
    ${options.newTabLinks?html`<base target="_blank">`:''}
    ${options.canonical?html`<link rel="canonical" href="${options.canonical}">`:''}
    ${options.metadata?html`<meta property="og:type" content="website"><meta property="og:url" content="${options.canonical}">
      <meta property="og:title" content="${options.metadata.title}"><meta property="og:description" content="${options.metadata.description}">
      ${options.metadata.image?html`<meta property="og:image" content="${options.metadata.image}">`:''}`:''}
    ${options.player?html`<script src="/assets/player.js" defer></script>`:''}
    ${options.share?html`<script src="/assets/share.js?v=2" defer></script>`:''}
    ${options.cardLayout?html`<script src="/assets/card-layout.js?v=1" defer></script>`:''}
    ${options.aura?html`<script src="/assets/aura.js?v=art-match" defer></script>`: ''}
    ${options.verify?html`<script src="/assets/verify.js" defer></script>`:''}
    ${options.preview?html`<script src="/assets/preview.js" defer></script>`:''}
    ${options.handoff?html`<script type="module" src="/assets/handoff.js"></script>`:''}
    </head><body>${options.creator||options.standalone||options.editor?'':html`<header class="top"><a href="/" class="brand">${mark}<span>LINB</span></a>
      <span class="top-label">${options.privatePage?'Creator workspace':'LINK IN BIO FOR STREAMERS'}</span>
      ${options.privatePage?html`<nav aria-label="Workspace"><a href="/editor">Editor</a><a href="/account">Account</a></nav>`:html`<a class="small-link" href="/sign-in">Creator sign-in <span aria-hidden="true">↗</span></a>`}
    </header>`}<main class="${options.editor?'editor-shell':options.wide?'wide':options.phone?'shell phone-preview':'shell'}">${body}</main>
    ${options.editor?'':options.creator?html`<footer class="creator-credit"${options.standalone?raw(' hidden'):''}><a href="/">Made with LINB</a>${options.motionSwitch?html`<label class="motion-switch" hidden><input type="checkbox" data-reduce-motion> Reduce motion</label>`:''}</footer>`:options.standalone?'':
      html`<footer class="footer"><span>${mark} LINB</span><span>linb.io · Built for streamers.</span></footer>`}
    </body></html>`;
}

export function leaderboardDemo(now:number,low:boolean) {
  const {week,rows}=demoRanking(now,low);
  const date=(n:number)=>new Date(n).toISOString().slice(0,10);
  return frame('Discovery design preview',html`<section class="panel"><p class="eyebrow">SYNTHETIC · NO REAL VIEW COLLECTION</p>
    <h1>Most-viewed participating creator homes this week</h1>
    <p>Last completed UTC week: ${date(week.start)} to ${date(week.end-1)} · Fixture refreshed ${date(now)}</p>
    <p>Paid creators can opt in. Payment buys neither rank nor endorsement. Counts exclude repeat visits during the sampling window.</p>
    ${rows.length?html`<table class="rank"><thead><tr><th>Rank</th><th>Creator</th><th>Estimated eligible page views</th></tr></thead>
      <tbody>${rows.map(row=>html`<tr><td>${row.rank}</td><td>${row.name}</td><td>About ${row.estimated}</td></tr>`)}</tbody></table>`:
      html`<p>The ranked list is unavailable this week. Too few participating homes qualified.</p>`}
    <p><a href="/demo/leaderboard${low?'':'?state=low'}">${low?'Preview ranked state':'Preview low-volume state'}</a></p>
  </section>`,{wide:true});
}

export function retiredCalendar(homeId:string) {
  const title='Calendar downloads have ended';
  return frame(title,html`<section class="panel auth"><h1>${title}</h1>
    <p>Open the creator’s page for their latest links and schedule.</p>
    <a class="button" href="/h/${homeId}">Open creator page</a></section>`,{standalone:true});
}

// A Home with an art palette loads its colours from a stylesheet, so they show without script (RDY r-F1JJ7).
function artSkin(aura:Aura) {
  const art=aura.palette&&artPalette({...aura.palette,accent:aura.accent});
  return art?{path:skinPath(aura.palette,aura.accent),scheme:art.scheme}:undefined;
}

function streamLabel(link:string) {
  if (!link) return '';
  const host=new URL(link).hostname.toLowerCase().replace(/^www\./,'');
  if (host==='twitch.tv') return 'Open stream on Twitch';
  if (host==='youtube.com'||host==='youtu.be') return 'Open stream on YouTube';
  if (host==='kick.com') return 'Open stream on Kick';
  return 'Open stream';
}

function channelLinks(links: HomeContent['links']) {
  return html`<ul class="dock-links">${links.map(link=>{
    const platform=channelPlatform(link.url);
    const label=platform&&link.label.toLowerCase()!==platforms[platform].toLowerCase()?`${platforms[platform]}: ${link.label}`:link.label;
    return html`<li><a class="button secondary${platform?' dock-platform':''}" href="${link.url}" aria-label="${label}" title="${label}">${platform
      ?html`<span class="platform-icon" data-platform="${platform}" aria-hidden="true"></span>`:link.label}</a></li>`;
  })}</ul>`;
}

function cardDisclosure(label:string,body:ReturnType<typeof html>) {
  return html`<details><summary>${label}</summary>${body}</details>`;
}

const promoActions={
  Giveaway:'See giveaway', Support:'Support the creator', Merch:'Shop merch',
  Sponsor:'See sponsor offer', Community:'Join the community',
};

type FrameDimensions = {span:number;minHeight:number;column?:number};
const dimensionAttributes = ({span,minHeight,column}:FrameDimensions) =>
  html` data-span="${span}" data-height="${minHeight}"${column===undefined?'':html` data-column="${column}"`}`;

function editableCard(key:string,label:string,body:ReturnType<typeof html>,movable:boolean,editing?:boolean,dimensions?:FrameDimensions) {
  if(!editing) return body;
  return html`<div class="canvas-card" data-canvas-card="${key}"${movable?raw(' data-movable-card'):''}${dimensions?dimensionAttributes(dimensions):''}>
    <div inert data-canvas-body>${body}</div>
    ${dimensions?html`<span data-resize-edge="top" aria-hidden="true"></span>
      <span data-resize-edge="bottom" aria-hidden="true"></span>
      <span data-resize-edge="left" aria-hidden="true"></span>
      <span data-resize-edge="right" aria-hidden="true"></span>
      <span data-resize-edge="bottom-right" aria-hidden="true"></span>`:''}
    <button type="button" class="canvas-select" aria-pressed="false" aria-label="Edit ${label}"></button>
  </div>`;
}

function scheduleSlot(slot:SessionSlot) {
  return html`<div class="schedule-slot"><h3>${slot.title}</h3><p hidden data-fan-time="${slot.instant}"></p><dl>
    <div><dt>Creator date</dt><dd>${slot.local.slice(0,10)}</dd></div>
    <div><dt>Creator time</dt><dd>${slot.local.slice(11)}</dd></div>
    <div><dt>Time zone</dt><dd>${slot.zone} (${slot.offset})</dd></div></dl></div>`;
}

export function renderHome(content:HomeContent|EditableHome,options:{now:number;liveState?:LiveState;refreshActivity?:boolean;asset:(id:string)=>string;canonical?:string;appHandoff?:boolean;
  preview?:boolean;embedded?:boolean;editCanvas?:boolean;phone?:boolean;review?:boolean;report?:string;demo?:boolean;pro?:ProContent|null;homeId?:string;proBase?:string;notice?:ScheduleChange|null;currentPage?:string;metadata?:{title:string;description:string;image?:string}}) {
  const layout='layout' in content?content.layout:defaultLayout(options.homeId??'demo');
  const pro=options.pro, page=options.currentPage;
  const base=options.proBase??(options.homeId?'/h/'+options.homeId:null);
  const nav=base&&pro?proNav(pro,base,page):'';
  const module=pro?proModules(pro,page):'';
  const aura='aura' in content?content.aura:defaultAura;
  const skin=artSkin(aura);
  if(page&&pro) {
    const title=[pro.highlights,pro.recommendations].find(candidate=>candidate?.id===page)?.title??'Creator page';
    return frame(title,html`<article class="creator" data-flair="${pro.appearance}"><div class="creator-body">
      ${options.review?html`<p class="micro">RESTRICTED PUBLICATION REVIEW</p>`:options.preview?html`<p class="micro">PRIVATE PREVIEW</p>`:''}
      ${nav}<p class="micro">${content.displayName}</p><h1>${title}</h1>${module}</div></article>`,
      {theme:content.theme,skin,creator:true,player:Boolean(pro.video),canonical:options.canonical});
  }
  const name=content.displayName||'Your creator name';
  const initials=name.split(/\s+/).slice(0,2).map(word=>[...word][0]).join('').toUpperCase();
  const identity=layout.identity;
  const sessions=futureSessions(content,options.now);
  // The app hand-off is released by configuration, after its test on a phone.
  const app=options.appHandoff?appLink(content.streamUrl):undefined;
  const live=Boolean(content.streamUrl)&&options.liveState?.live===true&&options.liveState.verified===true;
  const viewerCount=options.liveState?.viewers;
  const viewers=live&&Number.isSafeInteger(viewerCount)&&viewerCount!>=0?viewerCount:undefined;
  const featured=layout.spotlight.offlineLead==='link'
    ? content.links.find(link=>link.url===layout.spotlight.offlineLink) : undefined;
  const next=sessions[0];
  const fallbackLead=featured ? html`<p class="micro">FEATURED LINK</p><h2>${featured.label}</h2>`
    : next ? html`<p class="micro">NEXT STREAM</p><h2>${next.title}</h2><p class="spotlight-meta"><time datetime="${next.instant}">${next.local.replace('T',' ')} ${next.zone} (${next.offset})</time></p>`
    : html`<p class="micro">SPOTLIGHT</p>`;
  const clip=layout.spotlight.offlineLead==='clip'&&options.liveState?.verified?options.liveState.clip:undefined;
  const lead=live ? html`<p class="micro on-air">ON AIR</p><h2>${options.liveState?.title||'Live now'}</h2>
    ${viewers===undefined?'':html`<p class="spotlight-meta"><span data-viewer-count="${viewers}"${options.liveState?.fixtureViewers===undefined?'':html` data-fixture-viewers="${options.liveState.fixtureViewers}"`}>${viewers.toLocaleString('en-US')}</span> watching</p>`}`
    : clip ? html`<p class="micro">RECENT TWITCH CLIP</p><h2>${clip.title}</h2><p class="spotlight-meta">
      <a href="${clip.url}">Watch the clip</a>${clip.views===undefined?'':html` · ${clip.views.toLocaleString('en-US')} views`}</p>`
    : fallbackLead;
  // Keep the card frame and editor controls shared. Each family supplies only its content.
  const card = (family:string,key:string,label:string,body:ReturnType<typeof html>,dimensions?:FrameDimensions,
    movable=false,attributes?:ReturnType<typeof html>) =>
    editableCard(key,label,html`<section class="home-card ${family==='updates'?family:family+'-card'}" data-card="${family}" data-frame-label="${family}"${dimensions&&!options.editCanvas?dimensionAttributes(dimensions):''}${attributes??''}>
      <span class="aura-frame-sheen" aria-hidden="true"></span>${body}</section>`,movable,options.editCanvas,dimensions);
  const remainingLinks=content.links.slice(2);
  const dock=content.links.length?card('dock','dock','Channel Dock',html`
    <h2>Find me</h2><div class="dock-content">
      <div class="dock-summary">${channelLinks(content.links.slice(0,2))}
        ${remainingLinks.length?cardDisclosure('More channels',channelLinks(remainingLinks)):''}</div>
      <div class="dock-full">${channelLinks(content.links)}</div>
    </div>`,layout.dock,true):'';
  const notice=activeNotice(options.notice,options.now)?html`<aside class="home-card schedule-notice"><p class="micro">SCHEDULE CHANGE</p>
    <p>${scheduleCopy(options.notice!)}</p></aside>`:'';
  const supporting=layout.supporting.map(item=>{
    if(item.hidden) return '';
    if(item.family==='promo') {
      if(!item.url||!item.title) return '';
      return card('promo',item.id,item.title,html`
        <div class="card-action-layout promo-content"><div class="promo-copy"><p class="micro">${item.category}</p><h2>${item.title}</h2>
        ${item.description?html`<p class="promo-description">${item.description}</p>`:''}</div>
        <a class="button" href="${item.url}">${promoActions[item.category]} <span aria-hidden="true">↗</span></a></div>`,item,true);
    }
    if(!sessions.length) return '';
    const moreSessions=(start:number)=>sessions.length>start
      ?cardDisclosure('More sessions',html`${sessions.slice(start).map(scheduleSlot)}`):'';
    return card('schedule',item.id,'Schedule',html`
      <h2>Upcoming sessions</h2>
      <div class="schedule-content">
        <div class="schedule-slots">${scheduleSlot(sessions[0])}
          ${sessions[1]?html`<div class="schedule-second">${scheduleSlot(sessions[1])}</div>`:''}
          ${sessions[2]?html`<div class="schedule-third">${scheduleSlot(sessions[2])}</div>`:''}</div>
        <div class="schedule-summary">${moreSessions(1)}</div>
        <div class="schedule-more-after-two">${moreSessions(2)}</div>
        <div class="schedule-more-after-three">${moreSessions(3)}</div>
      </div>
      ${content.streamUrl?html`<a class="button secondary" href="${content.streamUrl}">Open channel</a>`:''}`,item,true);
  });
  supporting.splice(layout.dockPosition,0,dock);
  // Keep the schedule-change notice near the lead, with the default Dock slot above it.
  supporting.splice(layout.dockPosition===0?1:0,0,notice);
  return frame(name,html`
    ${options.preview&&!options.embedded?html`<aside class="status-note">Private preview · Unsaved values
      <button type="button" class="secondary" id="return-to-editor">Return to editor</button>
      <p class="dim">If this tab stays open, close it to return to your unsaved editor.</p></aside>`:''}
    ${options.review?html`<aside class="status-note">Restricted publication review · <a href="/ops">Back to cases</a></aside>`:''}
    ${skin&&content.coverId&&aura.intensity!=='off'?html`<div class="art-backdrop" aria-hidden="true"><img src="${options.asset(content.coverId)}" alt=""></div>`:''}
    <canvas class="aura-field" aria-hidden="true" hidden></canvas>
    <article class="creator card-home" data-aura-home${skin?raw(' data-art-palette'):''} data-accent="${aura.accent??''}"
      data-font="${aura.font}" data-shape="${aura.shape}" data-frame="${aura.frame}" data-field="${aura.field}"
      data-intensity="${aura.intensity}"${options.refreshActivity?raw(' data-refresh-activity'):''}${live&&aura.liveSurge?raw(' data-live-surge'):''} data-flair="${pro?.appearance??'original'}" ${options.editCanvas?raw('data-edit-canvas'):''}>
      ${card('identity','identity','Creator Identity',html`
        <div class="cover" data-focal-x="${identity.focalX}" data-focal-y="${identity.focalY}">${content.coverId?html`<img src="${options.asset(content.coverId)}" alt="" fetchpriority="high">`:options.demo?art:html`<div class="plain-cover"></div>`}</div>
        <div class="identity">
          <div class="avatar-wrap">${content.avatarId?html`<img class="avatar" src="${options.asset(content.avatarId)}" alt="">`:
            html`<div class="avatar initials" aria-hidden="true">${initials}</div>`}</div>
          <div class="identity-text"><h1>${name}</h1>${content.intro?html`<p>${content.intro}</p>`:''}
          ${content.game?html`<p class="signature-game"><span class="sr-only">Signature game: </span>${content.game}</p>`:''}</div>
        </div>
      `,identity,false,html` data-align="${identity.alignment}" data-avatar-size="${identity.avatarSize}" data-avatar-position="${identity.avatarPosition}"`)}
      ${content.streamUrl?card('spotlight','spotlight','Spotlight',html`
        ${options.refreshActivity?html`<template data-activity-fallback data-action="${streamLabel(content.streamUrl)}">${fallbackLead}</template>`:''}
        ${live&&aura.liveSurge?html`<span class="aura-sweep" aria-hidden="true"></span>`:''}
        <div class="card-action-layout"><div class="spotlight-copy">${lead}</div><a class="button" href="${content.streamUrl}"${app?html` data-app-link="${app}"`:''}>${live?'Watch live':streamLabel(content.streamUrl)} <span aria-hidden="true">↗</span></a></div>`,
        layout.spotlight,false,html` aria-label="Stream destination"`):''}
      ${supporting}
      ${content.updates.length?card('updates','updates','Updates',html`<h2>Updates</h2>${content.updates.map(update=>html`
        <article>${update.firstPublishedAt?html`<time datetime="${update.firstPublishedAt}">${update.firstPublishedAt.slice(0,10)} UTC</time>`:
          options.preview?html`<small>Date added when published.</small>`:''}<p>${update.text}</p></article>`)}`):''}
      ${nav||pro?html`<section class="home-card">${nav}${module}</section>`:''}
      ${options.preview||options.review?'':html`<div class="fan-tools"><p class="bookmark">Save this home in your browser.</p>
        ${options.canonical?shareControl(options.canonical):''}
        ${options.report?html`<a class="dim" href="${options.report}">Report this page</a>`:''}</div>`}
    </article>`,{theme:content.theme,skin,preview:options.preview&&!options.embedded,phone:options.phone,creator:true,standalone:options.editCanvas,cardLayout:true,aura:true,handoff:Boolean(app),motionSwitch:!options.preview&&!options.review,newTabLinks:options.embedded,player:Boolean(pro?.video),canonical:options.canonical,share:!options.review&&!options.editCanvas,metadata:options.metadata});
}

function proNav(pro:ProContent,base:string,current?:string) {
  const pages=[pro.highlights,pro.recommendations].filter(Boolean);
  if(!pages.length) return '';
  return html`<nav class="pro-nav" aria-label="Creator pages">
    <a href="${base}" aria-current="${current?'false':'page'}">Home</a>
    ${pages.map(page=>html`<a href="${base}/p/${page!.id}" aria-current="${current===page!.id?'page':'false'}">${page!.title}</a>`)}
  </nav>`;
}

function proModules(pro:ProContent,current?:string) {
  const video=pro.video&&(current===pro.highlights?.id||(!current&&!pro.highlights))?pro.video:null;
  // A draft that the creator has not filled in has no links yet.
  const links=current===pro.recommendations?.id||(!current&&!pro.recommendations)?pro.links??[]:[];
  return html`
    ${video?html`<section class="feature-video"><p class="micro">FEATURED VIDEO</p><h2>${video.title}</h2>
      <div data-player><span aria-hidden="true">▶</span></div>
      <p>Loading the player connects to YouTube.</p>
      <button type="button" class="secondary" data-youtube="${video.id}" hidden>Load YouTube player</button>
      <a class="button secondary" href="https://www.youtube.com/watch?v=${video.id}">Open on YouTube ↗</a>
      <p role="status" data-player-status></p></section>`:''}
    ${links.length?html`<section class="links pro-collection"><h2>Creator picks</h2><ul>
      ${links.map(link=>html`<li><a href="${link.url}">${link.label} ↗</a>${link.note?html`<p>${link.note}</p>`:''}</li>`)}
    </ul></section>`:''}`;
}

export function proEditor(state:HomeState,draft:ProDraft,csrf:string,multipage:boolean,entitled:boolean,review=false) {
  const pro=draft.content;
  return frame('Private Pro studio',html`<section class="panel"><p class="eyebrow">PRIVATE TEST PREVIEW</p>
    <h1>Pro studio</h1><p>Your Free page remains the fallback. To change ordinary links, use the main editor.</p>
    ${review?html`<section class="panel"><h2>Review the exact Free fallback</h2>
      <p><strong>${state.content.displayName}</strong> · ${state.content.intro}</p>
      <p>Preset: ${state.content.theme}. ${state.content.streamUrl?'Primary destination: '+state.content.streamUrl:''}</p>
      <ul>${state.content.links.map(link=>html`<li>${link.label}: ${link.url}</li>`)}</ul>
      <form method="post" action="/editor/pro/free-preview">${hidden(csrf)}
        <input type="hidden" name="revision" value="${state.draft_revision}"><button class="secondary">Open full Free preview</button>
      </form>
      <h2>Review your Pro changes</h2><p>Appearance: ${pro.appearance??'original'}</p>
      <form method="post" action="/editor/pro/preview">${hidden(csrf)}
        <input type="hidden" name="revision" value="${state.draft_revision}"><input type="hidden" name="version" value="${draft.revision}">
        <button name="page" value="" class="secondary">Preview Home</button>
        ${[pro.highlights,pro.recommendations].filter(Boolean).map(page=>html`<button class="secondary" name="page" value="${page!.id}">Preview ${page!.title}</button>`)}
      </form>
      ${entitled?html`<form method="post" action="/editor/pro/publish">${hidden(csrf)}
        <input type="hidden" name="revision" value="${state.draft_revision}"><input type="hidden" name="version" value="${draft.revision}">
        <input type="hidden" name="publication" value="${state.publication_id??''}"><input type="hidden" name="operation" value="${randomUUID()}">
        <label class="check"><input name="approved" type="checkbox" value="1" required> I reviewed Home, selected pages, and this Free fallback.</label>
        <button>Publish reviewed pages</button></form>`:html`<p>Verified test Pro access is required to publish this draft.</p>`}
      <p><a href="/editor/pro">Back to the private draft</a></p></section>`:
    html`<form method="post" action="/editor/pro">${hidden(csrf)}
      <input type="hidden" name="version" value="${draft.revision}">
      <label for="appearance">Appearance</label><select id="appearance" name="appearance">
        ${[['original','Original theme'],['arcade','Arcade grid'],['afterglow','Afterglow']].map(([key,label])=>html`<option value="${key}" ${(pro.appearance??'original')===key?raw('selected'):''}>${label}</option>`)}</select>
      <h2>Featured video</h2><label for="videoTitle">Title</label><input id="videoTitle" name="videoTitle" value="${pro.video?.title??''}" maxlength="80">
      <label for="videoUrl">YouTube video URL</label><input id="videoUrl" name="videoUrl" type="url" value="${pro.video?'https://www.youtube.com/watch?v='+pro.video.id:''}">
      <h2>Creator picks</h2><p>Up to six recommendations. Keep affiliate or sponsor disclosures next to the affected link.</p>
      ${Array.from({length:6},(_,i)=>html`<fieldset class="editor-entry"><legend>Pick ${i+1}</legend>
        <label>Label<input name="label${i+1}" value="${pro.links?.[i]?.label??''}" maxlength="45"></label>
        <label>HTTPS URL<input name="url${i+1}" value="${pro.links?.[i]?.url??''}" type="url"></label>
        <label>Note or disclosure<input name="note${i+1}" value="${pro.links?.[i]?.note??''}" maxlength="110"></label></fieldset>`)}
      ${multipage?html`<h2>Extra pages</h2><p>Add a title to move its module to a dedicated page. Leave it blank to keep the module on Home.</p>
        <label>Highlights page title<input name="highlightsTitle" value="${pro.highlights?.title??''}" maxlength="45"></label>
        <label>Recommendations page title<input name="recommendationsTitle" value="${pro.recommendations?.title??''}" maxlength="45"></label>`:''}
      <button>Save private draft and review</button></form>`}
  </section>`,{privatePage:true});
}

function slotLabel(slot:SessionSlot) {return slot.local.replace('T',' ')+' '+slot.zone+' ('+slot.offset+')';}
function activeNotice(notice:ScheduleChange|null|undefined,now:number) {
  return Boolean(notice&&Math.max(Date.parse(notice.prior.instant),Date.parse(notice.next?.instant??notice.prior.instant))>now);
}
function scheduleCopy(notice:ScheduleChange) {
  return notice.prior.title+': '+notice.status+'. Previous time: '+slotLabel(notice.prior)+'.'+(notice.next?' New time: '+slotLabel(notice.next)+'.':'');
}

function shareControl(url:string) {
  return html`<details data-share><summary>Share this page</summary>
    <label>Public link<input readonly value="${url}"></label><div class="form-actions">
    <button type="button" class="secondary" data-copy hidden>Copy link</button>
    <button type="button" class="secondary" data-system-share hidden>Share…</button></div>
    <p role="status" class="dim"></p></details>`;
}

export function editorShare(home:{id:string;publication_id:string;content:HomeContent;schedule_change:ScheduleChange|null},url:string,csrf:string,
  current:{title:string;description:string;coverId:string|null}|null,selection:Selection|null,proof:string|null,now:number) {
  const content=home.content;
  const slot=nextSession(content,now);
  return frame('Share your link',html`<section class="panel">
    <h1>Share your link</h1><p>All of these use the same public URL. LINB doesn’t post them for you.</p>
    ${shareControl(url)}
    <label>Stream bio<textarea readonly>${'Find my stream and links: '+url}</textarea></label>
    <label>Community post<textarea readonly>${'I’ve put my stream, socials, and updates in one place: '+url}</textarea></label>
    <label>Direct message<textarea readonly>${'Here’s my link page: '+url}</textarea></label>
    ${slot?html`<label>Discord schedule<textarea readonly>${discordSchedule(slot.title,slot.instant,url)}</textarea></label>
    <p>Creator time: ${slot.local.replace('T',' ')} ${slot.zone} (${slot.offset})</p>`:''}
    ${activeNotice(home.schedule_change,now)?html`<label>Schedule correction<textarea readonly>${scheduleCopy(home.schedule_change!)+'\n'+url}</textarea></label>`:''}
    <h2>Link preview</h2><p>${current?'Rich preview is enabled for the approved fields.':'Your link currently uses the generic LINB preview.'}</p>
    <p>Outside services may keep a cached copy after you disable or change your preview.</p>
    ${selection?html`<section><h3>Review this exact card</h3>
      <strong>${selection.name?content.displayName:'A creator on LINB'}</strong>
      <p>${selection.intro?content.intro:'A link in bio for gaming and streaming creators.'}</p>
      ${selection.image&&content.coverId?html`<img class="share-preview-image" src="/h/${home.id}/images/${content.coverId}" alt="">`:''}
      <form method="post" action="/editor/share">
        ${hidden(csrf)}<input type="hidden" name="publication" value="${home.publication_id}"><input type="hidden" name="proof" value="${proof}">
        ${(['name','intro','image'] as const).filter(k=>selection[k]).map(k=>html`<input type="hidden" name="${k}" value="1">`)}
        <button name="action" value="enable">Enable this exact preview</button>
      </form></section>`:html`<form method="get" action="/editor/share">
      <input type="hidden" name="review" value="1">
      <label class="check"><input type="checkbox" name="name" value="1"> Display name: ${content.displayName}</label>
      <label class="check"><input type="checkbox" name="intro" value="1"> Intro: ${content.intro}</label>
      ${content.coverId?html`<label class="check"><input type="checkbox" name="image" value="1"> Published cover image</label>`:''}
      <button type="submit" class="secondary">Review selected fields</button>
    </form>`}
    ${current?html`<form method="post" action="/editor/share">${hidden(csrf)}<button name="action" value="disable" class="secondary">Disable rich preview</button></form>`:''}
  </section>`,{privatePage:true,share:true});
}

function hidden(csrf:string) {return html`<input type="hidden" name="csrf" value="${csrf}">`;}
export function accountPage(email:string,change:any,csrf:string,contact:string|null,notice?:string,twitch?:{linked:boolean;login?:string;status?:string},billing=false,
    handle:{current:string|null;offer:string|null}={current:null,offer:null}) {
  return frame('Account',html`<section class="panel auth"><p class="eyebrow">ACCOUNT</p><h1>Creator account</h1><p>Verified mailbox: <strong>${email}</strong></p>
    ${notice?html`<p class="notice">${notice}</p>`:''}
    ${change?html`<p>Current mailbox: ${change.old_proved?'Verified':'Awaiting proof'}. New mailbox: ${change.new_proved?'Verified':'Awaiting proof'}.</p>
      <p>Starting a replacement change invalidates any previous proof links.</p>`:''}
    <form method="post" action="/account/mailbox">${hidden(csrf)}<label for="next">New email address</label><input id="next" type="email" name="mailbox" required>
      ${change?html`<label class="check"><input type="checkbox" name="replace" required> Replace the pending mailbox change</label>`:''}
      <button>${change?'Start replacement change':'Send verification links'}</button></form>
    ${billing?html`<p><a href="/account/billing">Pro test billing</a></p>`:''}
    ${handle.current||handle.offer?html`<section><h2>Page address</h2>
      ${handle.current?html`<p>Your page address: <strong>${handle.current}</strong></p>`:''}
      ${handle.offer?html`<p>Your streaming login changed. ${handle.current?'Your earlier address keeps working and forwards to the new one.':''}</p>
        <form method="post" action="/account/handle">${hidden(csrf)}<button class="secondary">Use ${handle.offer}</button></form>`:''}
    </section>`:''}
    ${twitch?html`<section><h2>Twitch</h2>
      ${twitch.status==='verify'?html`<p>Sign in again with your verified mailbox to manage Twitch.</p><a href="/sign-in">Verify by email</a>`:''}
      <p>${twitch.linked?'Connected'+(twitch.login?': '+twitch.login:''):'Use Twitch to sign in after connecting it. Your verified mailbox remains available.'}</p>
      <form method="post" action="/account/twitch">${hidden(csrf)}
      <button name="action" value="${twitch.linked?'unlink':'link'}" class="secondary">${twitch.linked?'Disconnect Twitch':'Connect Twitch'}</button></form>
    </section>`:''}
    ${contact?html`<p><a href="mailto:${contact}">Contact the review operator</a></p>`:''}
    <form method="post" action="/logout">${hidden(csrf)}<button class="secondary">Sign out</button></form></section>`,{privatePage:true});
}

export function billingPage(home:{id:string;publication_id:string;content:HomeContent}|null,csrf:string,state:any,returned:boolean) {
  return frame('Pro test billing',html`<section class="panel auth"><h1>Pro test billing</h1>
    <p>Stripe test mode only. This is not a paid offer. Billing never changes whether your Free page is available.</p>
    ${returned?html`<p class="notice">Checkout returned. LINB grants access only after Stripe’s verified event.</p>`:''}
    ${state?html`<p>Verified state: ${state.active?'Test access active':state.status}.
      ${state.access_until?'Recorded end: '+new Date(state.access_until).toISOString().slice(0,10)+' UTC.':''}</p>
      <form method="post" action="/account/billing">${hidden(csrf)}<button name="action" value="portal">Open test billing portal</button></form>`:
      home?html`<h2>Review your exact Free fallback</h2><p>LINB keeps this home address and your Free links if Pro expires.</p>
        <p><a href="/h/${home.id}" target="_blank" rel="noopener">Review the current published Free page ↗</a></p>
        <form method="post" action="/account/billing">${hidden(csrf)}
          <input type="hidden" name="publication" value="${home.publication_id}">
          <label class="check"><input type="checkbox" name="approved" value="1" required> I reviewed this Free fallback.</label>
          <button name="action" value="checkout">Try Stripe test checkout</button></form>`:
        html`<p>Publish an available Free home before trying checkout.</p><a href="/editor">Return to the editor</a>`}
  </section>`,{privatePage:true});
}

export function opsPage(rows:any[],csrf:string,reasons:string[],reports:any[]=[]) {
  return frame('Operator workspace',html`<header class="workspace-head"><div><p class="eyebrow">RESTRICTED WORKSPACE</p><h1>Public-home cases</h1><a href="/ops/invites">Pilot invitations</a></div>
    <form method="post" action="/ops/logout">${hidden(csrf)}<button class="secondary">Sign out</button></form></header>
    <div class="workspace-grid"><section class="panel"><h2>Open a case</h2>
    <form method="post" action="/ops/cases">${hidden(csrf)}<label for="home">Home ID from the public address</label><input id="home" name="homeId" required>
    <label for="reviewer">Independent designated reviewer</label><input id="reviewer" type="email" name="reviewer" required>
    <label for="reason">Reason</label><select id="reason" name="reason">${reasons.map(reason=>html`<option>${reason}</option>`)}</select>
    <label for="evidence">Minimum necessary evidence</label><textarea id="evidence" name="evidence" maxlength="1200" required></textarea><button>Open case</button></form></section>
    <section class="panel"><h2>Assigned cases</h2>${rows.length?html`<ul class="case-list">${rows.map(row=>html`<li><a href="/ops/cases/${row.id}">${row.reason}</a>
    <span>${row.released_at?'Released':row.applied_at?'Held':'Open'}</span></li>`)}</ul>`:html`<p>No assigned cases.</p>`}</section></div>
    <section class="panel report-inbox"><h2>Fan report inbox</h2>
    <p>Review the report before opening a case. Submitting a report does not apply a hold.</p>
    ${reports.length?reports.map(report=>html`<article><h3>${report.reason}</h3>
      <p>Home ID: ${report.home_id}</p><p>${report.detail}</p>
      <form method="post" action="/ops/fan-reports/${report.id}/resolve">${hidden(csrf)}<button class="secondary">Mark reviewed</button></form>
    </article>`):html`<p>No unreviewed reports.</p>`}</section>`,{wide:true});
}

export function invitesPage(rows:any[],csrf:string,issued:boolean) {
  return frame('Pilot invitations',html`<header class="workspace-head"><div><p class="eyebrow">RESTRICTED WORKSPACE</p>
    <h1>Pilot invitations</h1><a href="/ops">Back to cases</a></div></header>
    <div class="workspace-grid"><section class="panel"><h2>Admit a mailbox</h2>
    ${issued?html`<p class="notice">Invitation recorded. Ask the creator to request a sign-in link.</p>`:''}
    <form method="post" action="/ops/invites">${hidden(csrf)}<label for="alias">Pilot alias</label><input id="alias" name="alias" required maxlength="40">
    <label for="mailbox">Invited mailbox</label><input id="mailbox" name="mailbox" type="email" required><button>Admit mailbox</button></form>
    <p class="dim">The invitation expires after seven days. The log uses the pilot alias and invitation ID.</p></section>
    <section class="panel"><h2>Invitation outcomes</h2><ul class="case-list">${rows.map(row=>html`<li><strong>${row.pilot_alias}</strong>
      <span>${row.consumed_at?'Consumed':row.revoked_at?'Revoked':row.expired?'Expired':'Pending'}</span>
      <p>${row.id}</p>${!row.consumed_at&&!row.revoked_at&&!row.expired?html`
      <form method="post" action="/ops/invites/${row.id}/revoke">${hidden(csrf)}<button class="secondary">Revoke invitation</button></form>`:''}</li>`)}</ul>
    </section></div>`,{wide:true});
}

export function opsCase(row:any,events:any[],actor:string,csrf:string) {
  const route='/ops/cases/'+row.id;
  const params=()=>html`${hidden(csrf)}<input type="hidden" name="operationId" value="${randomUUID()}"><input type="hidden" name="publicationId" value="${row.publication_id??''}">`;
  return frame('Restricted case',html`<div class="panel"><p class="eyebrow">RESTRICTED CASE</p><h1>${row.reason}</h1><p>Case ${row.id}</p><p>Home ${row.home_id}</p>
    <p>${row.evidence??'Evidence expired or removed.'}</p><a href="/ops">Back to assigned cases</a>
    ${row.applier_id===actor&&!row.applied_at?html`<form method="post" action="${route}/hold">${params()}<button>Apply visibility hold</button></form>`:''}
    ${row.reviewer_id===actor&&row.applied_at&&!row.released_at?html`<div class="review-actions">
      <a class="button secondary" href="${route}/publication">Inspect current held publication</a>
      <form method="post" action="${route}/review">${params()}<button>Record review</button></form>
      <form method="post" action="${route}/release">${params()}<label for="rationale">Release rationale</label><input id="rationale" name="reason" required maxlength="240">
      <button ${row.reviewed_at?'':raw('disabled')}>Release hold</button></form></div>`:''}
    <h2>Audit events</h2><ul class="case-list">${events.map(event=>html`<li>${event.action} · ${event.created_at.toISOString()}${event.reason?' · '+event.reason:''}</li>`)}</ul>
  </div>`,{wide:true});
}
