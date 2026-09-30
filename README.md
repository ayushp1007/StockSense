# StockSense

Inventory management with Administrator, Inventory Manager, and Warehouse Staff workspaces, built with React, TypeScript, Express, and SQLite.

Presented by **Ayush Pandey**.

## Open online

**[Open StockSense](https://stock-sense-red.vercel.app/)**

Hosted on Vercel with a persistent Turso database. Sign in with your private
workspace account. The public demo credentials below are for local development
only. See the [deployment guide](stocksense/DEPLOYMENT.md) for hosting details.

## Run locally

Install Node.js 24, then run these commands from this repository:

```sh
cd stocksense
npm ci
npm run dev
```

Open http://localhost:5173. On Windows, you can also open `stocksense/START-STOCKSENSE.cmd`.

See the [application README](stocksense/README.md) for configuration, demo accounts, workflows, and production setup.

## Presentation

- [PowerPoint deck](presentation/StockSense-Hackathon.pptx)
- [PDF deck](presentation/StockSense-Hackathon.pdf)
- [Offline animated presentation](presentation/StockSense-Animated-Pitch.html) — download and open in a browser
- [Presenter guide](presentation/PRESENTER-GUIDE.md)

## Review notes

The included [verification report](FINAL-CHECK.md) records the earlier local checks and remaining deployment work. External email/AI services, live infrastructure, and backup recovery need deployment verification. The current database design uses a single SQLite node.

The presentation's team, institution, and contact fields are still placeholders.
