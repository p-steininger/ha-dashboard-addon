#!/usr/bin/with-contenv bashio
# shellcheck shell=bash
set -e
export SIDEBAR_DEFAULT="$(bashio::config 'sidebar')"
export INGRESS_ONLY=1
ARGS=(--host 0.0.0.0 --port 8099)
if bashio::config.true 'allow_control'; then
  ARGS+=(--allow-control)
fi
bashio::log.info "Starte Home Dashboard (Sidebar ${SIDEBAR_DEFAULT}, Steuerung $(bashio::config 'allow_control'))"
cd /app
exec python3 server.py "${ARGS[@]}"
