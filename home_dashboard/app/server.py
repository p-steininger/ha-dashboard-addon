#!/usr/bin/env python3
"""Vulpo-style Home Assistant dashboard – local proxy server.

The HA long-lived token is read from the HA_TOKEN env var and only ever used
server-side. The browser talks to this server only (REST + /ws), never to HA.

Control (service calls) is DISABLED by default. Start with --allow-control to
enable the whitelisted service proxy.
"""
import argparse, asyncio, json, logging, os, re, time
from pathlib import Path
import aiohttp
from aiohttp import web

# Standalone: HA_URL + HA_TOKEN (long-lived token).
# HA add-on: SUPERVISOR_TOKEN is injected by the Supervisor (homeassistant_api: true);
# REST goes to http://supervisor/core/api/..., WebSocket to ws://supervisor/core/websocket.
SUPERVISED = bool(os.environ.get("SUPERVISOR_TOKEN")) and not os.environ.get("HA_TOKEN")
if SUPERVISED:
    BASE = "http://supervisor/core"
    WS_URL = "ws://supervisor/core/websocket"
    TOKEN = os.environ["SUPERVISOR_TOKEN"]
else:
    BASE = os.environ.get("HA_URL", "https://home.steininger.studio").rstrip("/")
    WS_URL = BASE.replace("http", "ws", 1) + "/api/websocket"
    TOKEN = os.environ.get("HA_TOKEN", "")
INGRESS_PATH_RE = re.compile(r"^/api/hassio_ingress/[A-Za-z0-9_\-]+$")
INGRESS_ONLY = os.environ.get("INGRESS_ONLY") == "1"   # add-on: only accept the Supervisor's ingress proxy
INGRESS_PEER = "172.30.32.2"
SB_DEFAULT = os.environ.get("SIDEBAR_DEFAULT", "b") if os.environ.get("SIDEBAR_DEFAULT", "b") in ("a", "b", "c") else "b"
ROOT = Path(__file__).parent
STATIC = ROOT / "static"
log = logging.getLogger("vulpo")

# Domains/services the browser may call when --allow-control is set
ALLOWED_SERVICES = {
    "light": {"turn_on", "turn_off", "toggle"},
    "switch": {"turn_on", "turn_off", "toggle"},
    "lock": {"lock", "unlock"},
    "scene": {"turn_on"},
    "button": {"press"},
    "media_player": {"media_play_pause", "media_play", "media_pause", "turn_on", "turn_off", "volume_set"},
    "vacuum": {"start", "return_to_base", "pause"},
    "lawn_mower": {"start_mowing", "dock", "pause"},
    "climate": {"set_temperature", "set_hvac_mode"},
    "water_heater": {"set_temperature", "set_operation_mode"},
}
STRIP_ATTRS = {"access_token", "entity_picture"}  # never forward camera tokens


def clean_state(s):
    if not s:
        return s
    a = s.get("attributes", {})
    if any(k in a for k in STRIP_ATTRS):
        s = dict(s, attributes={k: v for k, v in a.items() if k not in STRIP_ATTRS})
    s.pop("context", None)
    return s


class HA:
    def __init__(self, app):
        self.app = app
        self.session = None
        self.clients = set()
        self.states = {}
        self.registry = {}
        self.dashboards = {}
        self.connected = False

    def hdr(self):
        return {"Authorization": f"Bearer {TOKEN}"}

    async def start(self):
        self.session = aiohttp.ClientSession()
        asyncio.create_task(self.ws_loop())

    async def ws_loop(self):
        while True:
            try:
                async with self.session.ws_connect(WS_URL,
                                                   max_msg_size=0, heartbeat=30) as ws:
                    await ws.receive_json()
                    await ws.send_json({"type": "auth", "access_token": TOKEN})
                    if (await ws.receive_json()).get("type") != "auth_ok":
                        log.error("HA auth failed"); await asyncio.sleep(30); continue
                    n = 0
                    pending = {}

                    async def call(**msg):
                        nonlocal n
                        n += 1; msg["id"] = n
                        fut = asyncio.get_event_loop().create_future(); pending[n] = fut
                        await ws.send_json(msg)
                        return await fut

                    async def reader():
                        async for m in ws:
                            if m.type != aiohttp.WSMsgType.TEXT: break
                            d = json.loads(m.data)
                            if d.get("type") == "event":
                                ev = d["event"]
                                if ev.get("event_type") == "state_changed":
                                    ns = clean_state(ev["data"].get("new_state"))
                                    eid = ev["data"]["entity_id"]
                                    if ns: self.states[eid] = ns
                                    else: self.states.pop(eid, None)
                                    await self.broadcast({"t": "state", "id": eid, "s": ns})
                            elif d.get("id") in pending:
                                pending.pop(d["id"]).set_result(d)
                    rt = asyncio.create_task(reader())
                    st = await call(type="get_states")
                    self.states = {s["entity_id"]: clean_state(s) for s in st["result"]}
                    for key, t in [("areas", "config/area_registry/list"), ("floors", "config/floor_registry/list"),
                                   ("devices", "config/device_registry/list"), ("entities", "config/entity_registry/list"),
                                   ("config", "get_config")]:
                        self.registry[key] = (await call(type=t)).get("result")
                    dl = (await call(type="lovelace/dashboards/list")).get("result") or []
                    self.dashboards = {"_list": dl}
                    for up in [None] + [x["url_path"] for x in dl]:
                        msg = {"type": "lovelace/config"}
                        if up: msg["url_path"] = up
                        r = await call(**msg)
                        self.dashboards[up or "lovelace"] = r.get("result") if r.get("success") else {"_auto": True}
                    await call(type="subscribe_events", event_type="state_changed")
                    self.connected = True
                    log.info("HA connected: %d states", len(self.states))
                    await self.broadcast({"t": "resync"})
                    await rt
            except Exception as e:
                log.warning("HA ws error: %s", e)
            self.connected = False
            await asyncio.sleep(5)

    async def broadcast(self, msg):
        dead = []
        for c in self.clients:
            try: await c.send_json(msg)
            except Exception: dead.append(c)
        for c in dead: self.clients.discard(c)


def slim_registry(reg):
    ents = [{k: e.get(k) for k in ("entity_id", "area_id", "device_id", "name", "icon", "hidden_by",
                                     "disabled_by", "entity_category", "platform", "original_name")}
            for e in reg.get("entities") or []]
    devs = [{k: d.get(k) for k in ("id", "area_id", "name", "name_by_user", "model", "manufacturer")}
            for d in reg.get("devices") or []]
    cfg = reg.get("config") or {}
    return {"areas": reg.get("areas"), "floors": reg.get("floors"), "devices": devs, "entities": ents,
            "config": {k: cfg.get(k) for k in ("location_name", "language", "time_zone", "version", "currency")}}


async def bootstrap(req):
    ha = req.app["ha"]
    for _ in range(100):
        if ha.connected: break
        await asyncio.sleep(0.1)
    return web.json_response({"states": list(ha.states.values()), "registry": slim_registry(ha.registry),
                              "dashboards": ha.dashboards, "control": req.app["allow_control"],
                              "connected": ha.connected})


async def history(req):
    ha = req.app["ha"]
    eid = req.query.get("entity_id", "")
    if not eid or eid not in ha.states:
        raise web.HTTPBadRequest(text="unknown entity")
    hours = min(int(req.query.get("hours", "24")), 168)
    start = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(time.time() - hours * 3600))
    url = f"{BASE}/api/history/period/{start}"
    async with ha.session.get(url, headers=ha.hdr(), params={"filter_entity_id": eid, "minimal_response": "",
                                                            "no_attributes": ""}) as r:
        data = await r.json()
    pts = []
    for row in (data[0] if data else []):
        try: pts.append([row.get("last_changed") or row.get("lu"), float(row["state"])])
        except (ValueError, KeyError, TypeError): pass
    return web.json_response(pts)


async def camera(req):
    ha = req.app["ha"]
    eid = req.match_info["eid"]
    if not eid.startswith("camera.") or eid not in ha.states:
        raise web.HTTPNotFound()
    async with ha.session.get(f"{BASE}/api/camera_proxy/{eid}", headers=ha.hdr()) as r:
        if r.status != 200: raise web.HTTPNotFound()
        body = await r.read()
        return web.Response(body=body, content_type=r.headers.get("Content-Type", "image/jpeg"),
                            headers={"Cache-Control": "no-store"})


async def service(req):
    if not req.app["allow_control"]:
        return web.json_response({"ok": False, "error": "Steuerung deaktiviert (Server ohne --allow-control gestartet)"}, status=403)
    domain, svc = req.match_info["domain"], req.match_info["service"]
    if svc not in ALLOWED_SERVICES.get(domain, ()):
        return web.json_response({"ok": False, "error": "nicht erlaubt"}, status=403)
    body = await req.json()
    eid = body.get("entity_id", "")
    if not isinstance(eid, str) or not eid.startswith(domain + "."):
        return web.json_response({"ok": False, "error": "entity_id passt nicht"}, status=400)
    ha = req.app["ha"]
    async with ha.session.post(f"{BASE}/api/services/{domain}/{svc}", headers=ha.hdr(), json=body) as r:
        return web.json_response({"ok": r.status < 300}, status=200 if r.status < 300 else 502)


async def ws_client(req):
    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(req)
    ha = req.app["ha"]; ha.clients.add(ws)
    try:
        async for _ in ws: pass
    finally:
        ha.clients.discard(ws)
    return ws


def ingress_base(req):
    p = req.headers.get("X-Ingress-Path", "").rstrip("/")
    return p if INGRESS_PATH_RE.match(p) else ""


async def index(req):
    base = ingress_base(req)
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    html = html.replace('"/static/', f'"{base}/static/')
    html = html.replace("<head>", f'<head>\n<script>window.BASE = {json.dumps(base)}; window.SB_DEFAULT = {json.dumps(SB_DEFAULT)};</script>', 1)
    return web.Response(text=html, content_type="text/html", headers={"Cache-Control": "no-cache"})


@web.middleware
async def peer_guard(req, handler):
    if INGRESS_ONLY and req.remote != INGRESS_PEER:
        return web.Response(status=403, text="Nur über Home Assistant Ingress erreichbar")
    return await handler(req)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1"); ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--allow-control", action="store_true")
    a = ap.parse_args()
    if not TOKEN: raise SystemExit("HA_TOKEN (or SUPERVISOR_TOKEN) env var missing")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    app = web.Application(middlewares=[peer_guard])
    app["allow_control"] = a.allow_control
    app["ha"] = HA(app)
    app.on_startup.append(lambda app: app["ha"].start())
    app.router.add_get("/", index)
    app.router.add_get("/api/bootstrap", bootstrap)
    app.router.add_get("/api/history", history)
    app.router.add_get("/api/camera/{eid}", camera)
    app.router.add_post("/api/service/{domain}/{service}", service)
    app.router.add_get("/ws", ws_client)
    app.router.add_static("/static/", STATIC)
    log.info("Mode: %s, control %s", "Supervisor/Ingress" if SUPERVISED else "standalone", "ON" if a.allow_control else "OFF")
    web.run_app(app, host=a.host, port=a.port, access_log=None)


if __name__ == "__main__":
    main()
