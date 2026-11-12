import { html, raw } from 'hono/html';
import { randomUUID } from 'node:crypto';
import { appStyles } from './screens.ts';

// The operator screens in the look of the app (RDY D-TG9VX): cases, the fan report inbox and invitations.
const hidden=(csrf:string)=>html`<input type="hidden" name="csrf" value="${csrf}">`;

function frame(title:string,tab:'cases'|'invites',csrf:string,body:unknown) {
  const link=(to:string,href:string,label:string)=>html`<a href="${href}"${tab===to?html` aria-current="page"`:''}>${label}</a>`;
  return html`<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">
    <title>${title} · LINB</title><link rel="stylesheet" href="${appStyles}">
    <link rel="icon" href="/assets/linb.svg" type="image/svg+xml">
    </head><body class="ed"><header class="ed-top"><a class="app-logo" href="/ops">LINB</a>
    <nav class="ed-tabs" aria-label="Operator">${link('cases','/ops','Cases')}${link('invites','/ops/invites','Invitations')}</nav>
    <div class="ed-publish"><span class="ed-state">Operator</span>
      <form method="post" action="/ops/logout">${hidden(csrf)}<button class="ed-quiet">Sign out</button></form></div>
    </header><div class="ed-body ed-solo"><main class="ed-main">${body}</main></div>
    </body></html>`;
}

export function opsPage(rows:any[],csrf:string,reasons:string[],reports:any[]=[]) {
  return frame('Cases','cases',csrf,html`<h1>Cases</h1>
    <h2>Assigned cases</h2>
    ${rows.length?html`<ul class="ed-list">${rows.map(row=>html`<li class="ed-row ed-link"><span><strong><a href="/ops/cases/${row.id}">${row.reason}</a></strong></span>
      <small>${row.released_at?'Released':row.applied_at?'Held':'Open'}</small></li>`)}</ul>`:html`<p class="ed-lead">No assigned cases.</p>`}
    <h2>Fan report inbox</h2>
    <p class="ed-lead">Review the report before opening a case. Submitting a report does not apply a hold.</p>
    ${reports.length?html`<ul class="ed-list">${reports.map(report=>html`<li class="ed-row ed-stack"><h3>${report.reason}</h3>
      <p class="ed-fine">Home ID: ${report.home_id}</p><p>${report.detail}</p>
      <form method="post" action="/ops/fan-reports/${report.id}/resolve">${hidden(csrf)}<button class="ed-secondary">Mark reviewed</button></form></li>`)}</ul>`
      :html`<p class="ed-lead">No unreviewed reports.</p>`}
    <h2>Open a case</h2>
    <form class="ed-row ed-profile" method="post" action="/ops/cases">${hidden(csrf)}
      <label for="home">Home ID from the public address</label><input id="home" name="homeId" required>
      <label for="reviewer">Independent designated reviewer</label><input id="reviewer" type="email" name="reviewer" required>
      <label for="reason">Reason</label><select class="app-select" id="reason" name="reason">${reasons.map(reason=>html`<option>${reason}</option>`)}</select>
      <label for="evidence">Minimum necessary evidence</label><textarea id="evidence" name="evidence" maxlength="1200" rows="4" required></textarea>
      <button>Open case</button></form>`);
}

export function invitesPage(rows:any[],csrf:string,issued:boolean) {
  return frame('Invitations','invites',csrf,html`<h1>Invitations</h1>
    ${issued?html`<p class="ed-note" role="status">Invitation recorded. Ask the creator to request a sign-in link.</p>`:''}
    <h2>Admit a mailbox</h2>
    <form class="ed-row ed-profile" method="post" action="/ops/invites">${hidden(csrf)}
      <label for="alias">Pilot alias</label><input id="alias" name="alias" required maxlength="40">
      <label for="mailbox">Invited mailbox</label><input id="mailbox" name="mailbox" type="email" required>
      <button>Admit mailbox</button></form>
    <p class="ed-fine">The invitation expires after seven days. The log uses the pilot alias and the invitation ID.</p>
    <h2>Invitation outcomes</h2>
    ${rows.length?html`<ul class="ed-list">${rows.map(row=>html`<li class="ed-row ed-link"><span><strong>${row.pilot_alias}</strong><small>${row.id}</small></span>
      <small>${row.consumed_at?'Consumed':row.revoked_at?'Revoked':row.expired?'Expired':'Pending'}</small>
      ${!row.consumed_at&&!row.revoked_at&&!row.expired?html`<form method="post" action="/ops/invites/${row.id}/revoke">${hidden(csrf)}<button class="ed-secondary">Revoke invitation</button></form>`:''}</li>`)}</ul>`
      :html`<p class="ed-lead">No invitations.</p>`}`);
}

export function opsCase(row:any,events:any[],actor:string,csrf:string) {
  const route='/ops/cases/'+row.id;
  const params=()=>html`${hidden(csrf)}<input type="hidden" name="operationId" value="${randomUUID()}"><input type="hidden" name="publicationId" value="${row.publication_id??''}">`;
  return frame('Case','cases',csrf,html`<h1>${row.reason}</h1>
    <div class="ed-row ed-stack"><p class="ed-fine">Case ${row.id}</p><p class="ed-fine">Home ${row.home_id}</p>
      <p>${row.evidence??'Evidence expired or removed.'}</p></div>
    ${row.applier_id===actor&&!row.applied_at?html`<form class="ed-row" method="post" action="${route}/hold">${params()}<button>Apply visibility hold</button></form>`:''}
    ${row.reviewer_id===actor&&row.applied_at&&!row.released_at?html`<div class="ed-row ed-stack">
      <a href="${route}/publication">Inspect the current held publication</a>
      <form method="post" action="${route}/review">${params()}<button class="ed-secondary">Record review</button></form>
      <form class="ed-profile" method="post" action="${route}/release">${params()}<label for="rationale">Release rationale</label><input id="rationale" name="reason" required maxlength="240">
        <button ${row.reviewed_at?'':raw('disabled')}>Release hold</button></form></div>`:''}
    <h2>Audit events</h2>
    <ul class="ed-list">${events.map(event=>html`<li class="ed-row"><span>${event.action}</span><small class="ed-fine">${event.created_at.toISOString()}${event.reason?' · '+event.reason:''}</small></li>`)}</ul>
    <p class="ed-more"><a href="/ops">Back to the cases</a></p>`);
}
