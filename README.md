# Fixline: apartment maintenance you can follow

Design thinking project. Problem: apartment residents struggle to get maintenance issues resolved because complaints go through fragmented channels, making it hard to track requests, identify responsibility and get updates.

**Stack:** HTML/CSS/JS frontend (`public/`), Node.js + Express backend (`server.js`), SQLite database (built into Node 22.13+).

**Accounts:** residents register themselves; staff accounts are created by the manager; one manager account is created at first start.

## Run locally
Requires Node.js 22.13 or newer.
```
npm install
copy .env.example .env     (then edit .env and set your own passwords)
npm start
```
Open http://localhost:3000. Do not open the HTML files directly; they need the server.

## Settings
All secrets come from environment variables (see `.env.example`). Nothing secret is stored in the code.

Live site: add your link. Team: add names.
