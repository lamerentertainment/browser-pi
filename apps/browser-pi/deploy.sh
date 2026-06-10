#!/bin/bash
#
# Deployt die browser-pi PWA auf Firebase Hosting (Site: browser-pi-krg).
# Reines statisches Hosting — kein Backend, kein Cloud Run.
#
# Aufruf (aus apps/browser-pi/ ODER von überall — das Skript wechselt selbst
# in sein eigenes Verzeichnis):
#
#   ./deploy.sh
#
set -e

# Immer aus dem Verzeichnis dieses Skripts arbeiten (apps/browser-pi/),
# egal von wo es aufgerufen wird.
cd "$(dirname "$0")"

PROJECT_ID="gen-lang-client-0915148106"
HOSTING_TARGET="browser-pi"   # -> Site browser-pi-krg (siehe .firebaserc)

echo "--- 1. Build (vue-tsc + vite) ---"
npm run build

echo "--- 2. Deploy auf Firebase Hosting ($HOSTING_TARGET) ---"
firebase deploy \
    --only "hosting:${HOSTING_TARGET}" \
    --project "$PROJECT_ID"

echo "--- Deployment erfolgreich abgeschlossen ---"
echo "    -> https://browser-pi-krg.web.app"
