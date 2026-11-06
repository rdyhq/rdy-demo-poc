# Lobby

Lobby is a creator-home pilot. The current checkout bootstraps the Hono service and CI. It exposes a liveness endpoint at `GET /healthz`.

```sh
nvm use
npm ci
npm test
npm start
```

Read [AGENTS.md](AGENTS.md) for the two-way Rdy workflow. The approved design baseline is `v0.2.0`.

## Staging setup

`render.yaml` describes one Oregon staging service and PostgreSQL 17 database. Render deploys manually from `main`. The database uses a private connection and rejects external IPs. Use synthetic data in staging.

After signing in to Render, connect the GitHub App to this repository only. Open New Blueprint, select this repository and `main`, and review the estimated recurring cost. Apply the Blueprint after spending approval. Turn off Blueprint Auto Sync separately from service auto-deploy. Add R2 and Postmark credentials directly to the staging service when those integration tests are ready.
