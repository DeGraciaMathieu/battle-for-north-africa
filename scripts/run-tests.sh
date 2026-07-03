#!/usr/bin/env bash
# Hook Stop : bloque la fin de tâche si la suite de tests échoue.
# Reçoit le payload du hook sur stdin ; gère la ré-entrance (stop_hook_active)
# pour éviter une boucle infinie.

input=$(cat)

# Si le hook s'est déjà déclenché (relance après blocage), ne pas reboucler.
if printf '%s' "$input" | grep -Eq '"stop_hook_active" *: *true'; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

log=$(mktemp)
if ! npm test >"$log" 2>&1; then
  echo "npm test échoue — corrige les tests avant de terminer la tâche :" >&2
  tail -20 "$log" >&2
  rm -f "$log"
  exit 2   # code 2 : bloque le Stop et renvoie stderr au modèle
fi

rm -f "$log"
exit 0
