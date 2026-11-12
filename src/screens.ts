import { html } from 'hono/html';

// The screens of the fresh start (RDY D-TG9VX, section s-W8K47): one main action and few words on each.
export const appStyles='/assets/app.css?v=5';

function screen(title:string,body:unknown,options:{refresh?:string;canonical?:string;skin?:string;script?:string}={}) {
  return html`<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">
    <title>${title} · LINB</title><link rel="stylesheet" href="${appStyles}">
    <link rel="icon" href="/assets/linb.svg" type="image/svg+xml">
    ${options.canonical?html`<link rel="canonical" href="${options.canonical}">`:''}
    ${options.skin?html`<link rel="stylesheet" href="${options.skin}">`:''}
    ${options.refresh?html`<meta http-equiv="refresh" content="0;url=${options.refresh}">`:''}
    ${options.script?html`<script src="${options.script}" defer></script>`:''}
    </head><body><main class="app">${body}</main></body></html>`;
}

const top=(signIn=true)=>html`<header class="app-top"><a class="app-logo" href="/">LINB</a>${signIn?html`<a href="/sign-in">Sign in</a>`:''}</header>`;

export function landingPage(options:{preview:boolean;missing?:string;invalid?:boolean;limited?:boolean;unavailable?:boolean;closed?:boolean;canonical?:string}) {
  const note=options.missing?'Twitch has no channel named '+options.missing+'.'
    :options.invalid?'Use 3 to 25 letters, numbers or underscores.'
    :options.limited?'Too many previews. Try again in an hour.'
    :options.unavailable?'Twitch did not answer. Try again in a minute.':'';
  return screen('Link in bio for streamers',html`${top()}
    <h1>Your stream.<br>One link.</h1>
    ${options.preview?html`<p class="app-lead">Type your Twitch name. See your page in ten seconds.</p>
      ${note?html`<p class="app-note" role="alert">${note}</p>`:''}
      <form class="app-claim" method="get" action="/preview">
        <label class="app-field" for="name"><span>linb.io/</span><input id="name" name="name" aria-label="Your Twitch name" required maxlength="25" pattern="[A-Za-z0-9_]{3,25}" autocapitalize="none" autocomplete="off" spellcheck="false" placeholder="yourtwitchname"></label>
        <button>Show my page</button>
      </form>
      <p class="app-fine">${options.closed?'Sign-up is by invitation for now.':'No sign-up needed.'}</p>`
    :html`<p class="app-lead">A link in bio that goes live when you do.</p>
      <a class="app-primary" href="/sign-in">Sign in</a>`}`,{canonical:options.canonical});
}

// The browser shows this screen while it waits for the preview that the refresh asks for.
export function buildingPage(login:string) {
  return screen('Building your page',html`${top(false)}
    <h1>Building your page</h1><p class="app-lead">Reading twitch.tv/${login}</p>
    <ul class="app-steps"><li>Name and bio</li><li>Avatar and banner</li><li>Colours and font</li><li>Live status</li></ul>
    <div class="app-skeleton" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div>`,
    {refresh:'/preview/page?name='+login});
}

const progress=(step:number)=>html`<header class="app-top"><a class="app-logo" href="/">LINB</a><span class="app-dots" aria-label="Step ${step} of 2"><i class="on"></i><i${step>1?html` class="on"`:''}></i></span></header>`;
const hidden=(csrf:string,operation:string)=>html`<input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="operationId" value="${operation}">`;
const platformFields=[['youtube','youtube.com/@','YouTube'],['tiktok','tiktok.com/@','TikTok'],['x','x.com/','X'],['instagram','instagram.com/','Instagram'],['kick','kick.com/','Kick']];

// Setup step 1 of 2 (RDY r-FYDDP): the other platforms of the creator.
export function linksStep(options:{csrf:string;operation:string;error?:string;values?:Record<string,string>}) {
  return screen('Your links',html`${progress(1)}
    <h1>Where else are you?</h1><p class="app-lead">Add your name on each platform that you use. You can change this later.</p>
    ${options.error?html`<p class="app-note" role="alert">${options.error}</p>`:''}
    <form class="app-claim" method="post" action="/start/links">${hidden(options.csrf,options.operation)}
      ${platformFields.map(([platform,prefix,label])=>html`<label class="app-field app-small" for="link-${platform}"><span class="app-icon" data-platform="${platform}"></span><span>${prefix}</span><input id="link-${platform}" name="${platform}" aria-label="Your ${label} name" maxlength="40" autocapitalize="none" autocomplete="off" spellcheck="false" value="${options.values?.[platform]??''}"></label>`)}
      <button>Continue</button>
    </form>
    <a class="app-skip" href="/start/look">Skip</a>`);
}

// Setup step 2 of 2: the matched colours come first, and a theme is one choice away.
// The matched colours come first when the draft has them. The themes follow.
export function lookCards(theme:string,art:boolean) {
  const look=(value:string,label:string,checked:boolean)=>html`<label><input type="radio" name="look" value="${value}"${checked?html` checked`:''}>
    <span class="app-look" data-look="${value}"><i></i><b>Aa</b><u></u><u></u></span>${label}</label>`;
  return html`<div class="app-looks">${art?look('art','Your colours',true):''}${['Nebula','Ember','Tide','Paper'].map(name=>look(name,name,!art&&name===theme))}</div>`;
}

export function lookStep(options:{csrf:string;operation:string;theme:string;skin?:string}) {
  return screen('Your look',html`${progress(2)}
    <h1>Pick a look</h1><p class="app-lead">${options.skin?'We matched one to your channel.':'You can change it later.'}</p>
    <form class="app-claim" method="post" action="/start/look">${hidden(options.csrf,options.operation)}
      ${lookCards(options.theme,Boolean(options.skin))}
      <button>Publish my page</button>
    </form>
    <a class="app-skip" href="/editor">Not now</a>`,{skin:options.skin});
}

export function liveStep(options:{address:string;path:string}) {
  return screen('Your page is live',html`${top(false)}
    <span class="app-tick" aria-hidden="true">✓</span><h1>Your page is live</h1>
    <label class="app-field app-copy" for="address"><input id="address" aria-label="The address of your page" readonly value="${options.address}"></label>
    <p class="app-lead">Put it in your Twitch panels and in your TikTok, Instagram and X bio.</p>
    <div class="app-actions"><a class="app-primary" href="${options.path}">View my page</a><a class="app-secondary" href="/editor">Edit my page</a></div>`);
}

// Sign-in: Twitch first for a creator, then the one-time link by email.
export function signInPage(options:{operator?:boolean;sent?:boolean;twitch?:boolean;state?:string}) {
  const action=options.operator?'/ops/sign-in':'/sign-in';
  const note=options.state==='mailbox'?'Twitch knows you. Sign in with the email of your linb.io account to connect it.'
    :options.state==='retry'?'Twitch did not complete the sign-in. Try again or use your email.'
    :options.state==='email'?'Twitch gave no verified email. Verify your email at Twitch, then try again.':'';
  const twitch=options.twitch&&!options.operator&&options.state!=='mailbox';
  return screen(options.operator?'Operator sign-in':'Sign in',html`${top(false)}
    <h1>${options.sent?'Check your mailbox':options.operator?'Operator sign-in':'Sign in'}</h1>
    ${options.sent?html`<p class="app-lead">If this mailbox can use LINB, a sign-in link is on its way. Look in your spam folder if it does not arrive.</p>
      <a class="app-secondary" href="${action}">Send another link</a>`
    :html`${note?html`<p class="app-note" role="alert">${note}</p>`:''}
      ${twitch?html`<form method="post" action="/auth/twitch"><button class="app-twitch">Continue with Twitch</button></form><p class="app-or">or</p>`:''}
      <form class="app-claim" method="post" action="${action}">
        <label class="app-field" for="mailbox"><input id="mailbox" name="mailbox" aria-label="Email address" autocomplete="email" type="email" maxlength="254" required placeholder="you@example.com"></label>
        <button>Email me a sign-in link</button>
      </form>
      <p class="app-fine">The link works once. It signs you in on this device.</p>`}`);
}

// The link from the email opens this screen. The script puts the token of the link into the form.
export function confirmPage() {
  return screen('Confirm access',html`${top(false)}
    <h1>Confirm access</h1><p id="confirm-status" class="app-lead">Confirm to continue with this one-time link.</p>
    <form class="app-claim" method="post" action="/verify"><input type="hidden" id="confirmation-token" name="token"><button id="confirm-access" disabled>Confirm access</button></form>
    <noscript><p class="app-fine">Open the sign-in link in a browser with JavaScript on.</p></noscript>`,{script:'/assets/verify.js'});
}

export function messagePage(title:string,text:string,href='/',label='Back to LINB') {
  return screen(title,html`${top(false)}<h1>${title}</h1><p class="app-lead">${text}</p><a class="app-secondary" href="${href}">${label}</a>`);
}
