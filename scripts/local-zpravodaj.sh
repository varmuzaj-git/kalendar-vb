#!/bin/bash
# Zpravodaj obce se z GitHubu (servery v zahraničí) nedá stáhnout → sbírá se odsud a výsledek se pushne.
set -euo pipefail
cd "$(dirname "$0")/.."
export GIT_SSH_COMMAND="ssh -i $HOME/.config/kalendar-vb/deploy_key -o IdentitiesOnly=yes"
git pull -q --rebase
node scripts/collect.mjs --only=zpravodaj 2>&1 | grep -v 'TT:' || true
git add public/data cache
if git diff --cached --quiet -- cache/raw-events.json; then git reset -q; git checkout -q -- public/data cache 2>/dev/null || true; echo "$(date -Is) beze změny"; exit 0; fi
git -c user.name="Petr (agent)" -c user.email="varmuzaj@gmail.com" commit -qm "Zpravodaj obce (sběr z místního serveru)"
git pull -q --rebase -X theirs && git push -q
echo "$(date -Is) odesláno"
