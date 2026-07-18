# Khaao Frontend

React 18 + TypeScript + Vite + Tailwind CSS PWA for the Khaao canteen pre-order
app. See [`STATUS.md`](../STATUS.md) at the repo root for the full picture
(architecture, what's done, what's next) and [`docs/SPEC.md`](../docs/SPEC.md)
for the frozen API contract.

## Run locally

```bash
cp .env.example .env   # fill in VITE_FIREBASE_* from the Firebase console
npm install
npm run dev             # :5173, proxies /api to the backend on :8080
```

## Verify

```bash
npx tsc -b --noEmit
npm run build
```
