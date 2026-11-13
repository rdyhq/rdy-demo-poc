import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.ts';
import { newHome, readHome } from '../src/home-cards.ts';
import { renderPage } from '../src/page.ts';
import { landingPage, reportPage, signInPage } from '../src/screens.ts';

const app=createApp({});
const text=async(path:string)=>{
  const response=await app.request(path);
  assert.equal(response.status,200);
  assert.match(response.headers.get('Content-Type')!,/^text\/html/);
  return response.text();
};
const agree='<p class="app-fine app-agree">By continuing you agree to the <a href="/terms">Terms</a>. The <a href="/privacy">Privacy notice</a> says what linb.io stores.</p>';

test('the privacy notice names the operator, the contact and what linb.io stores',async()=>{
  const page=await text('/privacy');
  assert.match(page,/<title>Privacy notice · LINB<\/title>/);
  assert.match(page,/<h1>Privacy notice<\/h1><p class="app-doc-date">Last changed: 12 November 2026<\/p>/);
  assert.match(page,/linb\.io is run by Rdyhub Inc\./);
  assert.match(page,/<a href="mailto:privacy@linb\.io">privacy@linb\.io<\/a>/);
  // The parts that a streamer and a fan look for.
  for(const heading of ['If you make a page','If you visit a page','Who else handles the data','How long we keep it','Your choices','Children','Changes','Contact']) {
    assert.ok(page.includes('<h2>'+heading+'</h2>'),heading);
  }
  // The statements that the code must keep true.
  assert.match(page,/your Twitch user ID, your Twitch login and the verified email address/);
  assert.match(page,/It lasts seven days at most\./);
  assert.match(page,/We set no cookie in your browser\. We use no analytics and no advertising\./);
  assert.match(page,/We remove the text after 30 days\./);
  assert.match(page,/We remove it after two days\./);
  assert.match(page,/linb\.io is not for a person under 13\./);
  assert.match(page,/You can delete your account at the foot of the account screen\. We then remove your account, your page, your pictures and your sign-in at once/);
  assert.match(page,/You can ask for a copy of your data or for a correction\./);
  assert.match(page,/<a href="\/terms">Terms<\/a>/);
});

test('the terms name the operator, the minimum age, the law and the contact',async()=>{
  const page=await text('/terms');
  assert.match(page,/<title>Terms · LINB<\/title>/);
  assert.match(page,/<h1>Terms<\/h1><p class="app-doc-date">Last changed: 12 November 2026<\/p>/);
  assert.match(page,/an agreement between you and Rdyhub Inc\./);
  assert.match(page,/You must be 13 or older/);
  assert.match(page,/The laws of the State of Delaware, USA, govern these terms\./);
  assert.match(page,/linb\.io is not part of Twitch, and Twitch does not endorse it\./);
  assert.match(page,/take your page down in the editor, or delete your account in the account screen\./);
  assert.match(page,/<a href="mailto:privacy@linb\.io">privacy@linb\.io<\/a>/);
  for(const heading of ['The service','Your account','Your content','What a page must not hold','Reports and removal','Twitch and other services','Changes and the end of the service','No warranty','Liability','Law','Contact']) {
    assert.ok(page.includes('<h2>'+heading+'</h2>'),heading);
  }
  assert.match(page,/<a href="\/privacy">Privacy notice<\/a>/);
});

test('the landing page and the sign-in page link to both pages',()=>{
  const foot='<footer class="app-foot"><a href="/terms">Terms</a><a href="/privacy">Privacy</a></footer>';
  assert.ok(String(landingPage({preview:true})).includes(foot));
  assert.ok(String(landingPage({preview:false})).includes(foot));
  assert.ok(String(signInPage({twitch:true})).includes(foot));
  assert.ok(String(signInPage({operator:true})).includes(foot));
});

test('a streamer who starts a Twitch sign-in sees what they agree to',()=>{
  // On the sign-in page, the line stands under the Twitch button.
  assert.ok(String(signInPage({twitch:true,email:false})).includes('<button class="app-twitch">Continue with Twitch</button></form>'+agree));
  assert.ok(String(signInPage({twitch:true})).includes(agree));
  // A page with no Twitch button has no such line.
  assert.ok(!String(signInPage({})).includes('app-agree'));
  assert.ok(!String(signInPage({operator:true})).includes('app-agree'));
  // On a preview, the line stands under the claim button.
  const id=randomUUID(), home={...readHome(newHome(id),id),displayName:'NovaByte'};
  const preview=String(renderPage(home,{now:Date.now(),asset:()=>'',claim:'novabyte'}));
  assert.ok(preview.includes('<button>Claim linb.io/novabyte</button></form>'
    +'<p class="pg-agree">By claiming you agree to the <a href="/terms">Terms</a>. The <a href="/privacy">Privacy notice</a> says what linb.io stores.</p>'));
  assert.ok(!String(renderPage(home,{now:Date.now(),asset:()=>''})).includes('pg-agree'));
});

test('the report form and the foot of a Home link to the privacy notice',()=>{
  const id=randomUUID();
  assert.ok(String(reportPage(id,'https://linb.io/novabyte',['Other']))
    .includes('<p class="app-fine">Include only the details that the reviewer needs. The <a href="/privacy">Privacy notice</a> says how long linb.io keeps a report.</p>'));
  const home={...readHome(newHome(id),id),displayName:'NovaByte'};
  const page=String(renderPage(home,{now:Date.now(),asset:()=>'',report:'/h/'+id+'/report'}));
  assert.ok(page.includes('<footer class="pg-foot"><a href="/h/'+id+'/report">Report this page</a><a href="/privacy">Privacy</a><a href="/">Made with LINB</a></footer>'));
});
