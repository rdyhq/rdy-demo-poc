import { html } from 'hono/html';
import { artPalette, skinPath } from './public/palette.js';
import { channelPlatform } from './home-cards.ts';
import type { HomeState } from './homes.ts';
import { appStyles, lookCards } from './screens.ts';

// The editor of the fresh start (RDY D-TG9VX, section s-P8ZS4): three tabs, a list, and a preview of the page.
type Tab='page'|'look'|'link';
// twitch: linb.io reads the linked Twitch channel for this Home, so the Page tab lists the parts from Twitch.
export type EditorView={state:HomeState;csrf:string;error?:string;address?:string;path?:string;twitch?:boolean};

const hidden=(csrf:string)=>html`<input type="hidden" name="csrf" value="${csrf}">`;
const shown=(url:string)=>url.replace(/^https:\/\/(www\.)?/,'').replace(/\/$/,'');

function frame(title:string,tab:Tab,view:EditorView,body:unknown) {
  const {state,csrf}=view, {aura}=state.content;
  const art=aura.palette&&artPalette({...aura.palette,accent:aura.accent});
  const status=!state.publication_id?'Not published':state.published_revision===state.draft_revision?'Published':'Changes not published';
  const link=(to:Tab,href:string,label:string)=>html`<a href="${href}"${tab===to?html` aria-current="page"`:''}>${label}</a>`;
  return html`<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">
    <title>${title} · LINB</title><link rel="stylesheet" href="${appStyles}">
    ${art?html`<link rel="stylesheet" href="${skinPath(aura.palette,aura.accent)}">`:''}
    <link rel="icon" href="/assets/linb.svg" type="image/svg+xml">
    </head><body class="ed"><header class="ed-top"><a class="app-logo" href="/editor">LINB</a>
    <nav class="ed-tabs" aria-label="Editor">${link('page','/editor','Page')}${link('look','/editor/look','Look')}${link('link','/editor/link','Share')}</nav>
    <div class="ed-publish"><span class="ed-state">${status}</span>
      <form method="post" action="/editor/publish">${hidden(csrf)}<button${status==='Published'||!state.draft_revision?html` disabled`:''}>Publish</button></form></div>
    </header><div class="ed-body"><main class="ed-main">
      ${view.error?html`<p class="app-note" role="alert">${view.error}</p>`:''}${body}</main>
    <aside class="ed-side"><iframe class="ed-preview" title="Preview of your page" src="/editor/view"></iframe>
      <a class="ed-open" href="/editor/view">Open the preview</a></aside></div>
    </body></html>`;
}

// The Page tab: each row is one part of the Home, and each form saves to the draft by itself (RDY r-K3YBN).
export function pageTab(view:EditorView) {
  const {content}=view.state, {csrf}=view;
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
    ${view.twitch?html`<h2>From Twitch</h2>
    <ul class="ed-list">${([['schedule','Schedule',content.layout.supporting.find(card=>card.family==='schedule')?.hidden===true],
      ['clips','Clips',content.layout.clipsHidden]] as const).map(([part,label,off])=>html`<li class="ed-row ed-link"><i aria-hidden="true"><span class="app-icon" data-platform="twitch"></span></i>
      <span><strong>${label}</strong><small>Synced with Twitch</small></span>
      <form method="post" action="/editor/twitch">${hidden(csrf)}<input type="hidden" name="part" value="${part}"><input type="hidden" name="show" value="${off?'1':'0'}"><button aria-pressed="${off?'false':'true'}" aria-label="Show the ${part} on my page">${off?'Off':'On'}</button></form></li>`)}</ul>`:''}`);
}

export function lookTab(view:EditorView) {
  const {content}=view.state, {csrf}=view;
  return frame('Your look','look',view,html`<h1>Your look</h1>
    <form class="app-claim" method="post" action="/editor/look">${hidden(csrf)}
      ${lookCards(content.theme,Boolean(content.aura.palette))}<button>Use this look</button></form>
    <form class="ed-match" method="post" action="/editor/look">${hidden(csrf)}<input type="hidden" name="action" value="match">
      <p>Take the colours and the font from your avatar and banner.</p><button class="ed-secondary">Match my art</button></form>`);
}

export function linkTab(view:EditorView) {
  return frame('Share your page','link',view,html`<h1>Your address</h1>
    ${view.address?html`<label class="app-field app-copy" for="address"><input id="address" aria-label="The address of your page" readonly value="${view.address}"></label>
      <a class="app-primary" href="${view.path}">View my page</a>
      <form class="ed-down" method="post" action="/editor/unpublish">${hidden(view.csrf)}<button class="ed-quiet">Take my page down</button></form>`
    :html`<p class="app-lead">Your page is not published. Select Publish to put it online.</p>`}`);
}
