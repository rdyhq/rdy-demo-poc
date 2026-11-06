# Lobby

Lobby gives invited streamers a public home for their identity, links, next session, and updates. Fans can visit without an account. Creators preview privately, save revisions, and explicitly publish. Operators can hold public visibility and independently review the exact state before release.

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
- Use a verified Postmark sender with `POSTMARK_FROM` and `POSTMARK_TOKEN`. Use a private R2 bucket with `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`. Set `REPORT_CONTACT` to the staffed report mailbox. Enter credentials directly in Render.
- After deployment, check liveness, actual email delivery and confirmation, upload and withdrawal, the public quiet and scheduled states, calendar export, and the two-operator hold and release. Use synthetic mailboxes, names, and images.
- Rehearse restoration in an isolated database with outbound mail and public traffic disabled. Run migrations, revoke restored sessions and access proofs with `npm run manage -- revoke-restored-access`, and inspect draft/snapshot JSON versions, current pointers, ownership, first-publication dates, holds, and referenced R2 objects before considering a cutover.
- `npm run manage -- prune-evidence` deletes expired report evidence while retaining its audit history. A reviewed retention extension uses `npm run manage -- retain-evidence CASE_ID DAYS REASON APPROVER`.

Read [AGENTS.md](AGENTS.md) for the Rdy workflow. The approved design baseline is `v0.2.0`.
