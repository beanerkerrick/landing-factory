# Landing Factory (SSG) — v1.0

This release provides an end-to-end, self-hosted SSG platform:
- Multi-domain management (bulk add domains)
- Create a site from a template
- Publish → static site rendered to disk
- Caddy serves static sites per host (SSG-first)
- Minimal built-in Admin UI at `/admin`
- Links Manager UI at `/admin/links` (library, assignments, bulk replace + undo)
- Themes UI at `/admin/themes` (theme.json + component presets, assign to sites)
- Design Import UI at `/admin/design-import` (manual import: paste theme.json + component preset)
- Analytics UI at `/admin/analytics` (profiles: head/body_end scripts + assign to sites)
- Autopost UI at `/admin/autopost` (create schedules for blog/news; auto-publish optional)
- Analytics UI at `/admin/analytics` (analytics profiles + assign to sites)
- Autopost UI at `/admin/autopost` (schedules + runs + run now)

Notes:
- Autopost currently uses a lightweight in-process scheduler in the API container. It can be moved to a dedicated worker service later.

## Requirements
- Ubuntu (recommended)
- Docker + Docker Compose (plugin)

## Quick start (local or VPS)

1) Copy env:

```bash
cp .env.example .env
# Edit .env and set a strong ADMIN_TOKEN
```

2) Start the stack:

```bash
docker compose up --build -d
```

3) Check services:

```bash
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3002/health
```

## Built-in Admin UI

Open:

- http://127.0.0.1:3001/admin

Paste your `ADMIN_TOKEN` into the top-right field and click **Save token**.
From there you can:

- bulk import domains
- create a site from a template
- publish (SSG build)

## Links Manager UI (v0.3+)

Open:

- http://127.0.0.1:3001/admin/links

Features:
- create links in the **Link Library**
- assign links to a site+placement (e.g. `HERO_CTA`, `FOOTER`)
- bulk replace URL/text (preview → apply) + undo last bulk operation


> Note: All API endpoints (except `/health`) require header: `X-Admin-Token: <ADMIN_TOKEN>`.

## Admin UI (built-in)
Open:
- http://127.0.0.1:3001/admin

Paste your `ADMIN_TOKEN`, then you can:
- bulk import domains
- create sites
- publish (SSG build)

## Demo flow (API)

### 1) Bulk import domains

```bash
curl -X POST http://127.0.0.1:3001/domains/bulk-import \
  -H "content-type: application/json" \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -d '{
    "domains": ["example.local", "demo.local"],
    "defaults": {"status": "active"}
  }'
```

### 2) Create a site
You need a domain ID. Get it via API:

```bash
curl http://127.0.0.1:3001/domains -H "X-Admin-Token: $ADMIN_TOKEN"
```

Or via psql inside the container:

```bash
docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c "select id, domainName from \"Domain\";"
```

Then call:

```bash
curl -X POST http://127.0.0.1:3001/sites \
  -H "content-type: application/json" \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -d '{
    "domainId": "<DOMAIN_UUID>",
    "templateKey": "tmpl_corp_premium_v1",
    "theme": "My first site",
    "language": "ru"
  }'
```

### 3) Publish (build + render)

```bash
curl -X POST http://127.0.0.1:3001/sites/<SITE_UUID>/publish \
  -H "X-Admin-Token: $ADMIN_TOKEN"
```

### 4) Serve the static site
Caddy serves files from `./data/www/<host>/...`.
To test locally, add to `/etc/hosts`:

```text
127.0.0.1 example.local
```

Then open:
- http://example.local/

## Production notes
- Point your domain A/AAAA to the VPS IP.
- Use real hostnames; Caddy can enable Automatic HTTPS (port 443 must be open).
- Configure DNS automation (Cloudflare/DNSPod) in later phases.

## Project layout
- `apps/api` — API + Prisma migrations
- `apps/renderer` — SSG renderer writing to `/srv/www/<host>`
- `packages/templates` — template passports (`template.json`)
- `data/www` — generated static sites

## Next steps (planned)
- Replace built-in admin UI with a full Next.js admin (same API)
- Add read endpoints and UI for domains/sites
- Add Links Manager, Analytics, Autoposting, AI Router providers
- Add DNS Provider adapters and automated domain setup


## Themes UI (v0.4)

Open:

- http://127.0.0.1:3001/admin/themes

Features:
- create Theme Presets (paste `theme.json`)
- create Component Style Presets (paste `component_style_preset.json`)
- assign theme + component preset to a site (then publish to rebuild)

## Design Import UI (v0.4)

Open:

- http://127.0.0.1:3001/admin/design-import

Features:
- manual design import: paste `theme.json` + `component_style_preset.json`
- creates theme + preset and records a Design Import Job
