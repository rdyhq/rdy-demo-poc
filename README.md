# LINB

LINB gives invited streamers a link in bio they can make their own, with their links up front and room for a next stream or update. Fans can visit without an account. Creators preview privately, save revisions, and explicitly publish. Operators can hold public visibility and independently review the exact state before release.

## Run locally

Use Node from `.nvmrc` and a disposable PostgreSQL database.

```sh
nvm use
npm ci
export DATABASE_URL='postgresql://localhost/lobby_dev'
export LOBBY_DEV_DIR="$PWD/.local/lobby"
export LOBBY_DEMO=1
npm run migrate
npm run manage -- designate-operator operator@example.test
npm start
```

Open [the operator sign-in](http://127.0.0.1:3000/ops/sign-in) and request a link for the designated mailbox. The loopback-only mail fixture writes the message to `.local/lobby/mail`. Open the full link in a browser and confirm it, then use the invite screen to enroll a synthetic creator. Request a separate creator sign-in from `/sign-in`. Use different browser profiles for creator and operator sessions on the same origin. Designate a second operator to exercise independent review. The optional demo link on the landing page displays a fictional creator home.

```sh
LOBBY_TEST_DATABASE_URL='postgresql://localhost/lobby_test' npm test
```

The integration suite creates and drops an isolated schema. Use a disposable database with schema creation permission. CI also builds the Render image and checks `/healthz`.

## Staging handoff

The Render Blueprint describes an Oregon web service and private PostgreSQL 17 database. Keep automatic deploys and Blueprint Auto Sync disabled. Once the exact application commit is approved, set the pre-deploy command to `npm run migrate` in the service settings. The migrations are ordered, checksummed, and transactional. [Render pre-deploy commands](https://render.com/docs/deploys#pre-deploy-command)

- Render provides `DATABASE_URL` and `RENDER_EXTERNAL_URL`. Set `PUBLIC_ORIGIN` only if a different HTTPS origin will serve the app.
- Set `LOBBY_TRUST_PROXY` to the number of proxies between a visitor and the service. The sign-in and report limits count requests for each visitor address. Without this setting, every visitor shares the proxy's address, and 30 sign-in requests in an hour stop sign-in mail for everyone. Confirm the value on staging: when one network reaches its limit, a second network can still request a sign-in link. Leave it unset only when visitors reach the service directly.
- Set `LINB_HOME_READ_ONLY=1` to pause new Home creation, saves, publishing and unpublishing during rollback. Keep a release that can read both Home payload versions once any version 2 draft has been saved.
- Use a verified Postmark sender with `POSTMARK_FROM` and `POSTMARK_TOKEN`. Use a private R2 bucket with `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`. Set `REPORT_CONTACT` to the staffed report mailbox. Enter credentials directly in Render.
- After deployment, check liveness, actual email delivery and confirmation, upload and withdrawal, the public quiet and scheduled states, legacy calendar retirement, and the two-operator hold and release. Use synthetic mailboxes, names, and images.
- Rehearse restoration in an isolated database with outbound mail and public traffic disabled. Run migrations, revoke restored sessions and access proofs with `npm run manage -- revoke-restored-access`, and inspect draft/snapshot JSON versions, current pointers, ownership, first-publication dates, holds, and referenced R2 objects before considering a cutover.
- `npm run manage -- prune-evidence` deletes expired report evidence while retaining its audit history. A reviewed retention extension uses `npm run manage -- retain-evidence CASE_ID DAYS REASON APPROVER`.

## Product testing

Use a disposable PostgreSQL database and apply the migrations before running the app. The Free flow includes a shorter first publish, account-free sharing and reports, opt-in Open Graph metadata, and browser-local schedule time. Operators must have staffed access to the report inbox before admitting real creators. Schedule `npm run manage -- prune-evidence` to remove expired report details.

- **Twitch:** Disabled by default. For an approved synthetic deployment, configure `LINB_TWITCH=1`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` and a random 32-byte hex `TWITCH_SESSION_KEY`. Register only the exact canonical `/auth/twitch/callback` URL. Keep mailbox admission and recovery active. Review callback log redaction and provider disconnect behavior during the hosted test. [Twitch OIDC](https://dev.twitch.tv/docs/authentication/getting-tokens-oidc/)
- **Stripe:** Disabled by default. For synthetic accounts only, configure `LINB_STRIPE_TEST=1`, `STRIPE_TEST_SECRET`, `STRIPE_TEST_PRICE` and `STRIPE_TEST_WEBHOOK_SECRET`. Only test keys are accepted. Register `/webhooks/stripe` in the Stripe sandbox, use the hosted customer portal, and monitor failed or unmatched events. The app ignores return redirects as entitlement evidence. [Stripe webhook verification](https://docs.stripe.com/webhooks/signature)
- **Pro:** For separately approved synthetic review, enable `LINB_PRO_SYNTHETIC=1` alongside test billing. `LINB_MULTIPAGE_SYNTHETIC=1` additionally opens the two optional pages. Public Free content remains the fallback. Test cancellation, expiry, recovery, disclosure copy, and a real device’s opt-in YouTube playback before an external cohort. No live paid offer is exposed.
- **Discovery:** The loopback-only demo at `/demo/leaderboard` shows ranked and low-volume fixture states. The public app does not collect leaderboard views or publish rankings. Real collection requires a separate decision.

## Custom domains

Keep the staging origin until a cutover has been approved. Confirm the DNS zone owner, existing records, and the Render service’s custom domain allowance. Add only the approved domains and use the exact DNS targets and verification steps shown in Render. Verify valid HTTPS and certificate renewal ownership before switching the application origin. [Render custom domains](https://render.com/docs/custom-domains)

At cutover set `PUBLIC_ORIGIN=https://linb.io` and `PUBLIC_REDIRECT_ORIGINS` to the comma-separated HTTPS origins verified for forwarding, including `https://l1nb.io` and the old service origin if it should continue serving shared links. Include `www` only if configured and verified. In this mode, recognized alternate hosts forward public GET and HEAD requests to the matching canonical path, after checking home availability; all query parameters are dropped and the redirect explicitly clears the fragment. Private or encoded paths and writes on those hosts return 404. Never serve a parallel authenticated app on another host.

Plan for sign-in again on the new host. Existing cookies are scoped to their original hostname, and old proof links point there. After the alias gate is active, revoke sessions and outstanding proofs with the existing access reset (`npm run manage -- revoke-restored-access`) before reissuing proofs from the new origin; exercise actual mail and the exact `https://linb.io/verify` entry point. Keep provider callbacks disabled until their exact canonical URLs are reviewed. Check representative shared homes, images, and retired calendar links on both domains, including held and unpublished homes. Verify that public pages carry only the canonical URL and do not expose private preview metadata. If any check fails, restore the prior origin with an explicit redirect allowlist and keep revoked sessions and proofs revoked. If reverting the deployment, take alternate hosts out of service before removing the host gate.

Read [AGENTS.md](AGENTS.md) for the Rdy workflow. The approved design baseline is `v0.2.0`.

### Proposed Twitch activity and creator alias pilot

Enable the pilot only after the RDY decision and exact deployment approval. Configure Twitch sign-in using the existing Twitch settings. Set `LINB_TWITCH_ACTIVITY=1` to enable public activity using the same app credentials. The server uses app tokens to read Helix, without adding user scopes.

Invite the creator through the existing admission flow. After they verify their mailbox and link Twitch, upload the artwork they approve and save their Home. Once the creator has reviewed and published it, configure `LINB_HOME_ALIASES`. For example, `{"nexzou":{"homeId":"<existing Home UUID>","twitchSubject":"<verified Twitch subject>"}}`. Keep each approved alias bound to its original Home. The existing UUID routes stay available. An alias returns 404 after a hold, unpublish or unlink.

Verify the real Twitch integration before the creator shares the link. Check the live title, viewer count and watch link. Check the offline fallback and optional clip. On a provider error, the Home must keep its stream link and hide unverified activity. Keep demo fixtures disabled.
