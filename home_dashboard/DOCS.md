# Home Dashboard

Vulpo-Stil-Dashboard (dunkles Glas-Design) für Home Assistant, als Ingress-Panel „Dashboard“ in der Seitenleiste.

- Läuft komplett über die Supervisor-API (`homeassistant_api: true`) – **kein Long-Lived-Token nötig**.
- Nur über HA-Ingress erreichbar (HA-Login, auch in der Companion-App).
- Live-Updates über die HA-WebSocket-API.
- Optionen: `allow_control` (Standard an), `sidebar` (a/b/c, Standard b).
