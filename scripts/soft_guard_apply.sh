#!/usr/bin/env bash
set -e
touch runtime/soft_guard.log
echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") soft-guard heartbeat" >> runtime/soft_guard.log
