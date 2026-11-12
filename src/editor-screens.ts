import { html } from 'hono/html';
import { artPalette, skinPath } from './public/palette.js';
import { channelPlatform } from './home-cards.ts';
import { futureSessions, nextSession, type HomeContent, type ScheduleChange } from './domain.ts';
import type { HomeState } from './homes.ts';
import { noticeCopy } from './page.ts';
import { appStyles, lookCards } from './screens.ts';
import { discordSchedule, type Selection } from './sharing.ts';

// The editor of the fresh start (RDY D-TG9VX, section s-P8ZS4): three tabs, a list, and a preview of the page.
type Tab='page'|'look'|'link'|'account';
// twitch: linb.io reads the linked Twitch channel for this Home, so the Page tab lists the parts from Twitch.
// url: the full address of the published page, for the copy and share actions.
// now: the time of the request, to leave out a session that has passed.
export type EditorView={state:HomeState;csrf:string;error?:string;address?:string;path?:string;url?:string;twitch?:boolean;now?:number};

const hidden=(csrf:string)=>html`<input type="hidden" name="csrf" value="${csrf}">`;
const shown=(url:string)=>url.replace(/^https:\/\/(www\.)?/,'').replace(/\/$/,'');

// The named time zones that a session can use. UTC comes first.
const zones=['UTC',...Intl.supportedValuesOf('timeZone').filter(zone=>zone!=='UTC')];

// solo: a screen with one column and no preview of the page. script: the one script that the screen needs.
function frame(title:string,tab:Tab,view:EditorView,body:unknown,options:{solo?:boolean;script?:string}={}) {
  const {state,csrf}=view, {aura}=state.content;
  const art=aura.palette&&artPalette({...aura.palette,accent:aura.accent});
  const status=!state.publication_id?'Not published':state.published_revision===state.draft_revision?'Published':'Changes not published';
  const link=(to:Tab,href:string,label:string)=>html`<a href="${href}"${tab===to?html` aria-current="page"`:''}>${label}</a>`;
  return html`<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">
    <title>${title} · LINB</title><link rel="stylesheet" href="${appStyles}">
    ${art?html`<link rel="stylesheet" href="${skinPath(aura.palette,aura.accent)}">`:''}
    <link rel="icon" href="/assets/linb.svg" type="image/svg+xml">
    ${options.script?html`<script src="${options.script}" defer></script>`:''}
    </head><body class="ed"><header class="ed-top"><a class="app-logo" href="/editor">LINB</a>
    <nav class="ed-tabs" aria-label="Editor">${link('page','/editor','Page')}${link('look','/editor/look','Look')}${link('link','/editor/link','Share')}</nav>
    <div class="ed-publish"><span class="ed-state">${status}</span>
      <form method="post" action="/editor/publish">${hidden(csrf)}<button${status==='Published'||!state.draft_revision?html` disabled`:''}>Publish</button></form>
      <a class="ed-account" href="/account"${tab==='account'?html` aria-current="page"`:''}>Account</a></div>
    </header><div class="ed-body${options.solo?' ed-solo':''}"><main class="ed-main">
      ${view.error?html`<p class="app-note" role="alert">${view.error}</p>`:''}${body}</main>
    ${options.solo?'':html`<aside class="ed-side"><iframe class="ed-preview" title="Preview of your page" src="/editor/view"></iframe>
      <a class="ed-open" href="/editor/view">Open the preview</a></aside>`}</div>
    </body></html>`;
}

// The Page tab: each row is one part of the Home, and each form saves to the draft by itself (RDY r-K3YBN).
export function pageTab(view:EditorView) {
  const {content}=view.state, {csrf}=view;
  // What leads the card while the creator is offline (RDY D-6DX8J). A choice that the page cannot show reads as the next stream.
  const {offlineLead,offlineLink}=content.layout.spotlight;
  const featured=offlineLead==='link'?content.links.findIndex(link=>link.url===offlineLink):-1;
  const lead=offlineLead==='clip'&&view.twitch?'clip':featured>=0?'link:'+featured:'next';
  const choice=(value:string,label:string)=>html`<option value="${value}"${lead===value?html` selected`:''}>${label}</option>`;
  // The sessions that the creator entered. A new one starts in the zone of the last one.
  const sessions=futureSessions(content,view.now??Date.now()), zone=content.sessions.at(-1)?.zone;
  const art=(kind:'avatar'|'banner',label:string,id:string|null)=>html`<div class="ed-row ed-art-row">
    ${id?html`<img class="ed-art" src="/editor/assets/${id}" alt="">`:html`<span class="ed-art" aria-hidden="true"></span>`}
    <form method="post" action="/editor/art" enctype="multipart/form-data">${hidden(csrf)}<input type="hidden" name="kind" value="${kind}">
      <label for="ed-${kind}">${label}</label><input id="ed-${kind}" type="file" name="image" accept="image/jpeg,image/png,image/webp" required><button>Upload</button></form>
    ${id?html`<form method="post" action="/editor/art">${hidden(csrf)}<input type="hidden" name="kind" value="${kind}"><input type="hidden" name="action" value="remove">
      <button class="ed-quiet" aria-label="Remove the ${kind}">Remove</button></form>`:''}</div>`;
  return frame('Edit your page','page',view,html`<h1>Your page</h1>
    <form class="ed-row ed-profile" method="post" action="/editor/profile">${hidden(csrf)}
      <label for="ed-name">Name</label><input id="ed-name" name="displayName" required maxlength="40" value="${content.displayName}">
      <label for="ed-bio">Bio</label><textarea id="ed-bio" name="intro" maxlength="160" rows="2">${content.intro}</textarea>
      <label for="ed-game">Game</label><input id="ed-game" name="game" maxlength="80" value="${content.game}">
      <label for="ed-stream">Stream link</label><input id="ed-stream" name="streamUrl" type="url" inputmode="url" placeholder="https://www.twitch.tv/yourname" value="${content.streamUrl}">
      <button>Save</button></form>
    ${art('avatar','Avatar',content.avatarId)}${art('banner','Banner',content.coverId)}
    <h2>Links</h2>
    <ul class="ed-list">${content.links.map((link,index)=>html`<li class="ed-row ed-link"><i aria-hidden="true">${
      channelPlatform(link.url)?html`<span class="app-icon" data-platform="${channelPlatform(link.url)}"></span>`:'↗'}</i>
      <span><strong>${link.label}</strong><small>${shown(link.url)}</small></span>
      <form method="post" action="/editor/links">${hidden(csrf)}<input type="hidden" name="index" value="${index}">
        <button name="action" value="up" aria-label="Move ${link.label} up"${index?'':html` disabled`}>↑</button>
        <button name="action" value="down" aria-label="Move ${link.label} down"${index<content.links.length-1?'':html` disabled`}>↓</button>
        <button name="action" value="remove" aria-label="Remove ${link.label}">✕</button></form></li>`)}</ul>
    <form class="ed-row ed-add" method="post" action="/editor/links">${hidden(csrf)}<input type="hidden" name="action" value="add">
      <input name="label" required maxlength="32" placeholder="Label" aria-label="Link label">
      <input name="url" required type="url" inputmode="url" placeholder="https://" aria-label="Link address"><button>Add link</button></form>
    <h2>Schedule</h2>
    ${view.twitch?html`<p class="ed-fine ed-above">Your page shows these sessions when your Twitch schedule is empty.</p>`:''}
    <ul class="ed-list">${sessions.map(session=>html`<li class="ed-row ed-link"><span><strong>${session.title}</strong><small>${session.local.replace('T',' ')} · ${session.zone}</small></span>
      <form method="post" action="/editor/sessions">${hidden(csrf)}<input type="hidden" name="id" value="${session.id}">
        <button name="action" value="postpone" aria-label="Postpone ${session.title}: the new time is not known">Postpone</button>
        <button name="action" value="cancel" aria-label="Cancel ${session.title}">Cancel</button></form></li>`)}</ul>
    <details class="ed-row ed-more-form"><summary>Add a session</summary>
      <form class="ed-profile" method="post" action="/editor/sessions">${hidden(csrf)}<input type="hidden" name="action" value="add">
        <label for="ed-session">Title</label><input id="ed-session" name="title" required maxlength="80">
        <label for="ed-date">Date</label><input id="ed-date" name="date" type="date" required>
        <label for="ed-time">Time</label><input id="ed-time" name="time" type="time" required>
        <label for="ed-zone">Time zone</label><select id="ed-zone" name="zone"${zone?'':html` data-zone="auto"`}>${zones.map(name=>
          html`<option value="${name}"${name===(zone??'UTC')?html` selected`:''}>${name}</option>`)}</select>
        <button>Add session</button></form></details>
    <h2>Updates</h2>
    <ul class="ed-list">${content.updates.map(update=>html`<li class="ed-row ed-link"><span>${update.text}</span>
      <form method="post" action="/editor/updates">${hidden(csrf)}<input type="hidden" name="id" value="${update.id}">
        <button name="action" value="remove" aria-label="Remove this update">✕</button></form></li>`)}</ul>
    ${content.updates.length<3?html`<details class="ed-row ed-more-form"><summary>Add an update</summary>
      <form class="ed-profile" method="post" action="/editor/updates">${hidden(csrf)}<input type="hidden" name="action" value="add">
        <label for="ed-update">A short note for your fans</label><textarea id="ed-update" name="text" required maxlength="280" rows="3"></textarea>
        <button>Add update</button></form></details>`:html`<p class="ed-fine">Three updates at most. Take one off to add another.</p>`}
    <h2>Offline card</h2>
    <form class="ed-row ed-lead" method="post" action="/editor/lead">${hidden(csrf)}
      <label for="ed-lead">While you are offline, your card leads with</label>
      <select id="ed-lead" name="lead">${choice('next','Next stream')}${view.twitch?choice('clip','Latest clip'):''}${
        content.links.map((link,index)=>choice('link:'+index,'Link: '+link.label))}</select><button>Save</button></form>
    ${view.twitch?html`<h2>From Twitch</h2>
    <ul class="ed-list">${([['schedule','Schedule',content.layout.supporting.find(card=>card.family==='schedule')?.hidden===true],
      ['clips','Clips',content.layout.clipsHidden]] as const).map(([part,label,off])=>html`<li class="ed-row ed-link"><i aria-hidden="true"><span class="app-icon" data-platform="twitch"></span></i>
      <span><strong>${label}</strong><small>Synced with Twitch</small></span>
      <form method="post" action="/editor/twitch">${hidden(csrf)}<input type="hidden" name="part" value="${part}"><input type="hidden" name="show" value="${off?'1':'0'}"><button aria-pressed="${off?'false':'true'}" aria-label="Show the ${part} on my page">${off?'Off':'On'}</button></form></li>`)}</ul>`:''}`,{script:'/assets/zone.js'});
}

export function lookTab(view:EditorView) {
  const {content}=view.state, {csrf}=view;
  return frame('Your look','look',view,html`<h1>Your look</h1>
    <form class="app-claim" method="post" action="/editor/look">${hidden(csrf)}
      ${lookCards(content.theme,Boolean(content.aura.palette))}<button>Use this look</button></form>
    <form class="ed-match" method="post" action="/editor/look">${hidden(csrf)}<input type="hidden" name="action" value="match">
      <p>Take the colours and the font from your avatar and banner.</p><button class="ed-secondary">Match my art</button></form>`);
}

// The address with its two actions. The script shows each button that the browser supports.
const shareGroup=(address:string,url:string)=>html`<div class="ed-share" data-share data-url="${url}">
    <label class="app-field app-copy" for="address"><input id="address" aria-label="The address of your page" readonly value="${address}"></label>
    <div class="ed-share-actions"><button type="button" class="ed-secondary" data-copy hidden>Copy</button><button type="button" class="ed-secondary" data-system-share hidden>Share</button></div>
    <p class="ed-fine" role="status"></p></div>`;

export function linkTab(view:EditorView) {
  return frame('Share your page','link',view,html`<h1>Your address</h1>
    ${view.address?html`${shareGroup(view.address,view.url??view.address)}
      <a class="app-primary" href="${view.path}">View my page</a>
      <p class="ed-more"><a href="/editor/share">Link preview and texts to share</a></p>
      <form class="ed-down" method="post" action="/editor/unpublish">${hidden(view.csrf)}<button class="ed-quiet">Take my page down</button></form>`
    :html`<p class="app-lead">Your page is not published. Select Publish to put it online.</p>`}`,{script:'/assets/share.js?v=2'});
}

// The texts that a creator can paste elsewhere, and the choice of what a link preview shows.
export function shareTexts(view:EditorView,home:{id:string;publication_id:string;content:HomeContent;schedule_change:ScheduleChange|null},url:string,
  current:{title:string;description:string;coverId:string|null}|null,selection:Selection|null,proof:string|null,now:number) {
  const {content}=home, {csrf}=view;
  const slot=nextSession(content,now), change=noticeCopy(home.schedule_change,now);
  const text=(label:string,value:string)=>html`<label class="ed-text">${label}<textarea readonly rows="2">${value}</textarea></label>`;
  return frame('Share your link','link',view,html`<h1>Share your link</h1>
    <p class="ed-lead">Each text uses your address. LINB does not post them for you.</p>
    ${shareGroup(url,url)}
    <h2>Texts to share</h2>
    ${text('Stream bio','Find my stream and links: '+url)}
    ${text('Community post','I’ve put my stream, socials, and updates in one place: '+url)}
    ${text('Direct message','Here’s my link page: '+url)}
    ${slot?html`${text('Discord schedule',discordSchedule(slot.title,slot.instant,url))}
      <p class="ed-fine">Creator time: ${slot.local.replace('T',' ')} ${slot.zone} (${slot.offset})</p>`:''}
    ${change?text('Schedule correction',change+'\n'+url):''}
    <h2>Link preview</h2>
    <div class="ed-row ed-stack"><p>${current?'Rich preview is enabled for the approved fields.':'Your link currently uses the generic LINB preview.'}</p>
    <p class="ed-fine">Outside services may keep a cached copy after you disable or change your preview.</p>
    ${selection?html`<h3>Review this exact card</h3>
      <p><strong>${selection.name?content.displayName:'A creator on LINB'}</strong><br>${selection.intro?content.intro:'A link in bio for gaming and streaming creators.'}</p>
      ${selection.image&&content.coverId?html`<img class="ed-card-image" src="/h/${home.id}/images/${content.coverId}" alt="">`:''}
      <form method="post" action="/editor/share">
        ${hidden(csrf)}<input type="hidden" name="publication" value="${home.publication_id}"><input type="hidden" name="proof" value="${proof}">
        ${(['name','intro','image'] as const).filter(key=>selection[key]).map(key=>html`<input type="hidden" name="${key}" value="1">`)}
        <button name="action" value="enable">Enable this exact preview</button>
      </form>`:html`<form class="ed-stack" method="get" action="/editor/share">
      <input type="hidden" name="review" value="1">
      <label class="ed-check"><input type="checkbox" name="name" value="1"> Display name: ${content.displayName}</label>
      ${content.intro?html`<label class="ed-check"><input type="checkbox" name="intro" value="1"> Intro: ${content.intro}</label>`:''}
      ${content.coverId?html`<label class="ed-check"><input type="checkbox" name="image" value="1"> Published cover image</label>`:''}
      <button type="submit" class="ed-secondary">Review selected fields</button>
    </form>`}
    ${current?html`<form method="post" action="/editor/share">${hidden(csrf)}<button name="action" value="disable" class="ed-quiet">Disable rich preview</button></form>`:''}</div>
    <p class="ed-more"><a href="/editor/link">Back to your address</a></p>`,{solo:true,script:'/assets/share.js?v=2'});
}

// `mail` is false when the deployment has no mail service. The account then shows no control that needs a mailbox proof.
type Account={email:string;mail?:boolean;change?:{old_proved:boolean;new_proved:boolean};contact:string|null;notice?:string;
  twitch?:{linked:boolean;login?:string;status?:string};billing:boolean;handle:{current:string|null;offer:string|null}};

// The account of a creator: the sign-in email, the page address, the Twitch connection and the sign-out.
export function accountTab(view:EditorView,account:Account) {
  const {csrf}=view, {change,handle,twitch}=account, mail=account.mail!==false;
  const proof=(done:boolean)=>done?'verified':'waiting for proof';
  return frame('Account','account',view,html`<h1>Account</h1>
    ${account.notice?html`<p class="ed-note" role="status">${account.notice}</p>`:''}
    <h2>Email</h2>
    ${mail?'':html`<div class="ed-row ed-stack"><p>Your email: <strong>${account.email}</strong></p><p class="ed-fine">It comes from your Twitch account.</p></div>`}
    ${mail?html`<div class="ed-row ed-stack"><p>Your sign-in email: <strong>${account.email}</strong></p>
      ${change?html`<p class="ed-fine">A change is waiting. Current email: ${proof(change.old_proved)}. New email: ${proof(change.new_proved)}. A new change cancels the links of the earlier one.</p>`:''}
      <form class="ed-inline" method="post" action="/account/mailbox">${hidden(csrf)}<input id="next" type="email" name="mailbox" required aria-label="New email address" placeholder="New email address">
        ${change?html`<label class="ed-check"><input type="checkbox" name="replace" required> Replace the waiting change</label>`:''}
        <button class="ed-secondary">${change?'Start a new change':'Send verification links'}</button></form></div>`:''}
    ${handle.current||handle.offer?html`<h2>Page address</h2>
    <div class="ed-row ed-stack">${handle.current?html`<p>Your page address: <strong>${handle.current}</strong></p>`:''}
      ${handle.offer?html`<p>Your Twitch login changed. ${handle.current?'Your earlier address keeps working and leads to the new one.':''}</p>
        <form method="post" action="/account/handle">${hidden(csrf)}<button class="ed-secondary">Use ${handle.offer}</button></form>`:''}</div>`:''}
    ${twitch&&!mail?html`<h2>Twitch</h2>
    <div class="ed-row ed-stack"><p>${twitch.linked?'Connected'+(twitch.login?': '+twitch.login:''):'Not connected'}</p><p class="ed-fine">You sign in with Twitch.</p></div>`:''}
    ${twitch&&mail?html`<h2>Twitch</h2>
    <div class="ed-row ed-stack">${twitch.status==='verify'?html`<p>Sign in again with your email to change the Twitch connection. <a href="/sign-in">Sign in by email</a></p>`:''}
      <p>${twitch.linked?'Connected'+(twitch.login?': '+twitch.login:''):'Connect Twitch to sign in with it. Your email sign-in stays.'}</p>
      <form method="post" action="/account/twitch">${hidden(csrf)}<button name="action" value="${twitch.linked?'unlink':'link'}" class="ed-secondary">${twitch.linked?'Disconnect Twitch':'Connect Twitch'}</button></form></div>`:''}
    ${account.billing?html`<h2>Pro</h2><div class="ed-row"><a href="/account/billing">Pro test billing</a></div>`:''}
    <div class="ed-out">${account.contact?html`<a href="mailto:${account.contact}">Contact the review operator</a>`:''}
      <form method="post" action="/logout">${hidden(csrf)}<button class="ed-quiet">Sign out</button></form></div>`,{solo:true});
}

// Stripe test mode only. This screen is not a paid offer.
export function billingTab(view:EditorView,home:{id:string;publication_id:string}|null,state:any,returned:boolean) {
  const {csrf}=view;
  return frame('Pro test billing','account',view,html`<h1>Pro test billing</h1>
    <p class="ed-lead">Stripe test mode only. This is not a paid offer. Billing never changes whether your Free page is available.</p>
    ${returned?html`<p class="ed-note" role="status">Checkout returned. LINB grants access only after Stripe’s verified event.</p>`:''}
    <div class="ed-row ed-stack">${state?html`<p>Verified state: ${state.active?'Test access active':state.status}.
      ${state.access_until?'Recorded end: '+new Date(state.access_until).toISOString().slice(0,10)+' UTC.':''}</p>
      <form method="post" action="/account/billing">${hidden(csrf)}<button name="action" value="portal" class="ed-secondary">Open test billing portal</button></form>`:
      home?html`<h2>Review your exact Free fallback</h2><p>LINB keeps this home address and your Free links if Pro expires.</p>
        <p><a href="/h/${home.id}" target="_blank" rel="noopener">Review the current published Free page ↗</a></p>
        <form class="ed-stack" method="post" action="/account/billing">${hidden(csrf)}
          <input type="hidden" name="publication" value="${home.publication_id}">
          <label class="ed-check"><input type="checkbox" name="approved" value="1" required> I reviewed this Free fallback.</label>
          <button name="action" value="checkout">Try Stripe test checkout</button></form>`:
        html`<p>Publish an available Free home before trying checkout.</p><a href="/editor">Return to the editor</a>`}</div>
    <p class="ed-more"><a href="/account">Back to your account</a></p>`,{solo:true});
}
