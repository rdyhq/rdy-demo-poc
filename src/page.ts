import { html } from 'hono/html';
import { appLink } from './app-link.ts';
import { defaultAura } from './aura.ts';
import { futureSessions, type HomeContent, type ScheduleChange, type SessionSlot } from './domain.ts';
import { channelPlatform, platforms, type EditableHome } from './home-cards.ts';
import type { LiveState } from './live-state.ts';
import { accentPath, artPalette, skinPath } from './public/palette.js';

// The Home of the fresh start (RDY D-TG9VX, section s-EY5PZ): one centred column, in a fixed order.
export const pageStyles='/assets/page.css?v=4';

export type PageOptions={
  now:number; asset:(id:string)=>string; liveState?:LiveState; canonical?:string;
  // The address on linb.io that serves the picture of the live stream.
  stream?:string;
  // The next streams of the linked channel's schedule (RDY r-NQ9ZZ). Each start is an instant in UTC.
  schedule?:{title:string;category:string;start:string}[];
  // An operator reviews a held publication on this page. The value is the address of the case.
  review?:string;
  // The clips of the linked channel (RDY r-29W7N). Each picture is an address on linb.io.
  clips?:{title:string;url:string;views?:number;picture:string}[]; report?:string; appHandoff?:boolean;
  notice?:ScheduleChange|null;
  // A preview before sign-up names the Twitch login that the visitor can claim.
  claim?:string; metadata?:{title:string;description:string;image?:string};
};

const weekdays=['SUN','MON','TUE','WED','THU','FRI','SAT'];
function sessionRow(slot:SessionSlot) {
  const [year,month,day]=slot.local.slice(0,10).split('-').map(Number);
  return html`<li><b>${weekdays[new Date(Date.UTC(year,month-1,day)).getUTCDay()]}<br>${day}</b><span>${slot.title}<small>${slot.local.slice(11)} · ${slot.zone}</small></span></li>`;
}

// A stream of the Twitch schedule. The page shows UTC, and a script shows the time zone of the fan (RDY r-ZN5Y9).
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const utcClock=(at:Date)=>at.toISOString().slice(11,16)+' UTC';
function streamRow(slot:{title:string;category:string;start:string}) {
  const at=new Date(slot.start);
  return html`<li><b data-day="${slot.start}">${weekdays[at.getUTCDay()]}<br>${at.getUTCDate()}</b><span>${slot.title}<small><time datetime="${slot.start}" data-show="time">${
    utcClock(at)}</time>${slot.category?' · '+slot.category:''}</small></span></li>`;
}
function streamDay(start:string) {
  const at=new Date(start),day=weekdays[at.getUTCDay()];
  return html`<time datetime="${start}" data-show="day">${day[0]+day.slice(1).toLowerCase()} ${at.getUTCDate()} ${months[at.getUTCMonth()]}, ${utcClock(at)}</time>`;
}

// A schedule change stays on the page until the later of its two times has passed.
const slotLabel=(slot:SessionSlot)=>slot.local.replace('T',' ')+' '+slot.zone+' ('+slot.offset+')';
export function noticeCopy(notice:ScheduleChange|null|undefined,now:number) {
  if(!notice||Math.max(Date.parse(notice.prior.instant),Date.parse(notice.next?.instant??notice.prior.instant))<=now) return null;
  return notice.prior.title+': '+notice.status+'. Previous time: '+slotLabel(notice.prior)+'.'+(notice.next?' New time: '+slotLabel(notice.next)+'.':'');
}

function streamAction(link:string,live:boolean) {
  const platform=channelPlatform(link);
  const where=platform?' on '+platforms[platform]:'';
  return live?(where?'Watch'+where:'Watch live'):'Open stream'+where;
}

const icon=(platform:string)=>html`<span class="pg-icon" data-platform="${platform}"></span>`;

export function renderPage(content:HomeContent|EditableHome,options:PageOptions) {
  const aura='aura' in content?content.aura:defaultAura;
  const art=aura.palette&&artPalette({...aura.palette,accent:aura.accent});
  // The colours reach the page from a stylesheet, so they show without script (RDY r-F1JJ7).
  const skin=art?skinPath(aura.palette,aura.accent):aura.accent?accentPath(aura.accent):null;
  const notice=noticeCopy(options.notice,options.now);
  const name=content.displayName||'Your name';
  const initials=name.split(/\s+/).slice(0,2).map(word=>[...word][0]).join('').toUpperCase();
  const state=options.liveState;
  // The LIVE mark and the stream show only while a provider verifies the stream (RDY s-EY5PZ).
  const live=Boolean(content.streamUrl)&&state?.live===true&&state.verified===true;
  const viewers=live&&Number.isSafeInteger(state!.viewers)&&state!.viewers!>=0?state!.viewers:undefined;
  // The creator can switch the schedule and the clips off (RDY r-RA9HG).
  const layout='layout' in content?content.layout:undefined;
  const scheduleOff=layout?.supporting.find(card=>card.family==='schedule')?.hidden===true;
  const clips=layout?.clipsHidden?[]:options.clips??[];
  const sessions=scheduleOff?[]:futureSessions(content,options.now);
  // The schedule of the Twitch channel shows in place of the sessions that the creator entered.
  const streams=!scheduleOff&&options.schedule?.length?options.schedule:null;
  const spotlight=layout?.spotlight;
  const clip=!live&&spotlight?.offlineLead==='clip'&&state?.verified?state.clip:undefined;
  // A featured link is one of the creator's own links (RDY D-6DX8J). A link that is gone falls back to the next stream.
  const featured=!live&&spotlight?.offlineLead==='link'?content.links.find(link=>link.url===spotlight.offlineLink):undefined;
  const app=options.appHandoff?appLink(content.streamUrl):undefined;
  const socials=content.links.map(link=>({...link,platform:channelPlatform(link.url)})).filter(link=>link.platform);
  const promos='layout' in content?content.layout.supporting.flatMap(card=>
    card.family==='promo'&&!card.hidden&&card.title&&card.url?[{label:card.title,url:card.url}]:[]):[];
  const pills=[...content.links,...promos];
  // While the creator is live, the banner does not show: the banner that Twitch gives is the offline banner (RDY D-B71JQ).
  // The picture in the live card is the stream. The banner of the channel never stands in for it.
  const lead=live?html`${state!.picture&&options.stream?html`<img class="pg-thumb" src="${options.stream}" alt="">`:''}<p class="pg-card-title">${state!.title||'Live now'}</p>${
      viewers===undefined?'':html`<p class="pg-card-meta">${viewers.toLocaleString('en-US')} watching</p>`}`
    :clip?html`<p class="pg-card-kicker">Latest clip</p><p class="pg-card-title"><a href="${clip.url}">${clip.title}</a></p>${
      clip.views===undefined?'':html`<p class="pg-card-meta">${clip.views.toLocaleString('en-US')} views</p>`}`
    :featured?html`<p class="pg-card-kicker">Featured link</p><p class="pg-card-title"><a href="${featured.url}">${featured.label}</a></p>`
    :streams?html`<p class="pg-card-kicker">Next stream</p><p class="pg-card-title">${streams[0].title}</p><p class="pg-card-meta">${streamDay(streams[0].start)}</p>`
    :sessions[0]?html`<p class="pg-card-kicker">Next stream</p><p class="pg-card-title">${sessions[0].title}</p><p class="pg-card-meta">${
      sessions[0].local.replace('T',' ')} ${sessions[0].zone}</p>`:'';
  return html`<!doctype html><html lang="en" data-theme="${content.theme}"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="${art?art.scheme:content.theme==='Paper'?'light':'dark'}">
    <title>${name} · LINB</title><link rel="stylesheet" href="${pageStyles}">
    ${skin?html`<link rel="stylesheet" href="${skin}">`:''}
    <link rel="icon" href="/assets/linb.svg" type="image/svg+xml">
    ${options.canonical?html`<link rel="canonical" href="${options.canonical}">`:''}
    ${options.metadata?html`<meta property="og:type" content="website"><meta property="og:url" content="${options.canonical}">
      <meta property="og:title" content="${options.metadata.title}"><meta property="og:description" content="${options.metadata.description}">
      ${options.metadata.image?html`<meta property="og:image" content="${options.metadata.image}">`:''}`:''}
    ${app?html`<script type="module" src="/assets/handoff.js"></script>`:''}
    ${streams?html`<script src="/assets/localtime.js" defer></script>`:''}
    </head><body>${options.review?html`<aside class="pg-review">Restricted publication review · <a href="${options.review}">Back to the case</a></aside>`:''}<main class="pg" data-font="${aura.font}">
    <div class="pg-hero">${content.coverId&&!live?html`<img src="${options.asset(content.coverId)}" alt="">`:''}</div>
    ${content.avatarId?html`<img class="pg-avatar" src="${options.asset(content.avatarId)}" alt="">`
      :html`<div class="pg-avatar pg-initials" aria-hidden="true">${initials}</div>`}
    <h1 class="pg-name">${name}${live?html` <span class="pg-live">LIVE</span>`:''}</h1>
    ${content.intro?html`<p class="pg-bio">${content.intro}</p>`:''}
    ${socials.length?html`<ul class="pg-social">${socials.map(link=>html`<li><a href="${link.url}" aria-label="${platforms[link.platform!]}">${icon(link.platform!)}</a></li>`)}</ul>`:''}
    ${content.streamUrl?html`<section class="pg-card" aria-label="Stream">${lead}
      <a class="pg-watch" href="${content.streamUrl}"${app?html` data-app-link="${app}"`:''}>${streamAction(content.streamUrl,live)}</a></section>`:''}
    ${pills.length?html`<ul class="pg-links">${pills.map(link=>{
      const platform=channelPlatform(link.url);
      return html`<li><a class="pg-pill" href="${link.url}"><i aria-hidden="true">${platform?icon(platform):'↗'}</i><span>${link.label}</span></a></li>`;
    })}</ul>`:''}
    ${notice?html`<p class="pg-notice"><strong>Schedule change</strong> ${notice}</p>`:''}
    ${streams?html`<h2 class="pg-h">Schedule</h2><ul class="pg-rows">${streams.map(streamRow)}</ul>`
      :sessions.length?html`<h2 class="pg-h">Schedule</h2><ul class="pg-rows">${sessions.slice(0,4).map(sessionRow)}</ul>`:''}
    ${clips.length?html`<h2 class="pg-h">Clips</h2><ul class="pg-clips">${clips.map(clip=>
      html`<li><a class="pg-clip" href="${clip.url}"><img src="${clip.picture}" alt="" loading="lazy"><span>${clip.title}</span>${
        clip.views===undefined?'':html`<small>${clip.views.toLocaleString('en-US')} views</small>`}</a></li>`)}</ul>`:''}
    ${content.updates.length?html`<h2 class="pg-h">Updates</h2><ul class="pg-notes">${content.updates.map(update=>html`<li>${update.text}${
      update.firstPublishedAt?html`<small>${update.firstPublishedAt.slice(0,10)}</small>`:''}</li>`)}</ul>`:''}
    ${content.game?html`<p class="pg-tags"><span>${content.game}</span></p>`:''}
    <footer class="pg-foot">${options.report&&!options.claim?html`<a href="${options.report}">Report this page</a><a href="/privacy">Privacy</a>`:''}<a href="/">Made with LINB</a></footer>
    </main>${options.claim?html`<aside class="pg-sheet">
      <h2>That is you, ${name}.</h2><p>${art?'The colours and the font come from your channel.':'You pick the look after you claim it.'}</p>
      <form method="post" action="/auth/twitch"><input type="hidden" name="claim" value="${options.claim}"><button>Claim linb.io/${options.claim}</button></form><p class="pg-agree">By claiming you agree to the <a href="/terms">Terms</a>. The <a href="/privacy">Privacy notice</a> says what linb.io stores.</p>
      <a href="/">Try another name</a></aside>`:''}
    </body></html>`;
}
