#!/usr/bin/env bash
# Vérification rapide d'un déploiement, sans session ni écriture en base.
# Usage : scripts/smoke.sh https://devis-factures.exemple.workers.dev
set -uo pipefail

BASE="${1:?URL de base attendue, ex. scripts/smoke.sh https://devis-factures.exemple.workers.dev}"
BASE="${BASE%/}"
failures=0

ok() { echo "ok      $1"; }
ko() { echo "ÉCHEC   $1"; failures=$((failures + 1)); }
check() { if [ "$2" = "$3" ]; then ok "$1"; else ko "$1 (attendu : $3, obtenu : $2)"; fi; }
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

# Santé et protection de l'API
check "santé (/api/health)" "$(curl -sS "$BASE/api/health")" '{"ok":true}'
check "API protégée sans session (/api/me → 401)" "$(status "$BASE/api/me")" 401
check "écriture refusée depuis une autre origine (→ 403)" \
  "$(status -X POST -H 'origin: https://exemple.invalid' -H 'content-type: application/json' -d '{}' "$BASE/api/quotes")" 403

# Interface : routes de l'application servies par le repli SPA
for path in /connexion /devis /nimporte/quoi; do
  check "interface servie ($path → 200)" "$(status "$BASE$path")" 200
done
html=$(curl -sS "$BASE/connexion")
if grep -q '<div id="root">' <<<"$html"; then ok "page HTML de l'application"; else ko "page HTML de l'application"; fi

# L'outil de session de développement ne doit pas être publié
if curl -sS "$BASE/scripts/dev-session.mjs" | grep -q 'createHmac'; then
  ko "scripts/dev-session.mjs exposé en production"
else
  ok "scripts/dev-session.mjs non exposé"
fi

# En-têtes de sécurité, sur une page et sur l'API
for path in /connexion /api/me; do
  headers=$(curl -sS -o /dev/null -D - "$BASE$path" | tr -d '\r')
  for name in content-security-policy strict-transport-security x-content-type-options referrer-policy x-frame-options; do
    if grep -qi "^$name:" <<<"$headers"; then ok "en-tête $name ($path)"; else ko "en-tête $name absent ($path)"; fi
  done
done
csp=$(curl -sS -o /dev/null -D - "$BASE/connexion" | tr -d '\r' | grep -i '^content-security-policy:' || true)
if grep -q "unsafe-inline\|unsafe-eval" <<<"$csp"; then ko "CSP sans unsafe-inline ni unsafe-eval"; else ok "CSP sans unsafe-inline ni unsafe-eval"; fi

echo
if [ "$failures" -eq 0 ]; then
  echo "Tout est ok."
else
  echo "$failures vérification(s) en échec."
  exit 1
fi
