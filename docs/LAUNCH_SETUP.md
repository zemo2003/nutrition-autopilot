# Launch Setup: GitHub, Database, Mobile TestFlight

## 1) Publish to GitHub

GitHub CLI is not installed in this environment, so use standard git remote commands.

```bash
cd /Users/daniel/Desktop/nutrition-autopilot
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
cd /Users/daniel/Desktop/nutrition-autopilot
./scripts/publish-github.sh https://github.com/<YOUR_GITHUB_USERNAME>/nutrition-autopilot.git
```

## 2) Set Up Managed PostgreSQL (Recommended: Neon)

1. Create a Neon project and copy the `postgresql://...` connection string.
2. In `/Users/daniel/Desktop/nutrition-autopilot/.env`, set:

```env
DATABASE_URL="postgresql://<user>:<password>@<host>/<db>?sslmode=require"
REDIS_URL="redis://localhost:6379"
PORT=4000
NEXT_PUBLIC_API_BASE="https://<your-api-domain>"
EXPO_PUBLIC_API_BASE="https://<your-api-domain>"
```

3. Run migrations and seed against managed DB:

```bash
cd /Users/daniel/Desktop/nutrition-autopilot
npm run db:generate
npm run db:migrate
npm run db:seed
```

Helper script:

```bash
cd /Users/daniel/Desktop/nutrition-autopilot
./scripts/bootstrap-db.sh
```

## 3) Deploy API + Web

Any Docker-capable host works (Render/Fly/Railway-style).

- API service start: `npm run dev:api` (or production node process)
- Web service start: `npm run dev:web` (or `next start`)
- Use the same `DATABASE_URL` in API runtime env.

## 4) Mobile App (Expo) -> TestFlight

### One-time setup

```bash
cd /Users/daniel/Desktop/nutrition-autopilot
npm install
npm run dev:mobile
```

Install tools and login:

```bash
npm install -g eas-cli
cd /Users/daniel/Desktop/nutrition-autopilot/apps/mobile
eas login
```

### Required edits before first TestFlight push

File: `/Users/daniel/Desktop/nutrition-autopilot/apps/mobile/app.json`

- Set unique bundle id:
  - `expo.ios.bundleIdentifier`
- Set app name/slug if needed.

File: `/Users/daniel/Desktop/nutrition-autopilot/apps/mobile/eas.json`

- Set `submit.production.ios.ascAppId` from App Store Connect.

### Build and submit

```bash
cd /Users/daniel/Desktop/nutrition-autopilot
npm run mobile:testflight:build
npm run mobile:testflight:submit
```

## 5) Production Readiness Checklist Before TestFlight

1. API domain is public and reachable from iOS app.
2. `EXPO_PUBLIC_API_BASE` points to production API.
3. Managed DB has run latest migrations.
4. SOT upload works in production web app.
5. Verification workflow returns data on mobile `/verification` screen.
