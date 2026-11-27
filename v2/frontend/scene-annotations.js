import { Vector3 } from 'three';

const names = { AVAILABLE: 'Disponible', DOCKING: 'Acoplando', OPENING: 'Abriendo', LOADING: 'Cargando', VERIFYING: 'Verificando', CLOSING: 'Cerrando', UNDOCKING: 'Saliendo', OUTBOUND: 'En ruta', RETURNING: 'Regresando', AT_STORE: 'En tienda', FAULT: 'Incidencia', QUALITY_HOLD: 'Retenido', TO_SOURCE: 'Recogiendo', TO_DESTINATION: 'Trasladando', MOVING: 'En movimiento', CHARGING: 'Cargando batería', STAGING_DEPOSIT: 'Depositando' };

// Screen-space annotations share the camera and the interpolated entity poses.
// They do not manufacture tasks, loads or movement to make the yard look busy.
export default class SceneAnnotations {
  constructor(host, select) {
    this.host = host;
    this.select = select;
    this.nodes = new Map();
    this.layer = document.createElement('div');
    this.layer.className = 'scene-annotations';
    this.layer.setAttribute('aria-label', 'Elementos visibles en el mapa');
    host.append(this.layer);
    this.point = new Vector3();
  }

  update(scene) {
    const outside = ['overview', 'network'].includes(scene.view);
    const mobile = this.host.clientWidth < 600;
    const candidates = [];
    for (const dock of scene.layout?.loadingDocks || []) {
      if (!outside) continue;
      const id = dock.id, station = (scene.layout.stations || []).find(s => s.id === id);
      if (!station) continue;
      const truck = [...scene.movers.values()].find(m => m.record.type === 'truck' && m.item.dockId === id && !['AVAILABLE', 'OUTBOUND', 'RETURNING', 'AT_STORE'].includes(m.item.state));
      const selected = scene.selected === `station:${id}`, hovered = scene.hovered === `station:${id}`;
      // An idle network view benefits from an unobstructed overview. The dock
      // is labelled when relevant, selected or approached in the exterior view.
      if (scene.view === 'network' && !truck && !selected && !hovered) continue;
      candidates.push({ key: `station:${id}`, type: 'station', id, position: [station.x, 6.2, 36.2], title: `Muelle ${id.split('-').at(-1)}`, detail: truck ? names[truck.item.state] || 'Ocupado' : 'Disponible', kind: 'dock', selected, priority: selected ? 0 : hovered ? 1 : 2 });
    }
    for (const [key, mover] of scene.movers) {
      const selected = key === scene.selected, hovered = key === scene.hovered;
      const forklift = mover.item.type === 'FORKLIFT';
      if (!mover.group.visible || (outside && forklift && mover.group.position.z < 34.5)) continue;
      const state = mover.pose.state || mover.item.state;
      const active = !['AVAILABLE', 'IDLE', 'CHARGING'].includes(state);
      if (!selected && !hovered && !active) continue;
      if (scene.selected && !selected && !hovered) continue;
      const p = mover.group.position;
      candidates.push({ key, type: mover.record.type, id: mover.item.id,
        position: [p.x, p.y + mover.record.size[1] + .65, p.z],
        title: mover.item.name || mover.item.id, detail: names[state] || (mover.pose.carryingHuId ? 'Con carga' : 'En operación'),
        kind: 'vehicle', selected, priority: selected ? 0 : hovered ? 1 : 3 });
    }
    const selected = scene.entities.get(scene.selected);
    for (const asset of scene.snapshot?.autonomyConfiguration?.assets || []) {
      const key = `asset:${asset.id}`, entity = scene.entities.get(key);
      if (!entity || (scene.selected !== key && scene.hovered !== key)) continue;
      const p = entity.position;
      const device = scene.snapshot?.autonomy?.map?.devices?.find(item => item.assetId === asset.id);
      const detail = device?.blocked ? 'Retenido' : scene.paused && device?.processId ? 'En pausa' : device?.moving ? 'En proceso' : asset.readiness?.ready ? 'Disponible' : asset.readiness?.reason || 'No disponible';
      candidates.push({ key, type: 'asset', id: asset.id, position: [p.x, p.y + entity.size[1] / 2 + .5, p.z],
        title: asset.name, detail,
        kind: 'vehicle', selected: scene.selected === key, priority: 0 });
    }
    if (selected && !['truck', 'robot', 'warehouse', 'station', 'asset'].includes(selected.type)) {
      const p = selected.position;
      candidates.push({ key: scene.selected, type: selected.type, id: selected.id,
        position: [p.x, p.y + selected.size[1] / 2 + .9, p.z], title: selected.id,
        detail: selected.type === 'hu' ? 'Unidad de carga' : selected.type === 'branch' ? 'Sucursal' : 'Seleccionado',
        kind: 'pin', selected: true, priority: 0 });
    }
    const visible = new Set(), occupied = [];
    const width = this.host.clientWidth, height = this.host.clientHeight;
    const limit = mobile ? 3 : 6;
    for (const candidate of candidates.sort((a, b) => a.priority - b.priority)) {
      if (visible.size >= limit) break;
      this.point.set(...candidate.position).project(scene.camera);
      if (this.point.z < -1 || this.point.z > 1 || Math.abs(this.point.x) > .96 || Math.abs(this.point.y) > .91) continue;
      const x = (this.point.x + 1) * width / 2, y = (1 - this.point.y) * height / 2;
      if (!candidate.selected && occupied.some(p => Math.abs(p.x - x) < 136 && Math.abs(p.y - y) < 37)) continue;
      occupied.push({ x, y });
      let node = this.nodes.get(candidate.key);
      if (!node) {
        const button = document.createElement('button');
        button.type = 'button';
        const marker = document.createElement('i'), title = document.createElement('strong'), detail = document.createElement('span');
        marker.setAttribute('aria-hidden', 'true');
        button.append(marker, title, detail);
        button.addEventListener('click', () => this.select(candidate.type, candidate.id));
        this.layer.append(button);
        node = { button, title, detail }; this.nodes.set(candidate.key, node);
      }
      node.button.className = `scene-marker scene-marker--${candidate.kind}${candidate.selected ? ' is-selected' : ''}`;
      node.button.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-100%)`;
      if (node.title.textContent !== candidate.title) node.title.textContent = candidate.title;
      if (node.detail.textContent !== candidate.detail) node.detail.textContent = candidate.detail;
      node.button.setAttribute('aria-label', `${candidate.title}: ${candidate.detail}`);
      node.button.hidden = false; visible.add(candidate.key);
    }
    for (const [key, node] of this.nodes) if (!visible.has(key)) node.button.hidden = true;
  }

  dispose() { this.layer.remove(); this.nodes.clear(); }
}
