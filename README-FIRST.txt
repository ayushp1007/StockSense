STOCKSENSE - FINAL HACKATHON PACKAGE
Prepared 26 September 2026
Presenter: Ayush Pandey | Team: X | Institution: X | Contact: X

1. EXTRACT THE ZIP
   Use Windows "Extract All". Do not run the app from inside the ZIP.

2. OPEN THE APP
   Install Node.js 24 with npm if needed.
   Open the stocksense folder and double-click START-STOCKSENSE.cmd.
   The launcher installs dependencies on first use (internet required).
   Keep that command window open and visit http://localhost:5173.
   If Vite prints another port, use the printed address instead.
   Stop the servers with Ctrl+C when finished.

   Manual alternative: open CMD in stocksense (beside package.json), then:
     npm ci
     npm run dev
   Running npm from C:\ will fail because package.json is in stocksense.

3. DEMO ACCOUNTS
   Administrator: admin@stocksense.demo
   Manager:       manager@stocksense.demo
   Warehouse:     staff@stocksense.demo
   Password for all three: Demo2026!
   These accounts belong to local demo mode only.

4. PRESENT THE PITCH
   Open presentation/StockSense-Animated-Pitch.html in a browser.
   It works offline and needs no app server.
   Arrow keys = slides | F = fullscreen | N = notes | P = timed playback
   The main pitch takes five minutes; the last two slides are Q&A backups.
   Slide 5 includes a genuine four-step captured walkthrough, not a live feed.

   For PowerPoint: open presentation/StockSense-Hackathon.pptx and press F5.
   It includes editable slide text/tables, speaker notes and fade transitions.
   For the static PDF: open presentation/StockSense-Hackathon.pdf.
   It contains all 13 slides, including the two Q&A backup slides.
   See presentation/PRESENTER-GUIDE.md for the script and live-demo instructions.

5. WHAT WAS CHECKED
   TypeScript, production build and inventory smoke: passed.
   Security: 27/27 groups. Production: 14/14 scenarios.
   Chromium: 13/13 scenarios. Dependency audit: 0 known vulnerabilities.
   Additional responsive UI checks: 24 pages/dialogs and 4 workflow states.
   Read FINAL-CHECK.md for fixes, evidence and remaining deployment work.

6. DATA AND DEPLOYMENT
   This archive contains source, compiled output, tests and documentation.
   Dependencies, private environment settings and working databases are excluded.
   A new local installation starts with demo data. Your existing workspace was
   not reset during verification. Keep it backed up before upgrading.
   Real AI/email delivery, TLS/proxy, backup restore, monitoring and load testing
   still need deployment validation. This is a single-node SQLite application.

Team, institution, and contact fields still have X placeholders; update them before presenting.
