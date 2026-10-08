# Lunch List

A small team app for keeping a list of nearby lunch places, marking the ones you've been to, and (optionally) showing today's lunch menu for each place.

Runs fully serverless on Azure:

```
Browser ──► Azure Static Web Apps (Free)
             ├─ /            static frontend (web/)          ← plain HTML/CSS/JS, no build step
             ├─ /api/*       managed Azure Functions (api/)  ← Node 20, v4 programming model
             └─ /.auth/*     built-in Entra ID sign-in + "team" role
                                   │
                                   ▼
                       Azure Storage – Table Storage
                         places     – the list
                         menucache  – today's scraped menus (one row per place per day)
```

**Cost:** Static Web Apps Free tier is €0; Table Storage for a few hundred rows is a few cents per month.

## Features

- Add / edit / delete places (name, address with map link, website, notes)
- "We went" marks a place visited — keeps visit count, first/last visit date, who logged it, a 1–5 rating and a comment. "Unmark" clears it.
- Progress bar, search, filter (All / Not yet / Visited), and **Surprise me** (random place you haven't tried)
- **Today's menu** (optional per place): set a menu page URL and, ideally, a CSS selector. The API fetches the page, extracts the text, and if the page lists the whole week, cuts out just today's section (Finnish, English or Swedish weekday headings). Each menu is fetched at most once per day and cached; **Refresh** forces a new fetch.

## Repository layout

```
api/                     Azure Functions (Static Web Apps managed API)
  src/functions/places.js  places CRUD + visit endpoints
  src/functions/menu.js    today's menu (fetch → extract → daily cache)
  src/lib/                 storage, scraping, validation helpers
  test/                    unit tests (node --test)
web/                     frontend + staticwebapp.config.json (routes, auth, headers)
infra/main.bicep         Static Web App + Storage account + app settings
.github/workflows/       test + deploy on push to main, PR preview environments
```

## API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/places` | List places |
| POST | `/api/places` | Add place `{name, address?, url?, menuUrl?, menuSelector?, menuSliceByDay?, notes?}` |
| PUT | `/api/places/{id}` | Update any of the fields above |
| DELETE | `/api/places/{id}` | Delete place |
| POST | `/api/places/{id}/visit` | Log a visit `{rating?: 1–5, comment?}` |
| DELETE | `/api/places/{id}/visit` | Clear visited mark |
| GET | `/api/places/{id}/menu[?refresh=1]` | Today's menu (cached per day, Europe/Helsinki) |

## Deploy to Azure

Prerequisites: Azure CLI (`az login`), a GitHub repo with this code.

### 1. Create the infrastructure

```bash
RG=rg-lunch-list
az group create -n $RG -l westeurope
az deployment group create -g $RG -f infra/main.bicep -p appName=lunchlist
```

Outputs include the site URL and the Static Web App name (`lunchlist-swa`).

### 2. Connect GitHub Actions

```bash
TOKEN=$(az staticwebapp secrets list -n lunchlist-swa -g $RG --query properties.apiKey -o tsv)
gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --body "$TOKEN"
```

Push to `main` → the workflow runs the tests and deploys `web/` + `api/`. Pull requests get their own preview URL.

(Without GitHub: `npm i -g @azure/static-web-apps-cli && swa deploy --env production --deployment-token "$TOKEN"`.)

### 3. Give your team access

Everything (page and API) requires the custom role **`team`**. On the Free tier you hand that out with invitations:

Azure portal → the Static Web App → **Role management** → **Invite** → provider *Microsoft Entra ID*, the person's email, role `team`, expiry e.g. 168 h. Send them the link; they sign in once and they're in. Signed-in users without the role see a "No access yet" page.

Free tier allows up to 25 invited users. If you'd rather allow *everyone in your Entra tenant* automatically, switch to `swaSku=Standard` (≈ $9/month), register an Entra app limited to your tenant, add a custom `auth` section to `staticwebapp.config.json`, and change `"team"` to `"authenticated"` in the routes.

## Setting up a menu for a place

1. Open the restaurant's lunch page (or its page on a lunch aggregator) in your browser.
2. Right-click the menu → **Inspect**, and find the element wrapping the menu (e.g. `<div class="lunch-menu">`).
3. Edit the place: **Menu page URL** = that page, **CSS selector** = `.lunch-menu` (or `#id`).
4. Keep "Show only today's section" ticked if the page lists the whole week.
5. Click **Menu** on the card. If the text is noisy, tighten the selector; a note under the menu tells you when the selector matched nothing or today's heading wasn't found.

Limitations: menus that are rendered by JavaScript in the browser, images/PDFs, or pages behind a login can't be scraped this way. Weekday headings are recognized by full name (`Maanantai`, `Monday`, `Måndag`, …), not abbreviations like `Ma`.

Menu URLs are user-supplied, so the fetcher only allows http(s), refuses private/link-local addresses (including after redirects), and caps time (8 s) and size (2 MB).

## Local development

```bash
npm i -g azure-functions-core-tools@4 @azure/static-web-apps-cli azurite
azurite-table --inMemoryPersistence &        # local Table Storage
cp api/local.settings.sample.json api/local.settings.json
(cd api && npm install)
swa start                                    # http://localhost:4280
```

The SWA emulator shows a fake login page — enter any name and add **`team`** to the roles field.

Tests: `cd api && npm test`

## Notes

- Managed Functions in Static Web Apps can't use managed identity, so the API reads a storage connection string from the `STORAGE_CONNECTION_STRING` app setting (set by Bicep). Rotate with `az storage account keys renew` and redeploy the Bicep. If you later need managed identity, timers (e.g. pre-fetch menus at 10:00) or private networking, switch to a "bring your own" Function App on the Flex Consumption plan linked to the Static Web App — the function code stays the same.
- "Today" is computed in `TIME_ZONE` (default `Europe/Helsinki`).
