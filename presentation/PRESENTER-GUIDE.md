# StockSense — presenter guide

Presenter: Ayush Pandey  
Team: X  
Institution: X  
Contact: X

**Format:** 11 main slides, 5 minutes total, followed by 2 optional backup slides. The main pitch includes a 90-second product demonstration.

**Core message:** StockSense connects warehouse work to manager decisions through a controlled, traceable inventory workflow.

## 1. Open and control the presentation

### Offline animated presentation

1. Extract the presentation files from the ZIP.
2. Double-click `StockSense-Animated-Pitch.html` to open it in a browser. Its images and presentation code are embedded; the deck needs no server or internet connection.
3. Click the slide background, then use the controls below. If keyboard shortcuts do not respond, close any open notes/image dialog and click the background again.

| Control | Action |
| --- | --- |
| Right / left arrows | Next / previous slide |
| Page Down / Page Up | Next / previous slide |
| Space | Next slide |
| Home | First slide |
| End | Last backup slide |
| F | Enter or leave fullscreen; use the Fullscreen button or browser F11 if needed |
| N | Open the current slide's notes |
| P | Start timed autoplay from slide 1; press again to stop |
| Esc | Close an open dialog or leave fullscreen |

**Autoplay:** the 11 main slides total 300 seconds. Playback stops on the closing slide and does not automatically enter the appendices. Opening notes or expanding a captured image stops autoplay. Starting it again restarts from slide 1; use manual arrows to continue from another slide. Autoplay advances slides and captured frames; it does not provide a spoken narration.

**Slide 5 captured walkthrough:** use the small `‹` and `›` buttons under the image to cycle through four genuine captured screens. Use **Expand** for a larger image and **Close** or Esc to return. During autoplay, the walkthrough cycles automatically. These are captured frames, not a live connection to the app.

### PowerPoint

1. Open `StockSense-Hackathon.pptx` in Microsoft PowerPoint.
2. Press **F5** to present from slide 1, or **Shift+F5** from the current slide.
3. Use arrows to advance. The deck includes fade transitions; use manual navigation to control your delivery.
4. Use **Presenter View** to read the embedded notes when a second screen is available.
5. The four-frame interactive walkthrough is in the HTML version. In PowerPoint, switch to the live app for the 90-second demo or open the HTML walkthrough and identify it as captured.

## 2. Five-minute running order

The included `StockSense-Hackathon.pdf` is a static export of all 13 PowerPoint slides, including the two backup slides. Use it for sharing or printing. Animations and interactive walkthrough controls are available in the HTML presentation.

| Slide | Exact deck title | Pitch time | Duration |
| --- | --- | --- | --- |
| 1 | StockSense | 0:00–0:15 | 15s |
| 2 | The warehouse handoff | 0:15–0:35 | 20s |
| 3 | One workspace for every role | 0:35–1:00 | 25s |
| 4 | A controlled posting sequence | 1:00–1:20 | 20s |
| 5 | One handoff, end to end | 1:20–2:50 | 90s |
| 6 | The stock record has safeguards | 2:50–3:15 | 25s |
| 7 | Answers grounded in inventory | 3:15–3:40 | 25s |
| 8 | Built and checked | 3:40–4:00 | 20s |
| 9 | A pilot with measurable outcomes | 4:00–4:20 | 20s |
| 10 | The next milestones | 4:20–4:45 | 25s |
| 11 | Every posted movement is traceable | 4:45–5:00 | 15s |
| 12 | Appendix: architecture | Questions only | Untimed |
| 13 | Appendix: judge questions | Questions only | Untimed |

## 3. Speaking script aligned with the deck

### Slide 1 — StockSense

“I’m Ayush Pandey from team X. StockSense connects warehouse work, manager decisions, and stock records in one workspace. Our goal is simple: every stock change has a clear owner and a traceable record.”

The cover is conceptual brand artwork, not a photograph of a customer warehouse.

### Slide 2 — The warehouse handoff

“Imagine a receipt planned for ten units, while the warehouse reports eight. Who records the difference? Who approves it? Which quantity should change inventory? StockSense gives those steps clear owners and keeps their results connected.”

The ten/eight example illustrates the problem; it is not a measured customer incident. The captured demonstration later uses a separate 24 kg receipt.

### Slide 3 — One workspace for every role

“Administrators manage access and warehouse assignments. Inventory managers plan operations, review exceptions, and post movements. Warehouse staff work from assigned tasks and report what happened. All three use the same API and database, with role, organization, and warehouse permissions checked by the server.”

### Slide 4 — A controlled posting sequence

“Drafts capture intent. Ready deliveries and transfers reserve available stock. Staff report actual quantities. A manager reviews and posts them. The final step updates balances and the ledger together. Let’s show that handoff working.”

Reservations in this sequence apply to outgoing deliveries and transfers; the receipt demonstrated on slide 5 does not reserve outgoing stock.

### Slide 5 — One handoff, end to end

For the captured walkthrough, introduce it explicitly:

“This captured walkthrough comes from an isolated demo database. Receipt RCV-2513 records 24 kilograms received into Main warehouse. The local balance starts at 46 kilograms. Staff submit the 24 kilograms for review, and the balance remains 46. The manager inspects that same submission and confirms posting. The receipt then appears in the ledger, and the warehouse balance becomes 70 kilograms.”

Pause on each frame and explain the handoff. The central sentence is: **“A staff submission does not change stock; manager validation does.”**

For a live demonstration, use the separate 90-second checklist below and narrate the actual reference, quantity, and balances shown by that database. The captured values are not a promise about the user's current database.

### Slide 6 — The stock record has safeguards

“A repeated validation request with the same key and payload reuses its result instead of posting again. Transfers update both locations in one transaction. Counts carry a ledger revision, so intervening movement invalidates a stale count. And a count cannot reduce stock below quantities already reserved.”

### Slide 7 — Answers grounded in inventory

“Replenishment combines available stock, thresholds, lead time, and recent posted deliveries. With limited history, the interface says so. This demo uses the labeled inventory rules. An optional OpenAI integration can explain inventory evidence; it cannot post stock or change settings.”

### Slide 8 — Built and checked

“The interface uses React and TypeScript, with Express and SQLite behind it. The final local run passed 27 security regression groups, 14 production scenarios, and 13 Chromium scenarios. Build, type checking, and workflow checks also passed. The dependency audit reported zero known advisories at that check.”

If asked, clarify that these are automated results for the scenarios checked, not an independent penetration test, an exhaustive accessibility assessment, or production deployment certification.

### Slide 9 — A pilot with measurable outcomes

“Our proposed first users are small warehouse teams. We would establish a baseline and then measure reconciliation time, exception turnaround, and movement traceability in a limited pilot. These are proposed validation metrics; we are not claiming customer adoption or savings that have not been measured.”

### Slide 10 — The next milestones

“Our proposed model is a workspace subscription, tiered by warehouses and active users, with optional onboarding. A pilot would validate willingness to pay. Next priorities are barcode workflows, reporting, and deployment operations. Larger deployments need database and infrastructure work beyond this single-node foundation.”

### Slide 11 — Every posted movement is traceable

“StockSense makes the warehouse-to-manager handoff visible and keeps posted movements traceable. The workflow is built. Our next step is validating its value with a pilot partner. I’m Ayush Pandey from team X. Thank you.”

### Backup slide 12 — Appendix: architecture

Use this for technical questions. React calls the same-origin API. Express checks authorization, warehouse scope, input validation, and transaction rules. SQLite stores balances, operations, ledger records, audit activity, and hashed session records. Optional OpenAI and Resend calls stay on the server. The current deployment uses one application node and one SQLite database.

### Backup slide 13 — Appendix: judge questions

Use the answers in section 6. Keep the focus on the controlled handoff, verified behavior, optional AI, and a realistic pilot plan.

## 4. Ninety-second live demo checklist

### Prepare before presenting

- Use an isolated demo database so rehearsal changes do not affect operational data.
- Prepare one ready receipt with one product and a staff member assigned to its destination warehouse. Record the operation reference, quantity, and starting location balance.
- Use separate browser profiles or separate browsers for manager and staff. Ordinary tabs at the same origin share login cookies and do not preserve independent role sessions.
- Pre-open the relevant staff task and manager workspace. After the staff submission, reopen or refresh the manager operation detail to load the new result.
- Keep slide 5's captured walkthrough available as a fallback. If used, say “captured walkthrough.”
- Rehearse with manual slide navigation. Stop autoplay before switching to a live app, so the deck does not advance while you demonstrate.

| Demo time | Action | What to point out |
| --- | --- | --- |
| 0–12s | Manager: show the product/location starting balance and prepared ready receipt. | “This is the starting stock and planned receipt.” |
| 12–35s | Staff: open **My tasks**, open the same reference, enter the actual quantity and any relevant exception, then click **Submit for review**. | “The worker reports what physically arrived in their authorized warehouse.” |
| 35–45s | Staff: show **Awaiting manager review** and the message that stock has not changed. | “Submission records a result; it does not post inventory.” |
| 45–70s | Manager: reopen or refresh the operation detail, inspect the quantities and notes, click **Validate movement**, then **Confirm and post**. | “The manager reviews the result and approves the quantity to post.” |
| 70–83s | Manager: open **Movement history**, locate the reference, and show the updated location balance. | “The approved movement has a shared, traceable ledger record.” |
| 83–90s | Return to the deck. | “That connects assigned work to an approved stock change.” |

The receipt RCV-2513, 24 kg quantity, and 46 → 46 → 70 kg balances shown in the deck were captured from an isolated database. Do not assume that reference or those balances exist in another installation, or attempt to recreate them by changing real inventory. For a different live database, use its actual prepared values. A partial receipt leaves its unfulfilled remainder open; explain that if your live example is partial.

## 5. Captured walkthrough: four frames

| Frame | State | Explanation |
| --- | --- | --- |
| 1 | Staff opens assigned receipt RCV-2513 | Starting Main warehouse balance: 46 kg. |
| 2 | Staff submits 24 kg | Submission awaits manager review; stock remains 46 kg. |
| 3 | Manager reviews the same submission | The manager checks the 24 kg result before posting. |
| 4 | Approved receipt appears in the ledger | The approved receipt adds 24 kg; the local balance is 70 kg. |

Use slide 5's small previous/next walkthrough buttons to move between these frames. **Expand** opens a larger version. The frames document a completed controlled demo; they do not update from the running app.

## 6. Eight likely judge questions

### 1. How is this different from an ordinary inventory dashboard?

Our focus is the controlled handoff: staff report physical work, a manager reviews it, and validation posts a traceable movement. Reservations, warehouse permissions, idempotency, and count revisions support that workflow. We have not established competitive uniqueness through market research.

### 2. What stops a retry from changing stock twice?

Validation uses a request key bound to the operation and quantities. Repeating the same key and payload returns the stored result; a conflicting payload is rejected. Posting and the validation result are stored in the same database transaction. This describes the implemented retry behavior, not every possible external integration failure.

### 3. Can warehouse staff see or edit everything?

The server checks role, organization, and warehouse scope. Staff submission is restricted to assigned work, and staff cannot validate stock movements. Administrators manage assignments and account access; managers review and post stock changes.

### 4. What happens if stock moves during a physical count?

Counts include a revision derived from the ledger state. Intervening movement invalidates a stale count, even if the balance later returns to the same quantity. The worker must reopen and recount. A count also cannot lower on-hand stock below active reservations.

### 5. Is the AI real, and what happens without it?

This demo uses clearly labeled deterministic inventory rules. An optional server-side OpenAI Responses integration can explain inventory facts when configured. The rules path remains available without provider configuration or when the provider is unavailable. Neither path can post stock or change settings.

### 6. Is it secure and ready for a live business?

It is a production-oriented foundation with server authorization, tracked HttpOnly sessions, origin checks, password hashing, rate limits, guarded startup, and automated checks. The current run passed 27 security regression groups, 14 production scenarios, and 13 Chromium scenarios, with zero known dependency advisories reported. Live deployment still needs TLS/proxy configuration, backup and restore validation, monitoring, provider setup, and operational review. Automated checks are not an independent penetration test or a security guarantee.

### 7. How would it earn revenue?

The proposal is a workspace subscription tiered by locations and active users, with optional onboarding. The initial audience hypothesis is small warehouse teams needing clearer operational control. Pricing, willingness to pay, and acquisition costs remain to be validated; no revenue or adoption is claimed.

### 8. How will you prove impact and scale?

Establish a baseline for reconciliation time, exception turnaround, and traceability, then run a limited pilot with agreed acceptance targets. Compare the results before making savings claims. Larger deployment work includes backup/restore operations, monitoring, pagination, richer reports, barcode workflows, and database/infrastructure changes when scale requires them. SQLite currently supports a single-node deployment; high availability is not configured.

## 7. Evidence and remaining scope

- **Verified local checks:** type checking, production build, inventory smoke checks, 27 security regression groups, 14 production scenarios, and 13 Chromium browser scenarios.
- **Dependency audit:** zero known advisories reported at the final check. This does not rule out unknown vulnerabilities or operational misconfiguration.
- **Browser coverage:** Chromium at the tested desktop/mobile widths, including automated accessibility checks. This is not full cross-browser or assistive-technology coverage.
- **Providers:** live AI and reset-email delivery require configuration and real deployment verification. The presented demo uses local stock rules.
- **Deployment:** SQLite on one node; TLS/reverse proxy, backups and restore drills, monitoring, and production provider verification remain rollout responsibilities.
- **Product boundaries:** direct transfers, limited large-catalogue pagination/reporting, and no implemented barcode capture, transit stages, valuation, or full ERP capabilities.

Feature claims come from the app source and README. The figures on the demonstration slide come from the captured isolated receipt workflow. Pilot metrics and the subscription model are proposals. The deck contains no verified customer traction, savings, market-size, or revenue claims.

## 8. Final rehearsal

1. Open the extracted HTML and PowerPoint once on the presentation computer.
2. Rehearse the 11 main slides in five minutes, including screen-switching time.
3. Choose live demonstration or captured walkthrough before starting.
4. Presenter is Ayush Pandey. Keep team, institution, and contact details as **X** until supplied.
5. Keep the two appendix slides for questions. End the main pitch on slide 11.

The presentation gives a clear, evidence-based case for the project. Judging outcomes depend on the event criteria and delivery; no score or award is guaranteed.
