/* Vulpo-style Home Assistant dashboard – client. Talks only to the local proxy server. */
'use strict';
const S = {};               // entity_id -> state
let REG = null, DASH = null, CONTROL = false, CONNECTED = false;
let VIEW = (location.hash || '#home').slice(1);
const B = window.BASE || '';   // HA Ingress base path ('' when standalone)
const TZ = 'Europe/Vienna';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- icons ---------- */
function icon(name, cls = 'i') {
  const p = (window.MDI || {})[String(name || '').replace(/^mdi:/, '')] || (window.MDI || {})['help-circle-outline'];
  return `<svg class="${cls}" viewBox="0 0 24 24"><path d="${p || ''}"/></svg>`;
}
const ic = (name, color = 'off') => `<div class="ic ${color}">${icon(name)}</div>`;

/* ---------- formatting ---------- */
const nf = (v, d) => Number(v).toLocaleString('de-AT', d == null ? {maximumFractionDigits: 2} : {minimumFractionDigits: d, maximumFractionDigits: d});
const UNIT = {'EUR': '€', 'EUR/kWh': '€/kWh', 'EUR/h': '€/h', 'trophies': ''};
const unit = u => (u in UNIT ? UNIT[u] : (u || ''));
const isNum = v => v !== '' && v != null && !isNaN(Number(v));
const UNAV = s => !s || s.state === 'unavailable';
const DE = {
  on: 'An', off: 'Aus', unavailable: 'Nicht verfügbar', unknown: '–', idle: 'Inaktiv', paused: 'Pausiert', playing: 'Wiedergabe',
  standby: 'Standby', docked: 'Angedockt', cleaning: 'Reinigt', returning: 'Kehrt zurück', mowing: 'Mäht', error: 'Fehler',
  locked: 'Verriegelt', unlocked: 'Entriegelt', locking: 'Verriegelt …', unlocking: 'Entriegelt …', jammed: 'Blockiert', open: 'Offen',
  heat: 'Heizen', cool: 'Kühlen', heat_cool: 'Auto', auto: 'Auto', dry: 'Entfeuchten', fan_only: 'Lüften',
  heat_pump: 'Wärmepumpe', performance: 'Leistung', eco: 'Eco', electric: 'Elektrisch',
  home: 'Zuhause', not_home: 'Unterwegs', above_horizon: 'Tag', below_horizon: 'Nacht',
  disconnected: 'Nicht verbunden', connected: 'Verbunden', charging: 'Lädt', awaiting_start: 'Wartet', completed: 'Fertig', ready_to_charge: 'Bereit',
  weatherDependent: 'Witterungsgeführt', leavingWaterTemperature: 'Vorlauftemperatur', fixed: 'Fest', reheatSchedule: 'Zeitplan + Nachheizen',
  scheduled: 'Zeitplan', reheatOnly: 'Nur Nachheizen', 'User defined': 'Benutzerdefiniert', True: 'Ja', False: 'Nein',
  rainy: 'Regen', cloudy: 'Bewölkt', partlycloudy: 'Teils bewölkt', sunny: 'Sonnig', 'clear-night': 'Klar', fog: 'Nebel', pouring: 'Starkregen',
  snowy: 'Schnee', 'snowy-rainy': 'Schneeregen', windy: 'Windig', lightning: 'Gewitter', 'lightning-rainy': 'Gewitter', hail: 'Hagel', exceptional: 'Unwetter',
};
const tr = v => DE[v] ?? v;
function fmtState(s, opts = {}) {
  if (!s) return '–';
  const st = s.state, a = s.attributes || {}, u = unit(a.unit_of_measurement);
  if (st === 'unavailable' || st === 'unknown') return tr(st);
  if (isNum(st) && s.entity_id.split('.')[0] !== 'todo') {
    let d = opts.decimals;
    if (d == null) {
      const n = Math.abs(Number(st));
      d = a.device_class === 'monetary' || u === '€' ? 2 : (u === 'kWh' ? (n >= 100 ? 0 : n >= 10 ? 1 : 2) : (u === 'W' ? (n >= 100 ? 0 : 1) : (Number.isInteger(Number(st)) ? 0 : 1)));
      if (u === '€/kWh') d = 4;
    }
    return nf(st, d) + (u ? (opts.html ? `<small>${esc(u)}</small>` : ' ' + u) : '');
  }
  if (a.device_class === 'timestamp' || /^\d{4}-\d\d-\d\dT/.test(st)) return rel(st);
  const m = /^(.+) in (\d+) days?$/.exec(st);              // waste_collection "Gelber Sack in 1 days"
  if (m) return `${m[1]} ${m[2] === '0' ? 'heute' : m[2] === '1' ? 'morgen' : 'in ' + m[2] + ' Tagen'}`;
  return esc(tr(st)) + (u ? ' ' + u : '');
}
function rel(t) {
  const d = new Date(t), s = (Date.now() - d) / 1000;
  if (isNaN(s)) return t;
  const f = s < 0 ? 'in ' : 'vor ', x = Math.abs(s);
  if (x < 60) return 'gerade eben';
  if (x < 3600) return f + Math.round(x / 60) + ' Min.';
  if (x < 86400) return f + Math.round(x / 3600) + ' Std.';
  const days = Math.round(x / 86400);
  return f + days + (days === 1 ? ' Tag' : (s < 0 ? ' Tagen' : ' Tagen'));
}
const hm = t => new Date(t).toLocaleTimeString('de-AT', {hour: '2-digit', minute: '2-digit', timeZone: TZ});
const mmss = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

/* ---------- registry helpers ---------- */
let ENT = {}, DEV = {}, AREA = {}, FLOOR = {};
function indexRegistry() {
  ENT = Object.fromEntries(REG.entities.map(e => [e.entity_id, e]));
  DEV = Object.fromEntries(REG.devices.map(d => [d.id, d]));
  AREA = Object.fromEntries(REG.areas.map(a => [a.area_id, a]));
  FLOOR = Object.fromEntries((REG.floors || []).map(f => [f.floor_id, f]));
}
const dom = eid => eid.split('.')[0];
const areaOf = eid => { const e = ENT[eid]; return e ? (e.area_id || DEV[e.device_id]?.area_id || null) : null; };
const devName = d => d ? (d.name_by_user || d.name || '') : '';
const fname = eid => S[eid]?.attributes?.friendly_name || eid;
function shortName(eid) {           // name within its device ("Leistung")
  const e = ENT[eid]; if (!e) return fname(eid);
  return e.name || e.original_name || devName(DEV[e.device_id]) || fname(eid);
}
function tileName(eid, areaName) {  // name for a standalone tile, with area prefix stripped
  let n = ENT[eid]?.name || fname(eid);
  if (areaName && n.toLowerCase().startsWith(areaName.toLowerCase() + ' ')) {
    const r = n.slice(areaName.length + 1);
    if (r.length >= 3 && /^\p{L}/u.test(r)) n = r[0].toUpperCase() + r.slice(1);
  }
  return n;
}
const HIDE_DOMAINS = new Set(['automation', 'script', 'notify', 'tts', 'stt', 'conversation', 'zone', 'sun', 'event', 'remote', 'image',
  'input_number', 'input_datetime', 'input_text', 'input_select', 'input_boolean', 'device_tracker', 'update', 'persistent_notification', 'assist_satellite', 'wake_word', 'ai_task']);
function visible(eid) {
  const e = ENT[eid];
  if (HIDE_DOMAINS.has(dom(eid))) return false;
  if (e && (e.hidden_by || e.disabled_by || e.entity_category)) return false;
  if (/^sensor\.vulpo_np_/.test(eid)) return false;          // Vulpo app internal tokens
  return true;
}

/* ---------- icon / color choice ---------- */
const KW = [[/wasch/i, 'mdi:washing-machine'], [/trockner/i, 'mdi:tumble-dryer'], [/kühlschrank|kuhlschrank/i, 'mdi:fridge-outline'], [/spülmaschine/i, 'mdi:dishwasher'],
  [/büro|buro/i, 'mdi:desk'], [/roborock/i, 'mdi:robot-vacuum'], [/pool/i, 'mdi:pool'], [/easee|charger|wallbox|lade/i, 'mdi:ev-station'], [/homepod/i, 'mdi:speaker'],
  [/apple tv/i, 'mdi:apple'], [/playstation|ps5/i, 'mdi:sony-playstation'], [/tv/i, 'mdi:television'], [/müll|abholung/i, 'mdi:trash-can-outline'], [/p1 meter/i, 'mdi:meter-electric-outline'],
  [/altherma|daikin/i, 'mdi:heat-pump-outline'], [/tank|warmwasser/i, 'mdi:water-boiler'], [/mopp/i, 'mdi:water-outline'], [/staub/i, 'mdi:delete-empty-outline'], [/backup/i, 'mdi:cloud-upload-outline']];
const DC = {temperature: 'mdi:thermometer', power: 'mdi:flash', energy: 'mdi:lightning-bolt', monetary: 'mdi:currency-eur', battery: 'mdi:battery', illuminance: 'mdi:brightness-5',
  humidity: 'mdi:water-percent', timestamp: 'mdi:clock-outline', occupancy: 'mdi:motion-sensor', motion: 'mdi:motion-sensor', distance: 'mdi:map-marker-distance', duration: 'mdi:timer-outline'};
function iconFor(eid, s = S[eid]) {
  const a = s?.attributes || {}, d = dom(eid), st = s?.state, n = fname(eid);
  if (ENT[eid]?.icon) return ENT[eid].icon;
  if (d === 'light') return st === 'on' ? 'mdi:lightbulb-on' : 'mdi:lightbulb';
  if (d === 'lock') return st === 'locked' ? 'mdi:lock' : 'mdi:lock-open-variant';
  if (d === 'vacuum') return 'mdi:robot-vacuum';
  if (d === 'lawn_mower') return 'mdi:robot-mower';
  if (d === 'water_heater') return 'mdi:water-boiler';
  if (d === 'climate') return 'mdi:heat-pump-outline';
  if (d === 'camera') return 'mdi:cctv';
  if (d === 'scene') return 'mdi:palette-outline';
  if (d === 'button') return 'mdi:gesture-tap-button';
  if (d === 'todo') return 'mdi:clipboard-list-outline';
  if (d === 'person') return 'mdi:account';
  if (d === 'select') return 'mdi:format-list-bulleted';
  if (a.icon) return a.icon;
  for (const [re, i] of KW) if (re.test(n)) return i;
  if (d === 'media_player') return 'mdi:speaker';
  if (d === 'switch') return 'mdi:power-socket-de';
  if (d === 'calendar') return 'mdi:calendar';
  if (DC[a.device_class]) return DC[a.device_class];
  if (/^(°C|°F)$/.test(a.unit_of_measurement)) return 'mdi:thermometer';
  if (/W$/.test(a.unit_of_measurement || '')) return 'mdi:flash';
  if (d === 'binary_sensor') return 'mdi:checkbox-blank-circle-outline';
  return 'mdi:information-outline';
}
function colorFor(eid, s = S[eid]) {
  const d = dom(eid), st = s?.state, a = s?.attributes || {};
  if (UNAV(s)) return 'ghost';
  if (d === 'light') return st === 'on' ? 'yellow' : 'off';
  if (d === 'switch') return st === 'on' ? (/easee|charger/i.test(fname(eid)) ? 'green' : 'teal') : 'off';
  if (d === 'lock') return st === 'locked' ? 'green' : 'orange';
  if (d === 'media_player') return ['playing', 'paused', 'on'].includes(st) ? (st === 'playing' ? 'purple' : 'indigo') : 'off';
  if (d === 'vacuum') return st === 'cleaning' ? 'teal' : 'mint';
  if (d === 'lawn_mower') return st === 'mowing' ? 'green' : 'green';
  if (d === 'climate' || d === 'water_heater') return st === 'off' ? 'off' : 'orange';
  if (d === 'calendar') return 'yellow';
  if (d === 'binary_sensor') return st === 'on' ? 'blue' : 'off';
  if (a.device_class === 'temperature') return 'orange';
  if (a.device_class === 'power' || a.device_class === 'energy') return 'teal';
  if (a.device_class === 'monetary') return 'green';
  return 'off';
}

/* ---------- area model (mirrors HA's auto-generated "Übersicht") ---------- */
function deviceSiblings(eid) {
  const e = ENT[eid]; if (!e?.device_id) return [];
  return Object.keys(S).filter(x => x !== eid && ENT[x]?.device_id === e.device_id);
}
function buildArea(areaId, ids) {
  const used = new Set(), areaName = AREA[areaId]?.name || '';
  const it = {lights: [], tiles: [], wide: [], climate: [], cams: [], scenes: [], lists: [], matrix: null, areaName};
  const byDom = d => ids.filter(x => dom(x) === d && !used.has(x));
  const take = x => used.add(x);
  // switches: attach power / energy sensors of the same device
  for (const eid of ids.filter(x => ['switch', 'vacuum', 'lawn_mower', 'lock'].includes(dom(x)))) {
    const sib = deviceSiblings(eid).filter(x => ids.includes(x) && dom(x) === 'sensor');
    const extra = {};
    for (const x of sib) {
      const a = S[x].attributes || {};
      if (/W$/.test(a.unit_of_measurement || '') && a.device_class === 'power' || /Leistung$/.test(shortName(x)) && /W$/.test(a.unit_of_measurement || '')) { extra.power = x; take(x); }
      else if (/Energieeinspeisung/.test(shortName(x))) take(x);
      else if (a.device_class === 'energy' && /^Energie$/.test(shortName(x))) { extra.energy = x; take(x); }
      else if (a.device_class === 'battery' || /Akku/.test(shortName(x))) { extra.battery = x; take(x); }
    }
    it[eid] = extra;
  }
  for (const eid of byDom('light')) { it.lights.push(eid); take(eid); }
  for (const eid of byDom('lock')) { it.tiles.push(eid); take(eid); }
  for (const d of ['climate', 'water_heater']) for (const eid of byDom(d)) {
    const temps = deviceSiblings(eid).filter(x => ids.includes(x) && !used.has(x) && /°C/.test(S[x].attributes.unit_of_measurement || ''));
    it.climate.push({eid, temps}); take(eid); temps.forEach(take);
  }
  for (const eid of byDom('media_player')) { (UNAV(S[eid]) || S[eid].state === 'off' ? it.tiles : it.wide).push(eid); take(eid); }
  for (const d of ['vacuum', 'lawn_mower', 'switch', 'calendar']) for (const eid of byDom(d)) { it.tiles.push(eid); take(eid); }
  for (const eid of byDom('camera')) { it.cams.push(eid); take(eid); }
  for (const d of ['scene', 'button']) for (const eid of byDom(d)) { it.scenes.push(eid); take(eid); }
  for (const eid of byDom('select')) { take(eid); if (!/szene/i.test(fname(eid))) it.tiles.push(eid); }   // Hue scene selects duplicate the scene buttons
  // consumption matrix (Täglicher/Wöchentlicher/… Stromverbrauch …)
  const MX = /(Täglicher|Wöchentlicher|Monatlicher|Jährlicher) Stromverbrauch (\S+)/;
  const mx = ids.filter(x => dom(x) === 'sensor' && !used.has(x) && MX.test(shortName(x)));
  if (mx.length >= 4) {
    const rows = {};
    for (const x of mx) {
      const [, per, kind] = MX.exec(shortName(x));
      const dn = devName(DEV[ENT[x]?.device_id]);
      const label = /hotwater|warmwasser/i.test(dn) ? 'Warmwasser' : kind;
      (rows[label] ??= {})[per] = x; take(x);
    }
    it.matrix = rows;
  }
  // remaining sensors / binary sensors / misc -> list cards per device
  const groups = new Map();
  for (const eid of ids.filter(x => !used.has(x))) {
    const dv = ENT[eid]?.device_id || '_';
    if (!groups.has(dv)) groups.set(dv, []);
    groups.get(dv).push(eid); take(eid);
  }
  for (const [dv, l] of groups) it.lists.push({title: dv === '_' ? '' : devName(DEV[dv]), ids: l});
  return it;
}

/* ---------- card renderers ---------- */
function battHtml(pct) {
  if (!isNum(pct)) return '';
  const p = Number(pct);
  return `<div class="batt ${p <= 15 ? 'low' : ''}"><span class="b"><i style="width:${Math.max(0, Math.round(p / 100 * 16))}px"></i></span>${nf(p, 0)} %</div>`;
}
function lightTile(eid, areaName, wide) {
  const s = S[eid], a = s.attributes, on = s.state === 'on', un = UNAV(s);
  const pct = on && a.brightness != null ? Math.round(a.brightness / 2.55) : null;
  let col = '';
  if (on && a.rgb_color && a.color_mode && !/color_temp|brightness|onoff/.test(a.color_mode)) col = `style="background:rgb(${a.rgb_color.join(',')})"`;
  const sub = un ? 'Nicht verfügbar' : on ? ('An' + (a.color_temp_kelvin ? (a.color_temp_kelvin < 3300 ? ' · Warmweiß' : a.color_temp_kelvin > 5000 ? ' · Kaltweiß' : ' · Neutralweiß') : '')) : 'Aus';
  return `<div class="tile ${on ? 'on' : ''} ${un ? 'unavail' : ''} ${wide ? 'wide' : ''}" data-act="toggle" data-eid="${eid}">
    <div class="top"><div class="ic ${colorFor(eid)}" ${col}>${icon(iconFor(eid))}</div>${un ? '' : `<div class="sw ${on ? 'on' : ''}"></div>`}</div>
    <div>${wide && pct != null ? `<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:8px"><div style="min-width:0"><div class="nm">${esc(tileName(eid, areaName))}</div><div class="st">${sub}</div></div><div class="big">${pct}<small>%</small></div></div>` :
      `<div class="nm">${esc(tileName(eid, areaName))}</div><div class="st">${sub}${pct != null ? ' · ' + pct + ' %' : ''}</div>`}
    ${pct != null ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</div></div>`;
}
function genericTile(eid, it) {
  const s = S[eid], a = s.attributes || {}, d = dom(eid), un = UNAV(s), x = it[eid] || {}, areaName = it.areaName;
  let right = '', sub = fmtState(s), cls = '', act = '';
  if (d === 'switch') {
    act = 'toggle';
    if (!un) right = `<div class="sw ${s.state === 'on' ? 'on' : ''}"></div>`;
    const p = S[x.power];
    if (!un && p && !UNAV(p) && isNum(p.state)) sub += ' · ' + fmtState(p);
  } else if (d === 'lock') {
    act = 'lock';
    if (s.state === 'unlocked') { cls = 'attn'; sub += a.changed_by ? ' · ' + esc(a.changed_by) : ''; }
    right = `<span class="badge ${s.state === 'locked' ? 'green' : 'orange'}">${s.state === 'locked' ? 'Zu' : 'Offen'}</span>`;
  } else if (d === 'vacuum' || d === 'lawn_mower') {
    const b = a.battery_level ?? a.battery ?? (S[x.battery] ? S[x.battery].state : null);
    right = battHtml(b);
    if (a.fan_speed && s.state !== 'docked') sub += ' · ' + esc(a.fan_speed);
    if (isNum(b) && Number(b) <= 10 && !un) { cls = 'alert'; sub += ' · Akku leer'; }
    act = 'more';
  } else if (d === 'media_player') {
    act = 'more';
  } else if (d === 'calendar') {
    sub = a.message ? `${esc(a.message)} · ${calWhen(a.start_time)}` : 'Keine Termine';
    if (s.state === 'on') cls = 'attn';
  } else if (d === 'select') {
    sub = esc(tr(s.state));
  }
  if (un) cls = 'unavail';
  return `<div class="tile ${cls} ${act ? '' : 'static'}" ${act ? `data-act="${act}"` : ''} data-eid="${eid}">
    <div class="top">${ic(iconFor(eid), colorFor(eid))}${right}</div>
    <div><div class="nm">${esc(tileName(eid, areaName))}</div><div class="st">${sub}</div></div></div>`;
}
function calWhen(t) {
  if (!t) return '';
  const d = new Date(t.replace(' ', 'T')), now = new Date();
  const day = x => new Date(x.toLocaleDateString('en-CA', {timeZone: TZ})).getTime();
  const diff = Math.round((day(d) - day(now)) / 86400000);
  return diff === 0 ? 'heute' : diff === 1 ? 'morgen' : diff === 2 ? 'übermorgen' : d.toLocaleDateString('de-AT', {weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ});
}
function mediaTile(eid, areaName) {
  const s = S[eid], a = s.attributes, st = s.state;
  const title = a.media_title || a.app_name || a.source || tr(st);
  const subParts = [tr(st)]; if (a.media_artist) subParts.push(a.media_artist); else if (a.media_series_title) subParts.push(a.media_series_title); if (a.app_name && a.app_name !== title) subParts.push(a.app_name);
  let prog = '';
  if (a.media_duration && a.media_position != null) {
    let pos = a.media_position;
    if (st === 'playing' && a.media_position_updated_at) pos += (Date.now() - new Date(a.media_position_updated_at)) / 1000;
    const pc = Math.min(100, pos / a.media_duration * 100);
    prog = `<div class="prog"><i style="width:${pc}%"></i></div><div class="times"><span>${mmss(pos)}</span><span>−${mmss(a.media_duration - pos)}</span></div>`;
  }
  const vol = a.volume_level != null ? `<span class="badge dim">${Math.round(a.volume_level * 100)} %</span>` : '';
  return `<div class="tile media wide" data-eid="${eid}">
    <div class="row">${ic(iconFor(eid), colorFor(eid))}
      <div class="meta"><div class="nm">${esc(tileName(eid, areaName))}</div><div class="st">${esc(title)}${subParts.length ? ' · ' + esc(subParts.join(' · ')) : ''}</div></div>
      ${vol}<div class="rbtn" data-act="playpause" data-eid="${eid}">${icon(st === 'playing' ? 'mdi:pause' : 'mdi:play')}</div></div>
    ${prog}</div>`;
}
function climateCard(c, areaName) {
  const {eid, temps} = c, s = S[eid], a = s.attributes, d = dom(eid), un = UNAV(s);
  const min = a.min_temp ?? 7, max = a.max_temp ?? 35, tgt = a.temperature, cur = a.current_temperature;
  const isOffset = min < 0;
  const frac = tgt == null ? 0 : Math.max(0, Math.min(1, (tgt - min) / (max - min)));
  const L = 235.6, gid = 'g' + eid.replace(/\W/g, '');
  const tv = tgt == null ? '–' : (isOffset && tgt > 0 ? '+' : '') + nf(tgt, Number.isInteger(tgt) ? 0 : 1);
  const modes = d === 'water_heater' ? (a.operation_list || []) : (a.hvac_modes || []);
  const curMode = d === 'water_heater' ? (a.operation_mode || s.state) : s.state;
  const title = d === 'water_heater' ? 'Warmwasser' : (isOffset ? 'Heizung · Vorlauf-Offset' : tileName(eid, areaName));
  const subtitle = devName(DEV[ENT[eid]?.device_id]).replace(/(ClimateControl|DomesticHotWaterTank)/, '').trim() || fname(eid);
  const kv = [];
  if (cur != null) kv.push([d === 'water_heater' ? 'Ist' : (isOffset ? 'Vorlauf ist' : 'Ist'), nf(cur, Number.isInteger(cur) ? 0 : 1) + ' °C']);
  for (const t of temps) kv.push([shortName(t).replace(/-Temperatur$|temperatur$/i, m => m.startsWith('-') ? '' : 'temp.'), fmtState(S[t])]);
  return `<div class="tile climate ${un ? 'unavail' : ''}" data-eid="${eid}">
    <div class="head">${ic(iconFor(eid), colorFor(eid))}<div style="flex:1;min-width:0"><div class="nm">${esc(title)}</div><div class="st">${esc(subtitle)} · ${esc(tr(curMode))}</div></div>
      <span class="badge ${s.state === 'off' ? 'dim' : 'green'}">${s.state === 'off' ? 'Aus' : 'Aktiv'}</span></div>
    <div class="main">
      <div class="dial"><svg viewBox="0 0 120 120"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFD60A"/><stop offset="1" stop-color="#FF6B0A"/></linearGradient></defs>
        <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${L} 314.2"/>
        <circle cx="60" cy="60" r="50" fill="none" stroke="url(#${gid})" stroke-width="10" stroke-linecap="round" stroke-dasharray="${Math.max(0.1, frac * L)} 314.2"/></svg>
        <div class="val"><span>${isOffset ? 'Offset' : 'Ziel'}</span><b>${tv}<sup>${isOffset ? 'K' : '°'}</sup></b></div></div>
      <div class="cinfo">${kv.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${v}</b></div>`).join('')}
        <div class="steps"><div data-act="temp" data-dir="-1" data-eid="${eid}">−</div><div data-act="temp" data-dir="1" data-eid="${eid}">+</div></div></div>
    </div>
    ${modes.length ? `<div class="seg ${d === 'water_heater' ? 'blue' : ''}">${modes.map(m => `<div class="${m === curMode ? 'a' : ''}" data-act="mode" data-mode="${m}" data-eid="${eid}">${esc(tr(m))}</div>`).join('')}</div>` : ''}
  </div>`;
}
function camTile(eid, areaName) {
  const s = S[eid], un = UNAV(s);
  return `<div class="tile cam wide static" data-eid="${eid}">
    ${un ? '<div class="noimg">Kamera nicht verfügbar</div>' : `<img src="${B}/api/camera/${eid}?t=${Math.floor(Date.now() / 10000)}" alt="" onerror="this.remove()">`}
    ${un ? '' : '<div class="live"><i></i>LIVE</div>'}
    <div class="cap"><div class="nm">${esc(tileName(eid, areaName))}</div><div class="st">${esc(tr(s.state))} · aktualisiert ${hm(Date.now())}</div></div></div>`;
}
function scenesRow(ids, areaName) {
  return `<div class="scenes">${ids.map(eid => {
    const btn = dom(eid) === 'button', un = UNAV(S[eid]);
    let n = tileName(eid, areaName);
    const lp = S[eid]?.attributes?.friendly_name || '';
    // "Küchenambiente Entspannen" -> "Entspannen"
    const pre = ids.map(x => fname(x)).reduce((p, c) => { let i = 0; while (i < p.length && p[i] === c[i]) i++; return p.slice(0, i); });
    if (ids.length > 1 && pre.includes(' ')) n = lp.slice(pre.lastIndexOf(' ') + 1) || n;
    return `<div class="scene ${un ? 'unavail' : ''}" data-act="${btn ? 'press' : 'scene'}" data-eid="${eid}">${ic(btn ? 'mdi:gesture-tap-button' : 'mdi:palette-outline', btn ? 'blue' : 'purple')}${esc(n)}</div>`;
  }).join('')}</div>`;
}
function listRow(eid, label) {
  const s = S[eid], un = UNAV(s);
  const v = fmtState(s, {html: true});
  let sub = '';
  if (dom(eid) === 'binary_sensor') {
    const dc = s.attributes.device_class;
    const val = dc === 'occupancy' || dc === 'motion' ? (s.state === 'on' ? 'Belegt' : 'Frei') : tr(s.state);
    return `<div class="li ${un ? 'dim' : ''}">${ic(iconFor(eid), colorFor(eid))}<div class="t"><b>${esc(label)}</b><span>${rel(s.last_changed)}</span></div><div class="v">${esc(val)}</div></div>`;
  }
  if (dom(eid) === 'todo') sub = 'Offene Einträge';
  return `<div class="li ${un ? 'dim' : ''}" data-eid="${eid}">${ic(iconFor(eid), colorFor(eid))}<div class="t"><b>${esc(label)}</b>${sub ? `<span>${sub}</span>` : ''}</div><div class="v">${v}</div></div>`;
}
function listCard(title, ids, opts = {}) {
  const live = ids.filter(x => !UNAV(S[x]) && S[x].state !== 'unknown');
  const hidden = ids.length - live.length;
  if (!live.length) return '';
  const strip = t => n => { if (t && n.startsWith(t + ' ')) n = n.slice(t.length + 1); return n; };
  const pretty = n => /_/.test(n) && !/ /.test(n) ? (n = n.replace(/_/g, ' ').replace(/ verbrauch heute$/, ''), n[0].toUpperCase() + n.slice(1)) : n;
  const lab = x => pretty(opts.full ? strip(opts.prefix)(fname(x)) : (title ? shortName(x) : fname(x)));
  const max = opts.max || 99;
  const rows = live.map(x => listRow(x, lab(x)));
  return `<div class="card list">${title ? `<div class="ct">${esc(title)}</div>` : ''}${rows.slice(0, max).join('')}
    ${rows.length > max ? `<details class="more"><summary>Alle ${rows.length} anzeigen</summary>${rows.slice(max).join('')}</details>` : ''}</div>
    ${hidden ? `<div class="foot">${hidden} weitere${hidden === 1 ? 's' : ''} nicht verfügbar oder ohne Wert ausgeblendet</div>` : ''}`;
}
function matrixCard(rows) {
  const P = ['Täglicher', 'Wöchentlicher', 'Monatlicher', 'Jährlicher'], H = ['Tag', 'Woche', 'Monat', 'Jahr'];
  const cols = P.filter(p => Object.values(rows).some(r => r[p]));
  const val = x => x && S[x] && isNum(S[x].state) ? Number(S[x].state) : null;
  const sum = p => Object.values(rows).reduce((t, r) => t + (val(r[p]) || 0), 0);
  return `<div class="card list"><div class="ct">${ic('mdi:lightning-bolt', 'teal')}Stromverbrauch Wärmepumpe · kWh</div>
    <table class="mx"><thead><tr><th></th>${cols.map(p => `<th>${H[P.indexOf(p)]}</th>`).join('')}</tr></thead>
    <tbody>${Object.entries(rows).map(([k, r]) => `<tr><td>${esc(k)}</td>${cols.map(p => `<td>${val(r[p]) == null ? '–' : nf(val(r[p]), 0)}</td>`).join('')}</tr>`).join('')}</tbody>
    <tfoot><tr><td>Gesamt</td>${cols.map(p => `<td>${nf(sum(p), 0)}</td>`).join('')}</tr></tfoot></table></div>`;
}
function areaSection(areaId, ids) {
  const it = buildArea(areaId, ids), name = AREA[areaId]?.name || areaId;
  const order = l => [...l].sort((a, b) => UNAV(S[a]) - UNAV(S[b]));
  const parts = [];
  const lightsOn = it.lights.filter(x => S[x].state === 'on');
  if (it.lights.length) {
    const ls = order(it.lights);
    parts.push(`<div class="grid">${ls.map((x, i) => lightTile(x, name, ls.length % 2 === 1 && i === 0 && S[x].state === 'on')).join('')}</div>`);
  }
  if (it.scenes.length) parts.push(scenesRow(it.scenes, name));
  for (const c of it.climate) parts.push(climateCard(c, name));
  if (it.wide.length) parts.push(`<div class="stack">${it.wide.map(x => mediaTile(x, name)).join('')}</div>`);
  if (it.tiles.length) parts.push(`<div class="grid">${order(it.tiles).map(x => genericTile(x, it)).join('')}</div>`);
  for (const c of it.cams) parts.push(`<div class="grid">${camTile(c, name)}</div>`);
  if (it.matrix) parts.push(it.matrix && matrixCard(it.matrix));
  for (const g of it.lists) parts.push(listCard(g.title, g.ids));
  const body = parts.filter(Boolean);
  if (!body.length) return '';
  const all = [...it.lights, ...it.tiles, ...it.wide, ...it.cams];
  const allUn = all.length && all.every(x => UNAV(S[x]));
  let small = '';
  if (it.lights.length) small = lightsOn.length ? `${lightsOn.length} ${lightsOn.length === 1 ? 'Licht' : 'Lichter'} an` : 'Lichter aus';
  else if (it.wide.length) small = tr(S[it.wide[0]].state);
  else if (allUn) small = 'Nicht verfügbar';
  else { const nd = new Set(ids.map(x => ENT[x]?.device_id).filter(Boolean)).size; small = `${nd} ${nd === 1 ? 'Gerät' : 'Geräte'}`; }
  return `<section class="section" id="area-${esc(areaId)}"><div class="sh"><h2>${esc(name)}</h2><small>${small}</small></div><div class="stack">${body.join('')}</div></section>`;
}

/* ---------- views ---------- */
function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', {hour: '2-digit', hourCycle: 'h23', timeZone: TZ}).formatToParts(new Date()).find(p => p.type === 'hour').value);
  return h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend';
}
const WI = {rainy: 'weather-rainy', cloudy: 'weather-cloudy', partlycloudy: 'weather-partly-cloudy', sunny: 'weather-sunny', 'clear-night': 'weather-night', fog: 'weather-fog', pouring: 'weather-pouring', snowy: 'weather-snowy', 'snowy-rainy': 'weather-snowy-rainy', windy: 'weather-windy', lightning: 'weather-lightning', 'lightning-rainy': 'weather-lightning-rainy', hail: 'weather-hail'};
function header(title) {
  const person = Object.keys(S).find(x => dom(x) === 'person');
  const first = person ? fname(person).split(' ')[0] : '';
  const w = Object.keys(S).find(x => dom(x) === 'weather');
  const ws = w && S[w];
  const date = new Date().toLocaleDateString('de-AT', {weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ});
  return `<header><div class="toprow"><div class="date">${esc(date)}</div><div class="live-dot ${CONNECTED ? '' : 'off'}"><i></i>${CONNECTED ? 'Live' : 'Offline'}</div></div>
    <div class="hrow"><h1>${esc(title || (greeting() + (first ? ', ' + first : '')))}</h1>
    ${ws && !UNAV(ws) ? `<div class="weather"><div class="wi">${icon(WI[ws.state] || 'weather-cloudy')}</div><div><b>${nf(ws.attributes.temperature, 0)}°</b> <span>${esc(tr(ws.state))}</span></div></div>` : ''}</div></header>`;
}
function chips() {
  const c = [];
  const ids = Object.keys(S);
  for (const l of ids.filter(x => dom(x) === 'lock' && visible(x))) {
    const s = S[l]; c.push(`<div class="chip ${s.state === 'unlocked' ? 'note' : ''}" data-eid="${l}">${ic(iconFor(l), colorFor(l))}${esc(fname(l))} ${esc(tr(s.state).toLowerCase())}</div>`);
  }
  const lightsOn = ids.filter(x => dom(x) === 'light' && visible(x) && S[x].state === 'on');
  c.push(`<div class="chip">${ic(lightsOn.length ? 'mdi:lightbulb-on' : 'mdi:lightbulb-outline', lightsOn.length ? 'yellow' : 'off')}${lightsOn.length ? lightsOn.length + (lightsOn.length === 1 ? ' Licht an' : ' Lichter an') : 'Alle Lichter aus'}</div>`);
  const p = ids.find(x => dom(x) === 'person');
  if (p) c.push(`<div class="chip">${ic('mdi:account', S[p].state === 'home' ? 'green' : 'indigo')}${esc(fname(p).split(' ')[0])} <small>${esc(tr(S[p].state))}</small></div>`);
  for (const x of ids.filter(x => (dom(x) === 'lawn_mower' || dom(x) === 'vacuum') && visible(x))) {
    const b = S[x].attributes.battery ?? S[x].attributes.battery_level;
    if (isNum(b) && Number(b) <= 10) c.push(`<div class="chip warn">${ic('mdi:battery-alert-variant-outline', 'red')}${esc(fname(x))} Akku ${nf(b, 0)} %</div>`);
  }
  const price = S['sensor.smartenergy_strompreis'];
  if (price && isNum(price.state)) c.push(`<div class="chip">${ic('mdi:currency-eur', 'green')}${nf(price.state * 100, 1)} ct/kWh</div>`);
  const waste = S['sensor.waste_collection_schedule_nachste_abholung'];
  if (waste && !UNAV(waste)) c.push(`<div class="chip">${ic('mdi:trash-can-outline', 'yellow')}${fmtState(waste)}</div>`);
  const ev = ids.find(x => /easee_home_status$/.test(x));
  if (ev && !UNAV(S[ev])) c.push(`<div class="chip">${ic('mdi:ev-station', S[ev].state === 'charging' ? 'green' : 'off')}Wallbox <small>${esc(tr(S[ev].state))}</small></div>`);
  return `<div class="chips">${c.join('')}</div>`;
}
function viewHome() {
  const ids = Object.keys(S).filter(visible);
  const byArea = {};
  for (const x of ids) { const a = areaOf(x); (byArea[a || '_'] ??= []).push(x); }
  // floors in level order (EG, OG, …, then negative levels, then floors without level), areas in registry order
  const floors = [...(REG.floors || [])].sort((a, b) => {
    const k = f => f.level == null ? 1000 : f.level < 0 ? 500 - f.level : f.level; return k(a) - k(b);
  });
  let html = header() + chips() + '<div class="cols">';
  const floorIcon = f => f.icon || (f.level == null ? 'mdi:tree-outline' : f.level < 0 ? 'mdi:home-floor-negative-1' : 'mdi:home-floor-' + Math.min(3, f.level));
  const done = new Set();
  // floors with a single area are merged under one shared header so they share the column row
  let pend = [];
  const flush = () => { if (pend.length) html += `<div class="floor">${icon(floorIcon(pend[0].f))}${pend.map(p => esc(p.f.name)).join(' · ')}</div>` + pend.map(p => p.secs.join('')).join(''); pend = []; };
  for (const f of floors) {
    const areas = REG.areas.filter(a => a.floor_id === f.floor_id && byArea[a.area_id]);
    const secs = areas.map(a => { done.add(a.area_id); return areaSection(a.area_id, byArea[a.area_id]); }).filter(Boolean);
    if (!secs.length) continue;
    if (secs.length === 1) { pend.push({f, secs}); continue; }
    flush(); html += `<div class="floor">${icon(floorIcon(f))}${esc(f.name)}</div>` + secs.join('');
  }
  flush();
  const rest = REG.areas.filter(a => !done.has(a.area_id) && byArea[a.area_id]);
  if (rest.length) html += `<div class="floor">${icon('mdi:home-outline')}Weitere Bereiche</div>` + rest.map(a => areaSection(a.area_id, byArea[a.area_id])).join('');
  // entities without area -> grouped like HA's auto-generated domain cards, condensed by name prefix
  const un = (byArea['_'] || []).filter(x => !['weather', 'person'].includes(dom(x)));
  if (un.length) {
    const groups = new Map();
    for (const x of un) {
      const n = fname(x);
      let g = /_/.test(n) && !/ /.test(n) ? 'Verbrauch heute (Hilfssensoren)' : n.split(' ')[0];
      if (/^(Easee|Easeee)$/i.test(g)) g = 'Easee Wallbox';
      if (dom(x) === 'media_player') g = 'Medien';
      if (dom(x) === 'todo') g = 'Listen';
      (groups.get(g) || groups.set(g, []).get(g)).push(x);
    }
    let secs = '', misc = [];
    for (const [g, l] of groups) {
      const live = l.filter(x => !UNAV(S[x]) && S[x].state !== 'unknown');
      if (live.length >= 2 || (live.length && ['Medien', 'Listen'].includes(g))) {
        const pre = g === 'Easee Wallbox' ? 'Easee' : g;
        const media = l.filter(x => dom(x) === 'media_player' && !UNAV(S[x]));
        if (g === 'Medien') { secs += `<section class="section"><div class="sh"><h2>Medien</h2><small>${media.length}</small></div><div class="grid">${media.map(x => genericTile(x, {})).join('')}</div></section>`; continue; }
        secs += `<section class="section"><div class="sh"><h2>${esc(g)}</h2><small>${live.length}</small></div>${listCard('', l, {full: true, prefix: pre, max: 6})}</section>`;
      } else misc.push(...l);
    }
    const miscLive = misc.filter(x => !UNAV(S[x]) && S[x].state !== 'unknown');
    if (miscLive.length) secs += `<section class="section"><div class="sh"><h2>Sonstiges</h2><small>${miscLive.length}</small></div>${listCard('', misc, {full: true, max: 6})}</section>`;
    html += `<div class="floor">${icon('mdi:shape-outline')}Ohne Bereich</div>` + secs;
  }
  return html + '</div>';
}

/* --- generic Lovelace card renderer (used for the "Wallbox" dashboard) --- */
const HIST = {};
async function loadHistory(eid, hours) {
  const k = eid + hours;
  if (HIST[k] && Date.now() - HIST[k].t < 120000) return HIST[k].d;
  try { const r = await fetch(`${B}/api/history?entity_id=${encodeURIComponent(eid)}&hours=${hours}`); HIST[k] = {t: Date.now(), d: await r.json()}; }
  catch { HIST[k] = {t: Date.now(), d: []}; }
  return HIST[k].d;
}
function sparkSvg(pts, hours, lb) {
  if (!pts || pts.length < 2) return '<div class="empty">Kein Verlauf verfügbar</div>';
  const t1 = Date.now(), t0 = t1 - hours * 3600e3;
  // step line (price is a step function)
  const P = pts.map(([t, v]) => [Math.max(t0, new Date(t).getTime()), v]); P.push([t1, P[P.length - 1][1]]);
  const vs = P.map(p => p[1]); let lo = Math.min(...vs), hi = Math.max(...vs); if (lb != null) lo = Math.min(lo, lb);
  if (hi === lo) hi = lo + 1;
  const W = 300, Hh = 84, X = t => (t - t0) / (t1 - t0) * W, Y = v => Hh - 4 - (v - lo) / (hi - lo) * (Hh - 10);
  let d = `M${X(P[0][0]).toFixed(1)} ${Y(P[0][1]).toFixed(1)}`;
  for (let i = 1; i < P.length; i++) d += ` L${X(P[i][0]).toFixed(1)} ${Y(P[i - 1][1]).toFixed(1)} L${X(P[i][0]).toFixed(1)} ${Y(P[i][1]).toFixed(1)}`;
  return `<svg class="spark" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none"><defs><linearGradient id="sf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#30D158" stop-opacity=".35"/><stop offset="1" stop-color="#30D158" stop-opacity="0"/></linearGradient></defs>
    <path d="${d} L${W} ${Hh} L0 ${Hh}Z" fill="url(#sf)"/><path d="${d}" fill="none" stroke="#30D158" stroke-width="2.2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}
function cardMiniGraph(c) {
  const e = c.entities?.[0]; const eid = typeof e === 'string' ? e : e?.entity; const s = S[eid];
  if (!s) return '';
  const hours = c.hours_to_show || 24, key = eid + hours;
  const pts = HIST[key]?.d; if (!pts) loadHistory(eid, hours).then(() => render());
  const u = unit(s.attributes.unit_of_measurement);
  const vs = (pts || []).map(p => p[1]);
  const ct = u === '€/kWh';
  const fmt = v => ct ? nf(v * 100, 2) + ' ct' : nf(v, c.decimals ?? 2);
  const hh = [0, .25, .5, .75, 1].map(f => hm(Date.now() - (1 - f) * hours * 3600e3));
  return `<div class="card graph">
    <div class="head">${ic(c.icon || iconFor(eid), 'green')}<div class="meta"><div class="nm">${esc(c.name || fname(eid))}</div><div class="st">${esc(typeof e === 'object' && e.name || '')} · letzte ${hours} Std.</div></div>
      <div class="watt">${isNum(s.state) ? (ct ? nf(s.state * 100, 2) + '<small>ct/kWh</small>' : nf(s.state, c.decimals ?? 2) + `<small>${esc(u)}</small>`) : tr(s.state)}</div></div>
    ${pts ? sparkSvg(pts, hours, c.lower_bound) : '<div class="spark"></div>'}
    <div class="axis">${hh.map(x => `<span>${x}</span>`).join('')}</div>
    ${vs.length ? `<div class="emeta"><span>Min <b>${fmt(Math.min(...vs))}</b></span><span>Ø <b>${fmt(vs.reduce((a, b) => a + b, 0) / vs.length)}</b></span><span>Max <b>${fmt(Math.max(...vs))}</b></span></div>` : ''}
    ${isNum(s.state) && ct ? `<div class="foot" style="padding:6px 0 0">Exakt ${nf(s.state, c.decimals ?? 4)} €/kWh · aktualisiert ${rel(s.last_changed)}</div>` : ''}
  </div>`;
}
function cardFlexTable(c) {
  const cols = c.columns || [];
  const rows = (c.entities || []).map(x => typeof x === 'string' ? x : x.entity).filter(x => S[x]);
  const get = (eid, col) => col.data === 'state' ? S[eid].state : col.data === 'name' ? fname(eid) : S[eid].attributes[col.data];
  const num = v => isNum(v) ? Number(v) : null;
  const numCols = cols.filter(col => col.footer_type === 'sum');
  const sums = numCols.map(col => rows.reduce((t, x) => t + (num(get(x, col)) || 0), 0));
  const maxE = Math.max(0.0001, ...rows.map(x => num(S[x].state) || 0));
  const sorted = [...rows];   // keep config order (disable_header_sort)
  const val = (v, col) => num(v) == null ? (v === 'unavailable' ? '–' : esc(v ?? '–')) : nf(v, 2) + (col.suffix ? `<small>${esc(col.suffix.trim())}</small>` : '');
  return `<div class="card list"><div class="ct">${ic('mdi:table', 'teal')}${esc(c.title || '')}</div>
    ${sorted.map(x => {
      const lbl = get(x, cols[0] || {data: 'name'}) || fname(x); const un = UNAV(S[x]);
      const e = num(S[x].state) || 0;
      return `<div class="li ${un ? 'dim' : ''}" style="flex-wrap:wrap;row-gap:0">${ic(iconFor(x), e > 0 ? 'teal' : 'off')}<div class="t"><b>${esc(lbl)}</b>
        <div class="bar" style="background:rgba(255,255,255,.08);margin-top:6px;height:4px"><i style="width:${(e / maxE * 100).toFixed(1)}%;background:linear-gradient(90deg,#0A84FF,#64D2FF)"></i></div></div>
        ${cols.slice(1).map(col => `<div class="v" style="min-width:${col.data === 'state' ? 82 : 66}px">${un ? '–' : val(get(x, col), col)}</div>`).join('')}</div>`;
    }).join('')}
    ${c.display_footer ? `<div class="li" style="border-top:1px solid rgba(255,255,255,.18)"><div class="t"><b style="font-weight:700">${esc(cols[0]?.footer_text || 'Summe')}</b></div>
      ${cols.slice(1).map(col => { const i = numCols.indexOf(col); return `<div class="v" style="min-width:${col.data === 'state' ? 82 : 66}px">${i < 0 ? '' : nf(sums[i], 2) + `<small>${esc((col.suffix || '').trim())}</small>`}</div>`; }).join('')}</div>` : ''}
  </div>`;
}
function cardTile(c, cls = '') {
  const s = S[c.entity]; if (!s) return '';
  return `<div class="tile stat static ${UNAV(s) ? 'unavail' : ''} ${cls}" data-eid="${c.entity}"><div class="top">${ic(c.icon || iconFor(c.entity), colorFor(c.entity) === 'off' ? 'teal' : colorFor(c.entity))}</div>
    <div><div class="nm">${esc(c.name || fname(c.entity))}</div><div class="big">${fmtState(s, {html: true})}</div>
    ${s.attributes.kosten != null ? `<div class="st">${nf(s.attributes.kosten, 2)} €</div>` : ''}</div></div>`;
}
function renderCard(c) {
  switch (c.type) {
    case 'custom:mini-graph-card': return cardMiniGraph(c);
    case 'custom:flex-table-card': return cardFlexTable(c);
    case 'tile': return `<div class="grid">${cardTile(c)}</div>`;
    case 'grid': return `<div class="grid ${(c.columns || 2) >= 3 ? 'g3' : ''}">${(c.cards || []).map(x => x.type === 'tile' ? cardTile(x) : renderCard(x)).join('')}</div>`;
    case 'vertical-stack': return `<div class="stack">${(c.cards || []).map(renderCard).join('')}</div>`;
    case 'horizontal-stack': return `<div class="grid">${(c.cards || []).map(renderCard).join('')}</div>`;
    case 'entities': return listCard(c.title || '', (c.entities || []).map(x => typeof x === 'string' ? x : x.entity).filter(x => S[x]), {full: true});
    case 'markdown': return `<div class="card" style="padding:14px 16px;font-size:14px;color:var(--sub)">${esc(c.content || '')}</div>`;
    default: return `<div class="card empty">Karte „${esc(c.type)}“ wird (noch) nicht dargestellt</div>`;
  }
}
function viewDashboard(url) {
  const cfg = DASH[url] || {}, meta = (DASH._list || []).find(d => d.url_path === url) || {};
  const views = cfg.views || [];
  let html = header(dashTitle(meta) || 'Dashboard');
  for (const v of views) {
    if (views.length > 1) html += `<div class="floor">${icon(v.icon || 'mdi:view-dashboard')}${esc(v.title || '')}</div>`;
    const cards = v.cards || (v.sections || []).flatMap(s => s.cards || []);
    html += `<div class="section"><div class="sh"><h2>${esc(v.title || '')}</h2><small>Heute</small></div><div class="energy-grid">` +
      cards.map((c, i) => `<div class="${c.type === 'grid' ? 'wide-all' : ''}">${renderCard(c)}</div>`).join('') + '</div></div>';
  }
  return html;
}
let MAP = null;
function viewMap() {
  const persons = Object.keys(S).filter(x => dom(x) === 'person');
  const home = S['zone.home'];
  return header('Karte') + `<div class="section"><div id="map"></div></div>
    <div class="section"><div class="stack">${persons.map(p => {
      const s = S[p], a = s.attributes;
      let dist = '';
      if (home && a.latitude) { const R = 6371, rad = Math.PI / 180, dLa = (a.latitude - home.attributes.latitude) * rad, dLo = (a.longitude - home.attributes.longitude) * rad;
        const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(home.attributes.latitude * rad) * Math.sin(dLo / 2) ** 2; dist = nf(2 * R * Math.asin(Math.sqrt(h)), 1) + ' km von Zuhause'; }
      return `<div class="tile static" style="min-height:0;flex-direction:row;align-items:center;gap:12px">${ic('mdi:account', s.state === 'home' ? 'green' : 'indigo')}
        <div style="flex:1;min-width:0"><div class="nm">${esc(fname(p))}</div><div class="st">${esc(tr(s.state))} · seit ${rel(s.last_changed).replace('vor ', '')}${dist ? ' · ' + dist : ''}</div></div></div>`;
    }).join('')}</div></div>`;
}
function mountMap() {
  const el = $('#map'); if (!el || !window.L) { if (el) el.innerHTML = '<div class="empty">Karte konnte nicht geladen werden</div>'; return; }
  MAP = L.map(el, {zoomControl: false, attributionControl: true});
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, className: 'dark-tiles', attribution: '© OpenStreetMap'}).addTo(MAP);
  const pts = [];
  for (const z of Object.keys(S).filter(x => dom(x) === 'zone')) {
    const a = S[z].attributes; if (a.latitude == null) continue;
    L.circle([a.latitude, a.longitude], {radius: a.radius || 100, color: '#FF9F0A', weight: 2, fillOpacity: .15}).addTo(MAP);
    L.marker([a.latitude, a.longitude], {icon: L.divIcon({className: '', html: `<div class="pin home">${icon('mdi:home')}</div>`, iconSize: [44, 44], iconAnchor: [22, 22]})}).addTo(MAP);
    pts.push([a.latitude, a.longitude]);
  }
  for (const p of Object.keys(S).filter(x => dom(x) === 'person')) {
    const a = S[p].attributes; if (a.latitude == null) continue;
    L.circle([a.latitude, a.longitude], {radius: a.gps_accuracy || 20, color: '#5E5CE6', weight: 1, fillOpacity: .2}).addTo(MAP);
    L.marker([a.latitude, a.longitude], {icon: L.divIcon({className: '', html: `<div class="pin">${esc(fname(p)[0])}</div>`, iconSize: [44, 44], iconAnchor: [22, 22]})}).addTo(MAP);
    pts.push([a.latitude, a.longitude]);
  }
  if (pts.length) MAP.fitBounds(pts, {padding: [60, 60], maxZoom: 15}); else MAP.setView([48.2, 16.37], 10);
}

/* ---------- shell ---------- */
// display names that differ from HA (route stays the same: #dashboard-energie)
const RENAME = {'dashboard-energie': 'Energie'};
const dashTitle = d => RENAME[d.url_path] || d.title;
const SB = (() => { const v = new URLSearchParams(location.search).get('sidebar'); return ['a', 'b', 'c'].includes(v) ? v : ['a', 'b', 'c'].includes(window.SB_DEFAULT) ? window.SB_DEFAULT : 'b'; })();
document.body.classList.add('sb-' + SB);
// area icons used in registry: 'mdi:lightning-bolt' 'mdi:washing-machine' 'mdi:sofa' 'mdi:stove' 'mdi:bed' 'mdi:alpha-g-box' 'mdi:grass' 'mdi:chair-rolling' 'mdi:door' 'mdi:weather-rainy' 'mdi:weather-cloudy' 'mdi:weather-partly-cloudy' 'mdi:weather-sunny' 'mdi:weather-night'
const AREA_ICON = {speis: 'mdi:fridge-outline', _: 'mdi:texture-box'};
const timeNow = () => new Date().toLocaleTimeString('de-AT', {hour: '2-digit', minute: '2-digit', timeZone: TZ});
function sbAreas() {
  const floors = [...(REG.floors || [])].sort((a, b) => { const k = f => f.level == null ? 1000 : f.level < 0 ? 500 - f.level : f.level; return k(a) - k(b); });
  const cnt = {};
  for (const x of Object.keys(S).filter(visible)) { const a = areaOf(x); if (!a) continue; const c = cnt[a] ??= {n: 0, on: 0, warn: 0};
    c.n++; if (dom(x) === 'light' && S[x].state === 'on') c.on++;
    if (dom(x) === 'lock' && S[x].state === 'unlocked') c.warn++;
    const b = S[x].attributes.battery ?? S[x].attributes.battery_level; if (['lawn_mower', 'vacuum'].includes(dom(x)) && isNum(b) && b <= 10) c.warn++; }
  return floors.map(f => ({f, areas: REG.areas.filter(a => a.floor_id === f.floor_id && cnt[a.area_id]).map(a => ({a, c: cnt[a.area_id]}))})).filter(g => g.areas.length);
}
function sbStatus() {
  const ids = Object.keys(S), out = [];
  const lock = ids.find(x => dom(x) === 'lock' && visible(x));
  if (lock) { const u = S[lock].state === 'unlocked'; out.push({k: 'lock', icon: u ? 'mdi:lock-open-variant' : 'mdi:lock', c: u ? 'orange' : 'green', l: 'Türschloss', v: tr(S[lock].state)}); }
  const pr = S['sensor.smartenergy_strompreis'];
  if (pr && isNum(pr.state)) out.push({k: 'price', icon: 'mdi:currency-eur', c: 'green', l: 'Strompreis', v: nf(pr.state * 100, 1), u: 'ct/kWh'});
  const pw = S['sensor.p1_meter_leistung'];
  if (pw && isNum(pw.state)) out.push({k: 'power', icon: 'mdi:flash', c: 'yellow', l: 'Netzbezug', v: nf(pw.state, 0), u: 'W'});
  const ws = S[ids.find(x => dom(x) === 'weather')];
  if (ws && !UNAV(ws)) out.push({k: 'weather', icon: WI[ws.state] || 'weather-cloudy', c: 'blue', l: tr(ws.state), v: nf(ws.attributes.temperature, 0) + '°'});
  const waste = S['sensor.waste_collection_schedule_nachste_abholung'];
  if (waste && !UNAV(waste)) out.push({k: 'waste', icon: 'mdi:trash-can-outline', c: 'yellow', l: 'Abfall', v: fmtState(waste)});
  return out;
}
function sidebar(T) {
  const person = Object.keys(S).find(x => dom(x) === 'person');
  const pn = person ? fname(person) : '', home = person && S[person].state === 'home';
  const ini = pn.split(' ').map(w => w[0]).join('').slice(0, 2);
  const tab = t => `<a class="tab ${t.id === VIEW ? 'a' : ''}" href="#${t.id}" title="${esc(t.title)}"><span class="ti">${icon(t.icon)}</span><span class="tl">${esc(t.title)}</span></a>`;
  const brand = `<div class="sb-brand"><div class="logo">${icon('mdi:home-variant')}</div><div class="bt"><b>Zuhause</b><small><i class="dot ${CONNECTED ? '' : 'off'}"></i>${CONNECTED ? 'Live verbunden' : 'Offline'}</small></div></div>`;
  const user = person ? `<div class="sb-user"><div class="av ${home ? 'home' : ''}">${esc(ini)}</div><div class="ut"><b>${esc(pn)}</b><small>${esc(tr(S[person].state))} · seit ${esc(rel(S[person].last_changed).replace('vor ', ''))}</small></div></div>` : '';
  const st = sbStatus();
  const rooms = sbAreas().map(g => `<div class="sb-floor">${esc(g.f.name)}</div>` + g.areas.map(({a, c}) =>
    `<a class="sb-room" data-jump="area-${esc(a.area_id)}">${icon(a.icon || AREA_ICON[a.area_id] || AREA_ICON._)}<span>${esc(a.name)}</span>${c.warn ? '<i class="warn"></i>' : c.on ? `<em>${c.on}</em>` : ''}</a>`).join('')).join('');
  const nav = `<div class="sb-nav">${T.map(tab).join('')}</div>`;
  if (SB === 'a') {
    const w = st.find(x => x.k === 'weather');
    return brand + nav + `<div class="sb-fill"></div><div class="sb-clock"><b>${timeNow()}</b>${w ? `<small>${icon(w.icon)}${esc(w.v)}</small>` : ''}</div>` + user;
  }
  if (SB === 'b') {
    return brand + `<div class="sb-sec">Ansichten</div>` + nav + `<div class="sb-sec">Räume</div><div class="sb-rooms">${rooms}</div>` +
      `<div class="sb-status">${st.filter(x => ['lock', 'price', 'power'].includes(x.k)).map(x => `<div class="sr ${x.c}" title="${esc(x.l)}">${icon(x.icon)}<b>${esc(x.k === 'lock' ? (S[Object.keys(S).find(y => dom(y) === 'lock')].state === 'unlocked' ? 'Offen' : 'Zu') : x.v)}</b><small>${esc(x.u || x.l)}</small></div>`).join('')}</div>` + user;
  }
  // C: widget column
  const date = new Date().toLocaleDateString('de-AT', {weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ});
  const w = st.find(x => x.k === 'weather');
  return `<div class="sb-now"><div class="tm">${timeNow()}</div><div class="dt">${esc(date)}</div>${w ? `<div class="wx">${icon(w.icon)}<b>${esc(w.v)}</b><span>${esc(w.l)}</span></div>` : ''}</div>` + nav +
    `<div class="sb-widgets">${st.filter(x => x.k !== 'weather').map(x => `<div class="wg ${x.c}">${icon(x.icon)}<small>${esc(x.l)}</small><b>${esc(x.v)}${x.u ? `<em>${x.u}</em>` : ''}</b></div>`).join('')}</div>` +
    `<div class="sb-sec">Räume</div><div class="sb-chips">${sbAreas().flatMap(g => g.areas).map(({a, c}) => `<a class="sb-room" data-jump="area-${esc(a.area_id)}">${icon(a.icon || AREA_ICON[a.area_id] || AREA_ICON._)}<span>${esc(a.name)}</span>${c.warn ? '<i class="warn"></i>' : c.on ? `<em>${c.on}</em>` : ''}</a>`).join('')}</div><div class="sb-fill"></div>` + user;
}
let JUMP = null;
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-jump]'); if (!el) return;
  ev.preventDefault();
  const go = () => { const t = document.getElementById(el.dataset.jump); if (t) scrollTo({top: t.getBoundingClientRect().top + scrollY - 16, behavior: 'smooth'}); };
  if (VIEW !== 'home') { JUMP = go; location.hash = 'home'; } else go();
});
function tabs() {
  const list = [{id: 'home', title: 'Übersicht', icon: 'mdi:home'}];
  for (const d of DASH._list || []) list.push({id: d.url_path, title: dashTitle(d), icon: d.icon || 'mdi:view-dashboard'});
  return list;
}
function render() {
  if (!REG) return;
  const T = tabs();
  if (!T.find(t => t.id === VIEW)) VIEW = 'home';
  $('#tabbar').innerHTML = sidebar(T);
  if (VIEW === 'map' && MAP && $('#map')) { // keep the map alive, only refresh the rest
    return;
  }
  const y = scrollY;
  MAP = null;
  const cfg = DASH[VIEW];
  $('#app').innerHTML = VIEW === 'home' ? viewHome() : (cfg && cfg.strategy && cfg.strategy.type === 'map') ? viewMap() : viewDashboard(VIEW);
  if (VIEW === 'map' || (cfg && cfg.strategy?.type === 'map')) mountMap();
  scrollTo(0, y);
}
let rt = null;
const scheduleRender = () => { clearTimeout(rt); rt = setTimeout(render, 150); };
window.addEventListener('hashchange', () => { VIEW = location.hash.slice(1) || 'home'; MAP = null; render(); scrollTo(0, 0); if (JUMP) { setTimeout(JUMP, 50); JUMP = null; } });

function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2600); }
async function callService(domain, service, data) {
  if (!CONTROL) { toast('Nur-Lese-Modus: Steuerung ist am Server deaktiviert'); return; }
  try {
    const r = await fetch(`${B}/api/service/${domain}/${service}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)});
    const j = await r.json(); if (!j.ok) toast(j.error || 'Fehler');
  } catch { toast('Server nicht erreichbar'); }
}
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]'); if (!el) return;
  const eid = el.dataset.eid, s = S[eid], d = dom(eid || '.');
  if (!s || UNAV(s)) return;
  ev.stopPropagation();
  switch (el.dataset.act) {
    case 'toggle': return callService(d, 'toggle', {entity_id: eid});
    case 'lock': return callService('lock', s.state === 'locked' ? 'unlock' : 'lock', {entity_id: eid});
    case 'scene': return callService('scene', 'turn_on', {entity_id: eid});
    case 'press': return callService('button', 'press', {entity_id: eid});
    case 'playpause': return callService('media_player', 'media_play_pause', {entity_id: eid});
    case 'temp': {
      const step = s.attributes.target_temp_step || (d === 'water_heater' ? 1 : 0.5);
      const t = (s.attributes.temperature ?? 0) + step * Number(el.dataset.dir);
      return callService(d, 'set_temperature', {entity_id: eid, temperature: Math.max(s.attributes.min_temp, Math.min(s.attributes.max_temp, t))});
    }
    case 'mode': return d === 'water_heater' ? callService(d, 'set_operation_mode', {entity_id: eid, operation_mode: el.dataset.mode}) : callService(d, 'set_hvac_mode', {entity_id: eid, hvac_mode: el.dataset.mode});
    case 'more': return toast(`${fname(eid)}: ${fmtState(s).replace(/<[^>]+>/g, ' ')}`);
  }
});

async function boot() {
  const r = await fetch(B + '/api/bootstrap'); const j = await r.json();
  for (const k in S) delete S[k];
  for (const s of j.states) S[s.entity_id] = s;
  REG = j.registry; DASH = j.dashboards; CONTROL = j.control; CONNECTED = j.connected;
  indexRegistry(); render();
}
function connectWs() {
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + B + '/ws');
  ws.onopen = () => { CONNECTED = true; scheduleRender(); };
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.t === 'state') { if (d.s) S[d.id] = d.s; else delete S[d.id]; scheduleRender(); }
    else if (d.t === 'resync') boot();
  };
  ws.onclose = () => { CONNECTED = false; scheduleRender(); setTimeout(connectWs, 3000); };
}
boot().then(connectWs).catch(e => { $('#app').innerHTML = `<div class="loading">Fehler: ${esc(e.message)}</div>`; setTimeout(() => location.reload(), 5000); });
setInterval(scheduleRender, 30000);   // relative times, media progress, camera snapshot
