# Launch Setup: GitHub + Neon + Hosted Web/API

## 1) Publish to GitHub

GitHub CLI is not installed in this environment, so use standard git remote commands.

```bash
cd /Users/daniel/Documents/GitHub/nutrition-autopilot
git add .
git commit -m "feat: bootstrap nutrition autopilot platform with web/api/mobile"
git branch -M main
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/nutrition-autopilot.git
git push -u origin main
```

If your repo already exists and remote was added before:

```bash
git remote set-url origin https://github.com/<YOUR_GITHUB_USERNAME>/nutrition-autopilot.git
git push -u origin main
```

Helper script:

```bash
cd /Users/daniel/Documents/GitHub/nutrition-autopilot
./scripts/publish-github.sh https://github.com/<YOUR_GITHUB_USERNAME>/nutrition-autopilot.git
```

## 2) Set Up Managed PostgreSQL (Recommended: Neon)

1. Create a Neon project and copy the `postgresql://...` connection string.
2. In `/Users/daniel/Documents/GitHub/nutrition-autopilot/.env`, set:

```env
DATABASE_URL="postgresql://<user>:<password>@<host>/<db>?sslmode=require"
REDIS_URL="redis://localhost:6379"
PORT=4000
NEXT_PUBLIC_API_BASE="https://<your-api-domain>"
EXPO_PUBLIC_API_BASE="https://<your-api-domain>"
```

3. Run migrations and seed against managed DB:

```bash
cd /Users/daniel/Documents/GitHub/nutrition-autopilot
npm run db:generate
npm run db:migrate
npm run db:seed
```

Helper script:

```bash
cd /Users/daniel/Documents/GitHub/nutrition-autopilot
./scripts/bootstrap-db.sh
```

## 3) Deploy API + Web (Render Blueprint)

This repo includes `render.yaml` with:
- `nutrition-autopilot-api` (Node web service)
- `nutrition-autopilot-web` (Next.js web service)

Steps:
1. Render Dashboard -> **New +** -> **Blueprint**.
2. Connect `https://github.com/zemo2003/nutrition-autopilot`.
3. Render reads `/Users/daniel/Documents/GitHub/nutrition-autopilot/render.yaml`.
4. Set env vars:
   - API service: `DATABASE_URL` = your Neon URL.
   - Web service: `NEXT_PUBLIC_API_BASE` = public API URL (`https://<api-service>.onrender.com`).
5. Deploy.

Use hosted web app from laptop/phone browser:
- `https://<web-service>.onrender.com`
- `https://<web-service>.onrender.com/upload`

## 4) Optional Mobile App (Expo) -> TestFlight

### One-time setup (if needed later)

```bash
cd /Users/daniel/Documents/GitHub/nutrition-autopilot
npm install
npm run dev:mobile
```

Install tools and login:

```bash
npm install -g eas-cli
cd /Users/daniel/Documents/GitHub/nutrition-autopilot/apps/mobile
eas login
```

### Required edits before first TestFlight push

File: `/Users/daniel/Documents/GitHub/nutrition-autopilot/apps/mobile/app.json`

- Set unique bundle id:
  - `expo.ios.bundleIdentifier`
- Set app name/slug if needed.

File: `/Users/daniel/Documents/GitHub/nutrition-autopilot/apps/mobile/eas.json`

- Set `submit.production.ios.ascAppId` from App Store Connect.

### Build and submit

```bash
cd /Users/daniel/Documents/GitHub/nutrition-autopilot
npm run mobile:testflight:build
npm run mobile:testflight:submit
```

## 5) Production Readiness Checklist

1. API domain is public and reachable from iOS app.
2. Web has `NEXT_PUBLIC_API_BASE` set to production API URL.
3. Managed DB has run latest migrations.
4. SOT upload works in production web app.
5. Calendar and printable labels load in hosted web app.
