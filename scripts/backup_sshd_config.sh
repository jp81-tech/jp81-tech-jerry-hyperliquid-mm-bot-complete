#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "backup_sshd_config.sh must be run as root" >&2
  exit 1
fi

REPO_DIR="/home/jerry/hyperliquid-mm-bot-complete"
TARGET_REL="infra/server/ssh/sshd_config"
TARGET_PATH="${REPO_DIR}/${TARGET_REL}"
STAMP="$(date -u +"%Y-%m-%dT%H-%M-%SZ")"

mkdir -p "$(dirname "$TARGET_PATH")"

/usr/bin/install -m 600 /etc/ssh/sshd_config "$TARGET_PATH"
/usr/bin/chown jerry:jerry "$TARGET_PATH"

sudo -u jerry /usr/bin/env bash -c "
  set -euo pipefail
  cd '$REPO_DIR'
  git add '$TARGET_REL'
  if git diff --cached --quiet; then
    echo '[ssh-backup] No changes detected; skipping commit'
    exit 0
  fi
  git commit -m 'chore(security): backup sshd_config $STAMP'
  if git remote | grep -q .; then
    if ! git push origin HEAD; then
      echo '[ssh-backup] WARN: git push failed; leaving commit locally'
    fi
  else
    echo '[ssh-backup] INFO: git remote not configured; skipping push'
  fi
"

