import { html, raw } from 'hono/html';
import { randomUUID } from 'node:crypto';
import { nextSession, themeNames, type HomeContent } from './domain.ts';
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

function frame(title:string,body:any,options:{theme?:string;privatePage?:boolean;script?:boolean;verify?:boolean;preview?:boolean;wide?:boolean;creator?:boolean;canonical?:string;standalone?:boolean}={}) {
  return html`<!doctype html><html lang="en" data-theme="${options.theme??'LINB'}"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="${options.theme==='Hearth'||options.theme==='Grove'?'light':'dark'}">
    <title>${title} · LINB</title><link rel="stylesheet" href="/assets/lobby.css?v=linb">
    <link rel="icon" href="/assets/linb.svg" type="image/svg+xml">
    ${options.canonical?html`<link rel="canonical" href="${options.canonical}">`:''}
    ${options.script?html`<script src="/assets/editor.js" defer></script>`:''}
    ${options.verify?html`<script src="/assets/verify.js" defer></script>`:''}
    ${options.preview?html`<script src="/assets/preview.js" defer></script>`:''}
    </head><body>${options.creator||options.standalone?'':html`<header class="top"><a href="/" class="brand">${mark}<span>LINB</span></a>
      <span class="top-label">${options.privatePage?'Creator workspace':'LINK IN BIO FOR STREAMERS'}</span>
      ${options.privatePage?html`<nav aria-label="Workspace"><a href="/editor">Editor</a><a href="/account">Account</a></nav>`:html`<a class="small-link" href="/sign-in">Creator sign-in <span aria-hidden="true">↗</span></a>`}
    </header>`}<main class="${options.wide?'wide':'shell'}">${body}</main>
    ${options.standalone?'':options.creator?html`<footer class="creator-credit"><a href="/">Made with LINB</a></footer>`:
      html`<footer class="footer"><span>${mark} LINB</span><span>linb.io · Built for streamers.</span></footer>`}
    </body></html>`;
}

export function landing(available:boolean,demo:boolean,canonical?:string) {
  return frame('Link in bio for streamers',html`
    <section class="linb-hero">
      <div class="linb-intro">
        <div class="brand-kicker"><span class="pixel" aria-hidden="true"></span> LINB.IO <span aria-hidden="true">//</span> LINK IN BIO</div>
        <h1>One link.<br><em>All your<br class="hero-break"> worlds.</em></h1>
        <p>Give fans one place to find your stream, your community, and everything else you make. Give it a look that’s all yours.</p>
        <div class="hero-actions">${available?html`<a class="button" href="/sign-in">Creator sign-in <span aria-hidden="true">↗</span></a>`:
          html`<span class="dim">Creator access is currently by invitation.</span>`}${demo?html`<a class="button secondary" href="/demo">Try the example</a>`:''}</div>
        <div class="brand-kicker hero-note">NO FAN ACCOUNT NEEDED</div>
      </div>
      <div class="linb-stage">
        <div class="stage-label"><span>LINK PAGE PREVIEW</span><span>01 / 01</span></div>
        <div class="sample">
          <div class="sample-banner" aria-hidden="true"></div>
          <div class="sample-body">
            <div class="sample-avatar" aria-hidden="true">MV</div>
            <p class="sample-name">Mira Vale</p>
            <p class="sample-caption">Cozy runs. Chaotic co-op.</p>
            <ul aria-label="Example creator links">
              <li>Watch on Twitch <span aria-hidden="true">↗</span></li>
              <li>Join the Discord <span aria-hidden="true">↗</span></li>
              <li>Clips & highlights <span aria-hidden="true">↗</span></li>
            </ul>
          </div>
        </div>
        <div class="stage-label"><span>FICTIONAL CREATOR</span><span aria-hidden="true">◆</span></div>
      </div>
    </section>
    <section class="linb-features" aria-label="What LINB does">
      <article><span class="micro">01 / LINKS</span><h2>Send fans somewhere good.</h2><p>Put your stream, socials, and favorite places up front.</p></article>
      <article><span class="micro">02 / STYLE</span><h2>Make it look like you.</h2><p>Pick a theme, add your art, and give fans a page they’ll recognize.</p></article>
      <article><span class="micro">03 / PUBLISH</span><h2>Go public when you’re ready.</h2><p>Preview changes privately, then publish them to the same link.</p></article>
    </section>`,{wide:true,canonical});
}

export function signIn(operator=false,sent=false) {
  const action=operator?'/ops/sign-in':'/sign-in';
  return frame(operator?'Operator access':'Creator sign-in',html`<section class="panel auth">
    <p class="eyebrow">${operator?'OPERATOR WORKSPACE':'CREATOR WORKSPACE'}</p><h1>${sent?'Check your mailbox':'Sign in to LINB'}</h1>
    ${sent?html`<p>If this mailbox can access LINB, we’ll send a sign-in link. Check your spam folder if it doesn’t arrive.</p><a href="${action}">Request another link</a>`:
      html`<p>Use the mailbox associated with your ${operator?'operator access':'pilot invitation'}. We’ll send you a one-time link.</p>
      <form method="post" action="${action}"><label for="mailbox">Email address</label><input id="mailbox" name="mailbox" autocomplete="email" type="email" maxlength="254" required>
      <button>Send sign-in link</button></form><p class="dim">Lost access to your mailbox? You may be unable to recover the account.</p>`}
    </section>`);
}

export function confirmation() {
  return frame('Confirm access',html`<section class="panel auth"><p class="eyebrow">SECURE ACCESS</p><h1>Confirm access</h1>
    <p id="confirm-status">Confirm to continue with this one-time link.</p><form method="post" action="/verify">
    <input type="hidden" id="confirmation-token" name="token"><button id="confirm-access" disabled>Confirm access</button></form>
    <noscript><p>Open the sign-in link in a browser with JavaScript enabled.</p></noscript></section>`,{verify:true});
}

export function message(title:string,text:string,href='/',label='Back to LINB') {
  return frame(title,html`<section class="panel auth"><h1>${title}</h1><p>${text}</p><a class="button secondary" href="${href}">${label}</a></section>`);
}

export function retiredCalendar(homeId:string) {
  const title='Calendar downloads have ended';
  return frame(title,html`<section class="panel auth"><h1>${title}</h1>
    <p>Open the creator’s page for their latest links and schedule.</p>
    <a class="button" href="/h/${homeId}">Open creator page</a></section>`,{standalone:true});
}

function streamLabel(link:string) {
  if (!link) return '';
  const host=new URL(link).hostname.toLowerCase().replace(/^www\./,'');
  if (host==='twitch.tv') return 'Open stream on Twitch';
  if (host==='youtube.com'||host==='youtu.be') return 'Open stream on YouTube';
  if (host==='kick.com') return 'Open stream on Kick';
  return 'Open stream';
}

export function renderHome(content:HomeContent,options:{now:number;asset:(id:string)=>string;canonical?:string;
  preview?:boolean;review?:boolean;report?:string;demo?:boolean}) {
  const slot=nextSession(content,options.now);
  const name=content.displayName||'Your creator name';
  const initials=name.split(/\s+/).slice(0,2).map(word=>[...word][0]).join('').toUpperCase();
  return frame(name,html`
    ${options.preview?html`<aside class="status-note">Private preview · Unsaved values
      <button type="button" class="secondary" id="return-to-editor">Return to editor</button>
      <p class="dim">If this tab stays open, close it to return to your unsaved editor.</p></aside>`:''}
    ${options.review?html`<aside class="status-note">Restricted publication review · <a href="/ops">Back to cases</a></aside>`:''}
    <article class="creator"><div class="cover">${content.coverId?html`<img src="${options.asset(content.coverId)}" alt="" fetchpriority="high">`:options.demo?art:html`<div class="plain-cover"></div>`}</div>
      <div class="creator-body"><div class="identity">${content.avatarId?html`<img class="avatar" src="${options.asset(content.avatarId)}" alt="">`:
        html`<div class="avatar initials" aria-hidden="true">${initials}</div>`}
        <div><span class="micro dim">CREATOR HOME</span><h1>${name}</h1>${content.intro?html`<p>${content.intro}</p>`:''}</div></div>
      ${content.game?html`<div class="game"><span class="micro">CURRENT GAME</span><strong>${content.game}</strong></div>`:''}
      ${content.streamUrl?html`<a class="button secondary stream" href="${content.streamUrl}">${streamLabel(content.streamUrl)} <span aria-hidden="true">↗</span></a>`:
        html`<p class="dim compact">Stream link is not available.</p>`}
      ${content.links.length?html`<section class="links"><h2>Key links</h2><ul>${content.links.map(item=>html`<li><a href="${item.url}">${item.label} <span aria-hidden="true">↗</span></a></li>`)}</ul></section>`:''}
      ${slot?html`<section class="next"><p class="micro">NEXT SESSION</p><h2>${slot.title}</h2><dl>
        <div><dt>Date</dt><dd>${slot.local.slice(0,10)}</dd></div><div><dt>Time</dt><dd>${slot.local.slice(11)}</dd></div>
        <div><dt>Time zone</dt><dd>${slot.zone} (${slot.offset})</dd></div></dl></section>`:''}
      ${content.updates.length?html`<section class="updates"><h2>Updates</h2>${content.updates.map(update=>html`
        <article>${update.firstPublishedAt?html`<time datetime="${update.firstPublishedAt}">${update.firstPublishedAt.slice(0,10)} UTC</time>`:
          options.preview?html`<small>Date added when published.</small>`:''}<p>${update.text}</p></article>`)}</section>`:''}
      ${options.preview||options.review?'':html`<p class="bookmark">Save this home in your browser.</p>
        ${options.report?html`<a class="dim" href="mailto:${options.report}">Report a public home</a>`:''}`}
      </div></article>`,{theme:content.theme,preview:options.preview,creator:true,canonical:options.canonical});
}

export function editorPage(state:HomeState,csrf:string,imagesEnabled:boolean) {
  return frame('Edit your home',html`<div class="workspace" id="workspace" data-content="${JSON.stringify(state.content)}"
    data-home="${state.id}" data-csrf="${csrf}" data-revision="${state.draft_revision}" data-publication="${state.publication_id??''}" data-held="${state.held}">
    <header class="workspace-head"><div><p class="eyebrow">LINB / WORKSPACE</p><h1>Edit your home</h1><p>Set up the page your fans will come back to.</p></div>
      <span id="availability" class="badge">${state.held?'Home held':state.publication_id?'Home available':'Private draft'}</span></header>
    <aside id="hold-note" class="status-note" ${state.held?'':raw('hidden')}>Home held—unavailable to the public. Publishing changes will not release the hold.
      ${state.hold_reason?html`<p>Reason: ${state.hold_reason}. <a href="/account">Contact the review operator.</a></p>`:''}</aside>
    ${state.notice&&!state.held?html`<p class="status-note">${state.notice}</p>`:''}
    <div class="workspace-grid"><form id="home-form" class="panel">
      <div id="errors" class="notice error" tabindex="-1" hidden><strong>Review these fields</strong><ul></ul></div>
      <section><h2>Identity</h2>
        <label for="displayName">Display name <small>Required · 40 characters</small></label><input id="displayName" maxlength="40" required value="${state.content.displayName}">
        <label for="intro">Intro <small>Required · 160 characters</small></label><textarea id="intro" maxlength="160" required>${state.content.intro}</textarea>
        <label for="game">Current game</label><input id="game" maxlength="80" value="${state.content.game}">
        <label for="streamUrl">Stream destination <small>HTTPS address</small></label><input id="streamUrl" type="url" maxlength="2048" value="${state.content.streamUrl}">
      </section><section><h2>Theme and art</h2>
        <fieldset><legend>Theme</legend><div class="theme-picker">${themeNames.map(theme=>html`<label><input name="theme" type="radio" value="${theme}" ${state.content.theme===theme?raw('checked'):''}><span class="swatch" data-swatch="${theme}"></span>${theme}</label>`)}</div></fieldset>
        ${imagesEnabled?html`<div class="image-controls">${['avatarId','coverId'].map(key=>html`<div>
          <label for="${key}">${key==='avatarId'?'Avatar':'Cover image'}</label>
          <input id="${key}" type="file" accept="image/jpeg,image/png,image/webp"><button class="secondary" type="button" data-remove-image="${key}">Remove</button><small id="${key}-state"></small>
          </div>`)}</div>`:html`<p class="dim">Image upload is unavailable in this environment.</p>`}
      </section><section><h2>Schedule</h2><p>Add an optional next stream to your link page. Save and publish to make the change public.</p><div id="sessions"></div>
        <button type="button" class="secondary" data-add="sessions">Add a session</button></section>
      <section><h2>Updates</h2><p>Up to three updates. LINB adds the date when you first publish an update.</p><div id="updates"></div>
        <button type="button" class="secondary" data-add="updates">Add an update</button></section>
      <section><h2>Key links</h2><div id="links"></div><button type="button" class="secondary" data-add="links">Add a link</button></section>
      <div class="form-actions"><button id="save" type="submit">Save draft</button><button id="preview" type="button" class="secondary">Open full preview</button></div>
    </form><aside class="workspace-side"><section class="panel"><p class="micro">PUBLISHING</p><h2>Public home</h2>
       <p id="revision-label">Draft revision ${state.draft_revision}</p><p class="dim" id="publish-help">Save changes before you publish.</p>
       <button type="button" id="publish" ${state.draft_revision===0?raw('disabled'):''}>Publish</button>
       <a class="button secondary" id="public-link" href="/h/${state.id}" ${state.publication_id&&!state.held?'':raw('hidden')}>Open home ↗</a>
       <button type="button" id="unpublish" class="secondary" ${state.publication_id?'':raw('hidden')}>Unpublish</button>
       <div class="notice" id="editor-status" role="status" hidden></div><button id="retry" type="button" class="secondary" hidden>Retry original attempt</button>
       <button id="compare" type="button" class="secondary" hidden>Compare with saved draft</button>
       <div id="reconnect" class="form-actions" hidden><a href="/sign-in" target="_blank" rel="noopener">Sign in in a new tab</a>
         <button type="button" class="secondary">Reconnect editor</button></div>
      </section><section class="panel"><p class="micro">PRIVATE PREVIEW</p><h2 id="mini-name">${state.content.displayName||'Your creator name'}</h2>
      <p id="mini-intro">${state.content.intro||'Your intro appears here.'}</p><p class="dim">The preview uses local changes. Your public home changes after Publish.</p></section></aside></div>
    <dialog id="compare-dialog"><h2>Compare drafts</h2><p>Choose which changes to keep in the editor. Uncheck a field to use its saved value.</p><div id="comparison"></div>
      <form method="dialog"><button value="cancel" class="secondary">Cancel</button><button value="reapply">Apply selected changes</button></form></dialog>
    <dialog id="unpublish-dialog"><h2>Unpublish your home?</h2><p>The public page and its shared images become unavailable. Your private draft stays in the editor.</p>
      <form method="dialog"><button class="secondary" value="cancel">Cancel</button><button value="unpublish">Unpublish</button></form></dialog>
    </div>`,{theme:state.content.theme,wide:true,privatePage:true,script:true});
}

function hidden(csrf:string) {return html`<input type="hidden" name="csrf" value="${csrf}">`;}
export function accountPage(email:string,change:any,csrf:string,contact:string|null,notice?:string) {
  return frame('Account',html`<section class="panel auth"><p class="eyebrow">ACCOUNT</p><h1>Creator account</h1><p>Verified mailbox: <strong>${email}</strong></p>
    ${notice?html`<p class="notice">${notice}</p>`:''}
    ${change?html`<p>Current mailbox: ${change.old_proved?'Verified':'Awaiting proof'}. New mailbox: ${change.new_proved?'Verified':'Awaiting proof'}.</p>
      <p>Starting a replacement change invalidates any previous proof links.</p>`:''}
    <form method="post" action="/account/mailbox">${hidden(csrf)}<label for="next">New email address</label><input id="next" type="email" name="mailbox" required>
      ${change?html`<label class="check"><input type="checkbox" name="replace" required> Replace the pending mailbox change</label>`:''}
      <button>${change?'Start replacement change':'Send verification links'}</button></form>
    ${contact?html`<p><a href="mailto:${contact}">Contact the review operator</a></p>`:''}
    <form method="post" action="/logout">${hidden(csrf)}<button class="secondary">Sign out</button></form></section>`,{privatePage:true});
}

export function opsPage(rows:any[],csrf:string,reasons:string[]) {
  return frame('Operator workspace',html`<header class="workspace-head"><div><p class="eyebrow">RESTRICTED WORKSPACE</p><h1>Public-home cases</h1><a href="/ops/invites">Pilot invitations</a></div>
    <form method="post" action="/ops/logout">${hidden(csrf)}<button class="secondary">Sign out</button></form></header>
    <div class="workspace-grid"><section class="panel"><h2>Open a case</h2>
    <form method="post" action="/ops/cases">${hidden(csrf)}<label for="home">Home ID from the public address</label><input id="home" name="homeId" required>
    <label for="reviewer">Independent designated reviewer</label><input id="reviewer" type="email" name="reviewer" required>
    <label for="reason">Reason</label><select id="reason" name="reason">${reasons.map(reason=>html`<option>${reason}</option>`)}</select>
    <label for="evidence">Minimum necessary evidence</label><textarea id="evidence" name="evidence" maxlength="1200" required></textarea><button>Open case</button></form></section>
    <section class="panel"><h2>Assigned cases</h2>${rows.length?html`<ul class="case-list">${rows.map(row=>html`<li><a href="/ops/cases/${row.id}">${row.reason}</a>
    <span>${row.released_at?'Released':row.applied_at?'Held':'Open'}</span></li>`)}</ul>`:html`<p>No assigned cases.</p>`}</section></div>`,{wide:true});
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
