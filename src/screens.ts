import { html } from 'hono/html';

// The screens of the fresh start (RDY D-TG9VX, section s-W8K47): one main action and few words on each.
export const appStyles='/assets/app.css?v=1';

function screen(title:string,body:unknown,options:{refresh?:string;canonical?:string}={}) {
  return html`<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">
    <title>${title} · LINB</title><link rel="stylesheet" href="${appStyles}">
    <link rel="icon" href="/assets/linb.svg" type="image/svg+xml">
    ${options.canonical?html`<link rel="canonical" href="${options.canonical}">`:''}
    ${options.refresh?html`<meta http-equiv="refresh" content="0;url=${options.refresh}">`:''}
    </head><body><main class="app">${body}</main></body></html>`;
}

const top=(signIn=true)=>html`<header class="app-top"><a class="app-logo" href="/">LINB</a>${signIn?html`<a href="/sign-in">Sign in</a>`:''}</header>`;

export function landingPage(options:{preview:boolean;missing?:string;invalid?:boolean;limited?:boolean;canonical?:string}) {
  const note=options.missing?'Twitch has no channel named '+options.missing+'.'
    :options.invalid?'Use 3 to 25 letters, numbers or underscores.'
    :options.limited?'Too many previews. Try again in an hour.':'';
  return screen('Link in bio for streamers',html`${top()}
    <h1>Your stream.<br>One link.</h1>
    ${options.preview?html`<p class="app-lead">Type your Twitch name. See your page in ten seconds.</p>
      ${note?html`<p class="app-note" role="alert">${note}</p>`:''}
      <form class="app-claim" method="get" action="/preview">
        <label class="app-field" for="name"><span>linb.io/</span><input id="name" name="name" required maxlength="25" pattern="[A-Za-z0-9_]{3,25}" autocapitalize="none" autocomplete="off" spellcheck="false" placeholder="yourtwitchname"></label>
        <button>Show my page</button>
      </form>
      <p class="app-fine">No sign-up needed.</p>`
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
