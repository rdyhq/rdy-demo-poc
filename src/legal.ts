import { html } from 'hono/html';
import { documentPage } from './screens.ts';

// The privacy notice and the terms of linb.io (RDY D-TT81D). Each sentence says what the code does.
// Change the date with each change of the text.
const operator='Rdyhub Inc.', contact='privacy@linb.io', changed='12 November 2026';
const address=html`<a href="mailto:${contact}">${contact}</a>`;

export function privacyPage() {
  return documentPage('Privacy notice',changed,html`
    <p>linb.io is run by ${operator} This notice says what linb.io stores about you, and why.</p>
    <h2>If you make a page</h2>
    <ul><li>You sign in with Twitch. Twitch gives us your Twitch user ID, your Twitch login and the verified email address of your Twitch account. We store them to know that the page is yours. We use the email address only to write to you about your page or your account.</li>
      <li>We store what you put on your page: your name, your bio, your links, your schedule, your updates, your look and your pictures. The first draft comes from the public data of your Twitch channel.</li>
      <li>Your published page is public. Your draft is private until you publish it.</li>
      <li>While you are signed in, your browser holds one sign-in cookie. It lasts seven days at most. The sign-in at Twitch uses a second cookie for some minutes. We also keep the sign-in token from Twitch, in encrypted form, to check that the sign-in is still valid.</li></ul>
    <h2>If you visit a page</h2>
    <ul><li>You need no account. We set no cookie in your browser. We use no analytics and no advertising.</li>
      <li>To limit abuse, we count the requests from each network address when you ask for the preview of a channel or send a report. We store the address only in coded form. We remove it after two days.</li>
      <li>If you report a page, we store the reason and the text that you write. We remove the text after 30 days.</li>
      <li>A page can show pictures from Twitch: an avatar, a clip, a frame of a live stream. Your browser gets them from linb.io, not from Twitch. A link on a page leads to another service, and that service has its own rules.</li></ul>
    <h2>Who else handles the data</h2>
    <ul><li>Render hosts linb.io and its database in the United States.</li>
      <li>Cloudflare carries the traffic between your browser and linb.io.</li>
      <li>Render and Cloudflare keep technical logs, with network addresses, under their own rules.</li>
      <li>Twitch signs you in and gives us the data of a channel. The privacy notice of Twitch says what Twitch does.</li></ul>
    <p>We sell no data. We give it to nobody else, unless a law requires it.</p>
    <h2>How long we keep it</h2>
    <p>We keep your account and your page until you ask us to delete them. “Take my page down” in the editor removes your page from public view at once and keeps your draft. A backup of the database can hold a copy for a short time after a deletion.</p>
    <h2>Your choices</h2>
    <ul><li>You can ask for a copy of your data, for a correction or for the deletion of your account. Write to ${address} from the email address of your Twitch account. We answer within 30 days.</li>
      <li>You can end the connection to linb.io in the settings of your Twitch account, under Connections.</li>
      <li>The law of the place where you live can give you more rights. You can also complain to the data protection authority of that place.</li></ul>
    <h2>Children</h2>
    <p>linb.io is not for a person under 13. If you think that a child made a page, write to us.</p>
    <h2>Changes</h2>
    <p>We change this notice when linb.io changes. The date at the top shows the last change.</p>
    <h2>Contact</h2>
    <p>${operator}, ${address}</p>
    <p class="app-doc-more">See also the <a href="/terms">Terms</a>.</p>`);
}

export function termsPage() {
  return documentPage('Terms',changed,html`
    <p>These terms are an agreement between you and ${operator} about linb.io. When you make a page, you agree to them.</p>
    <h2>The service</h2>
    <p>linb.io gives a streamer one page with links, a schedule and a live status. It is free. If a paid plan comes, you see its price and its terms before you pay.</p>
    <h2>Your account</h2>
    <ul><li>You sign in with Twitch. You must be 13 or older, and old enough to have a Twitch account in the place where you live.</li>
      <li>Make a page only for a Twitch channel that is yours.</li>
      <li>The address of your page comes from your Twitch login.</li></ul>
    <h2>Your content</h2>
    <p>What you put on your page stays yours. You allow us to store it, to show it on your page and to show it in link previews. Put on your page only what you have the right to use.</p>
    <h2>What a page must not hold</h2>
    <ul><li>Content that breaks a law.</li>
      <li>Threats, harassment or hate against a person or a group.</li>
      <li>Private information about a person who did not agree.</li>
      <li>A false identity: a page that pretends to be another person or another brand.</li>
      <li>Links to malware, to a scam or to phishing.</li></ul>
    <p>Do not try to break linb.io, to overload it or to get into the account of another person.</p>
    <h2>Reports and removal</h2>
    <p>Anyone can report a page. We can hide a page or close an account that goes against these terms. If you think that we were wrong, write to us.</p>
    <h2>Twitch and other services</h2>
    <p>linb.io reads the public data of your Twitch channel. linb.io is not part of Twitch, and Twitch does not endorse it. A link on a page leads to another service with its own terms.</p>
    <h2>Changes and the end of the service</h2>
    <ul><li>You can stop at any time: take your page down in the editor, and ask us to delete your account.</li>
      <li>We can change linb.io or stop it.</li>
      <li>We can change these terms. The date at the top shows the last change. If you keep your page after a change, you agree to the new terms.</li></ul>
    <h2>No warranty</h2>
    <p>linb.io comes as it is. We do not promise that it always works or that it has no errors.</p>
    <h2>Liability</h2>
    <p>As far as the law allows, ${operator} is not liable for lost profit, lost data or indirect damage from your use of linb.io. As far as the law allows, its total liability to you is limited to USD 100.</p>
    <h2>Law</h2>
    <p>The laws of the State of Delaware, USA, govern these terms.</p>
    <h2>Contact</h2>
    <p>${operator}, ${address}</p>
    <p class="app-doc-more">See also the <a href="/privacy">Privacy notice</a>.</p>`);
}
