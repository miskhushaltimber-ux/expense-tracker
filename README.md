# Expense Tracker

A private expense and vehicle-expense tracker for a small business. React
frontend, Express backend, **Google Sheets as the database** — so the owner can
open the raw data in a spreadsheet at any time without asking anyone.

## What's in here

- `backend/` — Express API (auth, expenses, vehicles, imports, file uploads, email)
- `frontend/` — React + Vite + Tailwind dashboard
- `scripts/seed-test-data.js` — fills a fresh account with realistic test data

## Features

**Expense sheet**

- Add, edit and delete entries; every row scoped to the logged-in account
- Filter bar: date range, master, expense, with suggestions drawn from data
  already entered — and Enter walks from field to field, so a full entry can be
  made without touching the mouse
- Multi-select masters, so several ledger heads can be compared at once
- Import from a spreadsheet, with a preview step that flags likely duplicates
- Bill/invoice photo or PDF attached to any entry
- Export to CSV, or email the whole sheet as an .xlsx attachment
- Reminders and suggestions surfaced on the sheet itself

**Vehicle sheet**

- One row per vehicle, with document expiry dates and reminders before they lapse
- Fuel tracking by litres *and* odometer reading, giving both cost per litre and
  km per litre
- Flags a fill priced more than 15% above that vehicle's own average, and a leg
  running more than 20% below its own average mileage — the two signatures of an
  inflated bill or fuel going missing
- Vehicle expenses entered on the main sheet are detected and tagged, so the same
  spend never gets counted twice

**Dashboard**

- Category donut, monthly trend, top-masters bar — all honouring the filter bar
- Click a master to open a drawer breaking that master down by its own expenses
- Colour follows the entity, not its rank, so filtering never repaints the chart
- Light and dark themes, each with its own contrast-checked palette

## Running it locally

### Backend

```bash
cd backend
cp .env.example .env      # then fill it in — the file explains each variable
npm install
npm run dev               # http://localhost:3000
```

`.env.example` walks through the one-time setup for the Google Sheets service
account, Cloudinary (permanent storage for uploaded bills) and email.

### Frontend

```bash
cd frontend
npm install
npm run dev               # http://localhost:5173
```

Set `VITE_API_BASE_URL` in `frontend/.env` to the backend's `/api` URL.

## Deployment

Frontend on Vercel, backend on Render, database in Google Sheets, uploaded files
in Cloudinary. Two things to know about the free tiers:

- **Render blocks outbound SMTP ports (25/465/587).** Gmail SMTP cannot connect
  from the live server at all — it hangs. Email goes out over HTTPS via Brevo
  instead; set `BREVO_API_KEY`. SMTP still works locally and is kept as a fallback.
- **Render's disk is wiped on every redeploy and spin-down.** Uploaded bills must
  go to Cloudinary or they will eventually vanish.

## Naming

The product name lives in exactly two files:

- `frontend/src/constants/brand.js`
- `backend/constants/brand.js`

It is deliberately generic — nothing on screen, in an email subject, or in an
exported filename identifies whose business this is. Change those two files to
rename the whole app.
