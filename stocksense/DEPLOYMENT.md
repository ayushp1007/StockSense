# Vercel deployment

The project uses Vite for the browser application and an Express Vercel Function
for `/api/*`. Inventory data and sessions are stored in Turso (hosted SQLite).
Local development continues to use the SQLite file configured by `DB_PATH`.

## Project settings

- Git repository: `ayushp1007/StockSense`, branch `main`
- Root directory: `stocksense`
- Node.js: 24.x
- Build: `npm run build`
- Output: `dist/client`
- Function region: Mumbai (`bom1`), colocated with the database

The checked-in `vercel.json` configures routing and the build output. Keep the
database credentials and JWT secret in Vercel environment variables, never in Git.

## Environment variables

- `APP_ENV=production`
- `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` from the Turso integration
- `JWT_SECRET`: a unique random secret of at least 32 characters
- `TRUST_PROXY=true` behind Vercel's proxy
- `APP_ORIGIN`: optionally pin the public HTTPS origin after choosing a domain

Optional OpenAI and Resend configuration is described in `.env.example`.
Email password recovery requires a configured email provider.

## Initial administrator

For a new, empty database, run the production bootstrap command from a trusted
machine with the database credentials and these variables loaded securely:
`BOOTSTRAP_COMPANY`, `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL`, and
`BOOTSTRAP_ADMIN_PASSWORD` (at least 14 characters). Then run:

```sh
npm run build:server
NODE_ENV=production APP_ENV=production npm run company:bootstrap
```

The bootstrap refuses to overwrite an existing account. The deployed production
workspace starts empty; the public local demo credentials are not enabled.
Create locations, categories, products, and team accounts after signing in.

## Data consistency

Database operations are awaited. Inventory mutations use write transactions;
request-local transaction context keeps every related query on the same stream.
Sequential collection helpers retain ordering inside each transaction. Schema
migrations run under a write transaction only when an upgrade is needed.
Demo seeding is restricted to local databases outside production mode.

The frontend and server compile successfully locally. The existing automated
test suite has not been rerun as part of this deployment migration.
