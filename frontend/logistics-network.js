import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/* A view of persisted documents, not vehicle telemetry. No write requests live here. */
document.querySelectorAll("[data-logistics-scene]").forEach(startNetwork);
document.querySelectorAll("[data-network-tabs]").forEach((tabs) => {
  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-network-tab]");
    if (!button) return;
    const scope = tabs.closest(".logistics-map-panels");
    tabs.querySelectorAll("[data-network-tab]").forEach((tab) => {
      const selected = tab === button;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    scope.querySelectorAll("[data-network-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.networkPanel !== button.dataset.networkTab;
    });
    window.dispatchEvent(new Event("resize"));
  });
  tabs.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...tabs.querySelectorAll("[data-network-tab]")];
    const index = buttons.indexOf(document.activeElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) %
            buttons.length;
    event.preventDefault();
    buttons[next].click();
    buttons[next].focus();
  });
  if (new URLSearchParams(location.search).get("view") === "interior")
    tabs.querySelector('[data-network-tab="interior"]')?.click();
});

function startNetwork(root) {
  const find = (name) => root.querySelector(`[data-ln-${name}]`);
  const text = (name, value) => {
    const node = find(name);
    if (node) node.textContent = String(value ?? "—");
  };
  const number = (value) =>
    new Intl.NumberFormat("es-PE").format(Number(value) || 0);
  const host = find("canvas");
  const stage = find("stage");
  const inspectorToggle = find("inspector-toggle");
  function toggleInspector(collapsed) {
    find("inspector").classList.toggle("is-collapsed", collapsed);
    inspectorToggle.setAttribute("aria-expanded", String(!collapsed));
  }
  toggleInspector(window.matchMedia("(max-width: 520px)").matches);
  inspectorToggle.addEventListener("click", () =>
    toggleInspector(!find("inspector").classList.contains("is-collapsed")),
  );
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const statusNames = {
    PENDIENTE: "Pendiente",
    EN_PREPARACION: "En preparación",
    LISTO: "Listo para despacho",
    DESPACHADO: "Despachado del CD",
    CANCELADO: "Cancelado",
    CANCELADA: "Cancelada",
    RECIBIDA: "Recibida",
    PARCIAL: "Recepción parcial",
    EN_PROCESO: "En ejecución",
    COMPLETADA: "Completada",
  };
  const statusLabel = (value) =>
    statusNames[value] ||
    String(value || "Sin estado")
      .replaceAll("_", " ")
      .toLowerCase();
  let data = null;
  let scene, camera, renderer, controls;
  let content = null;
  let requestId = 0;
  let rendering = false;
  let isVisible = true;
  let playing = false;
  let previousFrame = 0;
  let flight = null;
  const requestedOrder = new URLSearchParams(location.search).get("order");
  let selectedKey = /^\d+$/.test(requestedOrder || "")
    ? `order:${requestedOrder}`
    : "warehouse";
  let hoveredKey = null;
  let selectedRing = null;
  let hoverRing = null;
  let routeLine = null;
  let zoomTarget = null;
  let controlsMoving = false;
  let dirty = true;
  let disposed = false;
  let frameCount = 0;
  let worldDepth = 150;
  let worldCenter = new THREE.Vector3(0, 0, 15);
  const entities = new Map();
  const hitTargets = [];
  const trucks = [];
  const geometryCache = new Map();
  const materialCache = new Map();
  const textures = new Set();
  let staticBatches = new Map();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const projected = new THREE.Vector3();
  const dummy = new THREE.Object3D();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 10);
  const sphere = new THREE.IcosahedronGeometry(1, 1);
  const plane = new THREE.PlaneGeometry(1, 1);
  const palette = {
    purple: 0x743cbd,
    deep: 0x402254,
    gold: 0xf1c94b,
    white: 0xf9f9fc,
    concrete: 0xdde3ec,
    road: 0x8c9fbf,
    dark: 0x38364d,
    green: 0x6cbf99,
  };

  function mat(color, options = {}) {
    const key = `${color}:${JSON.stringify(options)}`;
    if (!materialCache.has(key))
      materialCache.set(
        key,
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.78,
          metalness: 0.04,
          ...options,
        }),
      );
    return materialCache.get(key);
  }
  function meshShape(
    geometry,
    material,
    x,
    y,
    z,
    sx,
    sy,
    sz,
    parent = content,
    rotation = null,
    batch = false,
  ) {
    if (batch) {
      const castShadow = y + sy / 2 > 0.4;
      const key = `${geometry.uuid}:${material.uuid}:${castShadow}`;
      if (!staticBatches.has(key))
        staticBatches.set(key, {
          geometry,
          material,
          castShadow,
          matrices: [],
        });
      dummy.position.set(x, y, z);
      dummy.scale.set(sx, sy, sz);
      dummy.rotation.set(...(rotation || [0, 0, 0]));
      dummy.updateMatrix();
      staticBatches.get(key).matrices.push(dummy.matrix.clone());
      return null;
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function box(
    x,
    y,
    z,
    w,
    h,
    d,
    color,
    parent = content,
    rotation = null,
    batch = parent === content,
  ) {
    return meshShape(
      unitBox,
      typeof color === "number" ? mat(color) : color,
      x,
      y,
      z,
      w,
      h,
      d,
      parent,
      rotation,
      batch,
    );
  }
  function cylinder(
    x,
    y,
    z,
    r,
    h,
    color,
    parent = content,
    rotation = null,
    batch = parent === content,
  ) {
    return meshShape(
      unitCylinder,
      typeof color === "number" ? mat(color) : color,
      x,
      y,
      z,
      r,
      h,
      r,
      parent,
      rotation,
      batch,
    );
  }
  function sphereAt(x, y, z, r, color, parent = content, scale = [1, 1, 1]) {
    return meshShape(
      sphere,
      mat(color),
      x,
      y,
      z,
      r * scale[0],
      r * scale[1],
      r * scale[2],
      parent,
      null,
      parent === content,
    );
  }
  function flushStatic() {
    for (const {
      geometry,
      material,
      castShadow,
      matrices,
    } of staticBatches.values()) {
      const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
      matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      content.add(mesh);
    }
    staticBatches.clear();
  }
  function canvasTexture(
    lines,
    background = "#4b2867",
    foreground = "#f2cb45",
    width = 1024,
    height = 256,
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    context.fillStyle = foreground;
    context.textAlign = "center";
    context.textBaseline = "middle";
    lines.forEach((line, index) => {
      context.font = `800 ${lines.length > 1 ? 65 : 96}px Arial, sans-serif`;
      context.fillText(
        String(line).slice(0, 42),
        width / 2,
        (height * (index + 0.5)) / lines.length,
        width - 55,
      );
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    textures.add(texture);
    return texture;
  }
  function sign(
    textLines,
    x,
    y,
    z,
    width,
    height,
    parent = content,
    rotation = 0,
    background,
  ) {
    const texture = canvasTexture(
      textLines,
      background,
      background === "#f7f5fb" ? "#633786" : "#f2cb45",
    );
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
    });
    const mesh = meshShape(plane, material, x, y, z, width, height, 1, parent, [
      0,
      rotation,
      0,
    ]);
    mesh.castShadow = false;
    return mesh;
  }
  const brandMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    toneMapped: false,
  });
  function logo(x, y, z, width, parent = content, rotation = 0) {
    const mesh = meshShape(
      plane,
      brandMaterial,
      x,
      y,
      z,
      width,
      width / (2117 / 743),
      1,
      parent,
      [0, rotation, 0],
    );
    mesh.castShadow = false;
    return mesh;
  }
  function addHit(key, center, size) {
    const hit = new THREE.Mesh(
      unitBox,
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    hit.position.copy(center);
    hit.scale.copy(size);
    hit.userData.entityKey = key;
    content.add(hit);
    hitTargets.push(hit);
    return hit;
  }
  function addEntity(key, record) {
    entities.set(key, { key, ...record });
  }

  function createRoad(x, z, length, width, vertical = false) {
    box(
      x,
      0.025,
      z,
      vertical ? width : length,
      0.09,
      vertical ? length : width,
      palette.road,
    );
    box(
      x,
      0.095,
      z,
      vertical ? width + 1.2 : length,
      0.045,
      vertical ? length : width + 1.2,
      0xc9d0df,
    );
    box(
      x,
      0.13,
      z,
      vertical ? width - 0.7 : length,
      0.04,
      vertical ? length : width - 0.7,
      palette.road,
    );
    for (let n = -length / 2 + 4; n < length / 2; n += 8)
      box(
        x + (vertical ? 0 : n),
        0.16,
        z + (vertical ? n : 0),
        vertical ? 0.16 : 3,
        0.025,
        vertical ? 3 : 0.16,
        0xf5f6fc,
      );
  }
  function tree(x, z, size = 1) {
    cylinder(x, 1.5 * size, z, 0.25 * size, 3 * size, 0x9e8f81);
    sphereAt(
      x,
      4.3 * size,
      z,
      2.05 * size,
      0x82c6a4,
      content,
      [0.85, 1.25, 0.9],
    );
    sphereAt(x - 0.75 * size, 3.6 * size, z + 0.2, 1.25 * size, 0x68b793);
    cylinder(x, 0.12, z, 1.6 * size, 0.12, 0xc7d6ce);
  }
  function lamp(x, z, turn = 0) {
    cylinder(x, 4.3, z, 0.1, 8.5, 0x9a9fb1);
    box(
      x + Math.sin(turn),
      8.6,
      z + Math.cos(turn),
      0.15,
      0.16,
      2.3,
      0x9a9fb1,
      content,
      [0, turn, 0],
    );
    box(
      x + Math.sin(turn) * 1.5,
      8.52,
      z + Math.cos(turn) * 1.5,
      0.6,
      0.15,
      1.35,
      0xfaf3cb,
      content,
      [0, turn, 0],
    );
  }
  function fence(x1, z1, x2, z2, gateGap = null) {
    const length = Math.hypot(x2 - x1, z2 - z1);
    const count = Math.ceil(length / 5);
    for (let n = 0; n <= count; n++) {
      const t = n / count,
        x = THREE.MathUtils.lerp(x1, x2, t),
        z = THREE.MathUtils.lerp(z1, z2, t);
      if (gateGap && x > gateGap[0] && x < gateGap[1]) continue;
      cylinder(x, 1.7, z, 0.095, 3.4, 0xaeb3c4);
      if (n < count) {
        const nextX = THREE.MathUtils.lerp(x1, x2, (n + 1) / count),
          nextZ = THREE.MathUtils.lerp(z1, z2, (n + 1) / count);
        if (
          gateGap &&
          (x + nextX) / 2 > gateGap[0] &&
          (x + nextX) / 2 < gateGap[1]
        )
          continue;
        box(
          (x + nextX) / 2,
          1.7,
          (z + nextZ) / 2,
          Math.abs(nextX - x) + 0.1,
          2.6,
          Math.abs(nextZ - z) + 0.06,
          mat(0xbbc4d3, { transparent: true, opacity: 0.36 }),
        );
        box(
          (x + nextX) / 2,
          3.1,
          (z + nextZ) / 2,
          Math.abs(nextX - x) + 0.1,
          0.08,
          Math.abs(nextZ - z) + 0.08,
          0xaeb3c4,
        );
      }
    }
  }
  function pallet(x, y, z, filled = true) {
    for (let n = -1; n <= 1; n++)
      box(x + n * 0.62, y + 0.13, z, 0.3, 0.26, 2.1, 0xb6966c);
    for (let n = -2; n <= 2; n++)
      box(x, y + 0.35, z + n * 0.43, 1.9, 0.12, 0.31, 0xd8b989);
    if (filled) {
      for (let n = 0; n < 2; n++)
        for (let c = 0; c < 2; c++)
          box(
            x - 0.45 + c * 0.9,
            y + 0.9 + n * 0.8,
            z,
            0.83,
            0.76,
            1.8,
            n ? 0xd6b486 : 0xc6a37a,
          );
      box(x, y + 1.3, z + 0.913, 0.5, 0.4, 0.018, 0xf6efd9);
    }
  }
  function forklift(x, z, rotation = 0) {
    const group = new THREE.Group();
    group.position.set(x, 0.2, z);
    group.rotation.y = rotation;
    content.add(group);
    box(0, 0.65, 0, 1.6, 1.2, 2.1, palette.gold, group);
    box(0, 1.35, -0.5, 1.4, 0.25, 0.9, palette.deep, group);
    for (const side of [-1, 1]) {
      box(side * 0.65, 2, 0, 0.12, 2.8, 0.12, 0x4b4654, group);
      box(side * 0.65, 2, -0.9, 0.12, 2.8, 0.12, 0x4b4654, group);
      for (const ax of [-0.65, 0.65])
        cylinder(side * 0.83, 0.38, ax, 0.38, 0.23, 0x484654, group, [
          0,
          0,
          Math.PI / 2,
        ]);
      box(side * 0.45, 1.6, 1.15, 0.14, 3.1, 0.14, 0x3e3b47, group);
      box(side * 0.4, 0.22, 1.9, 0.16, 0.13, 1.7, 0x787785, group);
    }
    box(0, 3.35, -0.4, 1.6, 0.15, 1.4, 0x4b4654, group);
  }
  function buildWarehouse() {
    const x = -31,
      z = -29;
    box(x, 0.3, z, 104, 0.6, 49, 0xc5cedb);
    box(x, 7.5, z, 102, 14.4, 47, palette.white);
    box(x, 0.9, z + 23.7, 103, 1, 0.8, 0x9ca8bc);
    box(x, 14.6, z, 105, 0.7, 50, 0xc2cbdf);
    box(x, 15.1, z - 12, 105, 0.3, 25.3, 0xd6dcea, content, [0.025, 0, 0]);
    box(x, 15.1, z + 12, 105, 0.3, 25.3, 0xcbd2e2, content, [-0.025, 0, 0]);
    for (let n = 0; n < 36; n++)
      box(x - 51 + n * 2.9, 15.35, z, 0.07, 0.13, 48, 0xb5c1d6);
    for (const offset of [-37, -12, 13, 38]) {
      box(x + offset, 15.6, z - 5, 8, 0.4, 13, 0xa4bcd8);
      box(x + offset, 15.8, z - 5, 7.7, 0.1, 12.7, 0xc2dcee);
      for (let q = -4; q <= 4; q += 4)
        box(x + offset + q, 16, z - 5, 0.14, 0.2, 13, 0x9faec5);
    }
    for (let n = 0; n < 3; n++) {
      box(x - 31 + n * 24, 16, z - 16, 6, 1.8, 5, 0xafbacd);
      cylinder(x - 31 + n * 24, 17, z - 16, 1.8, 0.18, 0x8592aa);
      cylinder(x - 31 + n * 24, 17.12, z - 16, 1.25, 0.1, 0x6f7d95);
    }
    box(x, 13.2, z + 23.8, 102.5, 1.2, 0.45, palette.purple);
    box(x, 12.4, z + 24.1, 103, 0.25, 0.6, palette.gold);
    for (let n = 0; n < 6; n++) {
      const dx = -73 + n * 15;
      box(dx, 4.5, -5.2, 10.5, 9, 0.45, palette.deep);
      box(dx, 4.7, -4.8, 8.7, 8.3, 0.3, 0x676783);
      if (n % 3 === 0) {
        box(dx, 6.75, -4.45, 8.3, 4.1, 0.22, 0xdce0ec);
        box(dx, 2.65, -4.5, 8.3, 3.6, 0.1, 0xc4a678);
      } else {
        for (let q = 0; q < 9; q++)
          box(dx, 0.7 + q * 0.87, -4.42, 8.3, 0.79, 0.22, 0xdbe0ea);
      }
      for (const side of [-1, 1]) {
        box(dx + side * 4.9, 4.5, -4.25, 0.6, 9.3, 0.5, palette.purple);
        box(dx + side * 3.7, 1.1, -3.95, 0.65, 1.8, 0.4, 0x4a4656);
        cylinder(dx + side * 5.7, 1.1, -2.8, 0.2, 2.2, palette.gold);
      }
      sign(
        [`${n < 3 ? "REC" : "SAL"} 0${(n % 3) + 1}`],
        dx,
        10.2,
        -4.4,
        6.8,
        1.65,
      );
      for (const side of [-1, 1])
        box(dx + side * 5.4, 0.11, 8.8, 0.13, 0.04, 24, 0xf3dc82);
      box(dx, 0.12, 21, 10.8, 0.04, 0.15, 0xf3dc82);
    }
    // The office and entrance are physically separate from the loading bays.
    box(35, 6.8, -29, 21, 13.6, 47, 0xeceef6);
    box(35, 13.8, -29, 22, 0.6, 48, 0xc3cbdf);
    for (let floor = 0; floor < 2; floor++)
      for (let col = 0; col < 3; col++) {
        box(28 + col * 7, 5 + floor * 5, -5.3, 4.6, 2.4, 0.2, 0x8fa7c7);
        box(45.65, 5 + floor * 5, -43 + col * 14, 0.2, 2.4, 7, 0x8fa7c7);
      }
    box(35, 2.2, -5.15, 3.9, 4.4, 0.3, 0x8fa7c7);
    box(35, 5.3, -3.4, 7, 0.3, 4.4, palette.purple);
    box(35, 0.32, -2.5, 7, 0.6, 3.5, 0xc3cbd9);
    box(-27, 11.1, -4.7, 29, 4.4, 0.4, palette.deep);
    logo(-27, 11.15, -4.42, 11.6);
    sign(["CENTRO DE DISTRIBUCIÓN"], -2.6, 11.1, -4.39, 16.6, 1.35);
    for (const xSign of [-84.7, 45.75]) {
      box(xSign, 8, -29, 0.15, 7, 29, palette.deep);
      logo(xSign + 0.1, 8, -29, 20, content, Math.PI / 2);
    }
    // Protected pedestrian route, with a zebra crossing to the office.
    box(35, 0.11, 17, 4, 0.05, 33, 0xc6dece);
    for (let n = 0; n < 8; n++)
      box(35, 0.18, 36.3 + n * 0.8, 6, 0.025, 0.4, 0xf9f9fb);
    sign(["ACCESO", "CONTROLADO"], 57, 4.2, 35.8, 5.4, 2.6);
    box(56, 1.8, 33, 5, 3.6, 5, 0xf7f7fb);
    box(56, 3.8, 33, 5.8, 0.35, 5.8, palette.purple);
    box(56, 2.1, 35.6, 3.4, 1.3, 0.1, 0x9fb6d0);
    cylinder(61, 1.1, 37, 0.18, 2.2, palette.deep);
    const gateAngle = Math.PI * 0.42;
    box(62.8, 7.1, 37, 10.8, 0.12, 0.18, palette.gold, content, [
      0,
      0,
      gateAngle,
    ]);
    for (let n = 0; n < 5; n++) {
      const offset = -4 + n * 1.8;
      box(
        62.8 + Math.cos(gateAngle) * offset,
        7.1 + Math.sin(gateAngle) * offset,
        37,
        0.6,
        0.17,
        0.2,
        palette.purple,
        content,
        [0, 0, gateAngle],
      );
    }
    fence(-101, -61, 72, -61);
    fence(-101, -61, -101, 40);
    fence(-101, 40, 72, 40, [58, 74]);
    fence(72, -61, 72, 35);
    for (let n = 0; n < 7; n++) {
      tree(-94, -49 + n * 13, 0.8);
      tree(-80 + n * 21, -56, 0.8);
    }
    for (const location of [
      [-87, 27],
      [-47, 27],
      [-7, 27],
      [44, 27],
      [66, -16],
    ])
      lamp(...location);
    for (let n = 0; n < 3; n++) pallet(-76 + n * 2.5, 0, -1.5, false);
    if ((data.tasks || []).length) {
      forklift(-53, 3, Math.PI / 2);
      forklift(1, 4, -0.5);
    }
    const center = new THREE.Vector3(-28, 8, -29);
    addEntity("warehouse", {
      kind: "warehouse",
      center,
      radius: 35,
      title: data.warehouse.name || "Centro de distribución DonPepe",
    });
    addHit("warehouse", center, new THREE.Vector3(132, 18, 49));
  }

  function buildBranch(branch, index, count) {
    const row = Math.floor(index / 5),
      column = index % 5;
    const rowCount = Math.min(5, count - row * 5);
    const x = (column - (rowCount - 1) / 2) * 42,
      z = 83 + row * 59;
    const center = new THREE.Vector3(x, 4, z);
    box(x, 0.12, z, 33, 0.2, 29, 0xe7eaf1);
    box(x, 3.9, z, 27, 7.7, 17, 0xf7f6f9);
    box(x, 8.1, z, 28.4, 0.7, 18.5, palette.deep);
    box(x, 8.65, z, 25, 0.45, 15, palette.purple);
    box(x, 6.4, z + 8.72, 27.5, 2.1, 0.55, palette.purple);
    box(x, 5.2, z + 9.4, 28, 0.18, 2, palette.gold);
    // Shop fronts face the road, not the back of the diorama.
    box(x, 2.55, z + 8.62, 4.1, 4.9, 0.17, 0x97b0cc);
    for (const side of [-1, 1]) {
      box(x + side * 8.3, 2.8, z + 8.63, 8.3, 4.1, 0.19, 0x9db7d2);
      for (let q = -1; q <= 1; q++)
        box(x + side * 8.3 + q * 2.6, 2.8, z + 8.76, 0.13, 4.3, 0.05, 0xe9e8ed);
      box(x + side * 8.3, 1.5, z + 8.82, 7.5, 0.13, 0.05, 0xe9e8ed);
    }
    logo(x, 6.5, z + 9.06, 7.6, content);
    sign(
      [branch.nombre || branch.codigo || "Sucursal"],
      x,
      1.6,
      z + 10.2,
      10,
      1.35,
      content,
      0,
      "#f7f5fb",
    );
    box(x, 0.2, z + 11.4, 28.5, 0.35, 5.2, 0xd2d7e3);
    for (const side of [-1, 1]) {
      tree(x + side * 17, z + 6, 0.65);
      cylinder(x + side * 3.2, 0.65, z + 11.6, 0.13, 1.3, palette.gold);
    }
    for (let parking = 0; parking < 3; parking++) {
      box(x - 11 + parking * 10, 0.13, z + 18, 0.1, 0.03, 7, 0xf7f7fb);
      box(x - 6 + parking * 10, 0.13, z + 21.4, 10, 0.03, 0.1, 0xf7f7fb);
    }
    addEntity(`branch:${branch.id}`, {
      kind: "branch",
      branch,
      center,
      radius: 18,
      title: branch.nombre,
      stop: new THREE.Vector3(x, 0, z + 17),
    });
    addHit(`branch:${branch.id}`, center, new THREE.Vector3(29, 9, 19));
    return { x, z, row };
  }

  function createTruck(entity, index, isSupplier) {
    const group = new THREE.Group();
    content.add(group);
    const cargoColor = isSupplier ? 0xf3f2f7 : palette.white;
    box(0, 2.5, -1, 3.65, 3.4, 7.5, cargoColor, group);
    box(0, 0.7, -0.2, 3.4, 0.4, 10, 0x555467, group);
    box(0, 1.04, -1, 3.76, 0.55, 7.6, palette.purple, group);
    box(
      0,
      2.1,
      4.1,
      3.6,
      3,
      2.4,
      isSupplier ? 0xe6e9f2 : palette.purple,
      group,
    );
    box(0, 3.05, 5.32, 3.1, 1.03, 0.06, 0x566b8a, group);
    box(0, 2.45, 5.38, 3.5, 0.12, 0.13, palette.gold, group);
    box(0, 1.05, 5.44, 3.55, 0.3, 0.25, 0xd2d5df, group);
    box(0, 1.55, 5.42, 1.5, 0.55, 0.12, 0x484755, group);
    for (const side of [-1, 1]) {
      box(side * 1.82, 3.05, 4.12, 0.04, 0.95, 1.45, 0x566b8a, group);
      box(side * 2, 3.02, 4.95, 0.22, 0.4, 0.15, 0x3a3b4a, group);
      box(side * 1.31, 1.9, 5.43, 0.55, 0.4, 0.12, 0xfbf3d0, group);
      for (const axle of [-3.4, -1.8, 3.7]) {
        cylinder(side * 1.8, 0.75, axle, 0.73, 0.45, 0x3e3e4a, group, [
          0,
          0,
          Math.PI / 2,
        ]);
        cylinder(side * 2.04, 0.75, axle, 0.33, 0.035, 0xbcc3d2, group, [
          0,
          0,
          Math.PI / 2,
        ]);
      }
      box(side * 1.85, 2.55, -1, 0.04, 2.2, 5.8, palette.deep, group);
      logo(side * 1.88, 2.55, -1, 4.9, group, (side * Math.PI) / 2);
      for (let n = 0; n < 5; n++)
        box(side * 1.84, 2.5, -4 + n * 1.4, 0.02, 3.3, 0.035, 0xe1deec, group);
    }
    box(0, 2.5, -4.78, 3.5, 3.3, 0.05, 0xe2e3eb, group);
    box(0, 2.5, -4.83, 0.07, 3.3, 0.05, 0xb8b8c9, group);
    for (const side of [-1, 1])
      box(side * 1.3, 1.15, -4.83, 0.45, 0.18, 0.05, 0xd67f90, group);
    const hit = new THREE.Mesh(
      unitBox,
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    hit.position.set(0, 2.5, 0.3);
    hit.scale.set(4.4, 5.3, 11.5);
    hit.userData.entityKey = entity.key;
    group.add(hit);
    hitTargets.push(hit);
    const dock = index % 6;
    const row = Math.floor(index / 6);
    const origin = new THREE.Vector3(
      -73 + dock * 15 + row * 7.5,
      0,
      10 + row * 14,
    );
    box(
      0,
      0.12,
      0.3,
      4.5,
      0.01,
      10.9,
      mat(0x68718d, { transparent: true, opacity: 0.16, depthWrite: false }),
      group,
    );
    group.traverse((item) => {
      item.castShadow = false;
    });
    group.position.copy(origin);
    entity.group = group;
    entity.center = new THREE.Vector3()
      .copy(origin)
      .add(new THREE.Vector3(0, 3, 0));
    entity.radius = 12;
    const branch =
      !isSupplier && entities.get(`branch:${entity.order.sucursal_id}`);
    entity.route = branch?.stop ? makeRoute(origin, branch.stop) : null;
    entity.travelEligible =
      !isSupplier && entity.order.estado === "DESPACHADO" && !!entity.route;
    entity.progress = 0;
    entity.origin = origin;
    trucks.push(entity);
  }
  function makeRoute(origin, destination) {
    // Every segment follows the yard lane, access gate, public road and shop apron.
    const roadZ =
      109 + Math.max(0, Math.round((destination.z - 100) / 59)) * 59;
    const corners = [
      origin.clone(),
      new THREE.Vector3(origin.x, 0, 34),
      new THREE.Vector3(65, 0, 34),
      new THREE.Vector3(65, 0, 50),
      ...(roadZ > 50
        ? [new THREE.Vector3(106, 0, 50), new THREE.Vector3(106, 0, roadZ)]
        : []),
      new THREE.Vector3(destination.x, 0, roadZ),
      destination.clone(),
    ];
    const rounded = [corners[0]];
    for (let index = 1; index < corners.length - 1; index++) {
      const previous = corners[index - 1],
        corner = corners[index],
        next = corners[index + 1];
      const radius = Math.min(
        3.2,
        corner.distanceTo(previous) / 3,
        corner.distanceTo(next) / 3,
      );
      const incoming = corner.clone().sub(previous).normalize();
      const outgoing = next.clone().sub(corner).normalize();
      const entry = corner.clone().addScaledVector(incoming, -radius);
      const exit = corner.clone().addScaledVector(outgoing, radius);
      rounded.push(
        entry,
        ...new THREE.QuadraticBezierCurve3(entry, corner, exit)
          .getPoints(7)
          .slice(1),
      );
    }
    rounded.push(corners.at(-1));
    return rounded;
  }
  function routePoint(points, progress) {
    const lengths =
      points.segmentLengths ||
      (points.segmentLengths = points
        .slice(1)
        .map((point, index) => point.distanceTo(points[index])));
    const totalLength =
      points.totalLength ||
      (points.totalLength = lengths.reduce((sum, value) => sum + value, 0));
    const distance = Math.min(0.999999, Math.max(0, progress)) * totalLength;
    let sum = 0;
    for (let index = 0; index < lengths.length; index++) {
      if (sum + lengths[index] >= distance) {
        const direction = new THREE.Vector3()
          .subVectors(points[index + 1], points[index])
          .normalize();
        return {
          point: new THREE.Vector3().lerpVectors(
            points[index],
            points[index + 1],
            (distance - sum) / (lengths[index] || 1),
          ),
          angle: Math.atan2(direction.x, direction.z),
        };
      }
      sum += lengths[index];
    }
    return { point: points.at(-1).clone(), angle: 0 };
  }
  function buildScene() {
    if (!renderer) return;
    if (content) {
      scene.remove(content);
      content.traverse((item) => {
        if (item.isInstancedMesh) item.dispose();
        if (item.isLine && item.geometry) item.geometry.dispose();
        if (
          item.material &&
          ![...materialCache.values(), brandMaterial].includes(item.material)
        )
          item.material.dispose();
      });
      for (const texture of textures) texture.dispose();
      textures.clear();
    }
    entities.clear();
    hitTargets.length = 0;
    trucks.length = 0;
    staticBatches = new Map();
    selectedRing = null;
    hoverRing = null;
    routeLine = null;
    content = new THREE.Group();
    scene.add(content);
    const branches = data.branches
      .filter((branch) => branch.activo !== 0 && branch.activo !== false)
      .slice(0, 15);
    const rows = Math.max(1, Math.ceil(branches.length / 5));
    worldDepth = 200 + (rows - 1) * 59;
    worldCenter = new THREE.Vector3(0, 0, 32 + (rows - 1) * 29);
    box(0, -0.65, worldCenter.z, 232, 1.1, worldDepth, 0xdce4ed);
    box(0, -0.06, worldCenter.z, 230, 0.12, worldDepth - 2, 0xecf0f6);
    box(-18, 0.03, -10, 169, 0.08, 102, 0xe1e6ef);
    createRoad(0, 50, 230, 11);
    createRoad(106, 50 + (rows * 59) / 2, rows * 59, 10, true);
    for (let row = 1; row <= rows; row++) createRoad(0, 50 + row * 59, 224, 11);
    createRoad(65, 34, 30, 10, true);
    for (let n = 0; n < 10; n++) {
      tree(-100 + n * 23, 60, 0.75);
      if (n % 2 === 0) lamp(-95 + n * 23, 58, Math.PI);
    }
    buildWarehouse();
    data.branches.forEach((branch) =>
      addEntity(`branch:${branch.id}`, {
        kind: "branch",
        branch,
        title: branch.nombre,
        center: new THREE.Vector3(-28, 3, 13),
        radius: 18,
      }),
    );
    branches.forEach((branch, index) =>
      buildBranch(branch, index, branches.length),
    );
    data.orders.forEach((order) =>
      addEntity(`order:${order.id}`, {
        kind: "order",
        order,
        title: order.codigo,
        center: new THREE.Vector3(-28, 3, 13),
        radius: 15,
      }),
    );
    data.purchases.forEach((purchase) =>
      addEntity(`purchase:${purchase.id}`, {
        kind: "purchase",
        purchase,
        title: purchase.codigo_orden,
        center: new THREE.Vector3(-65, 3, 13),
        radius: 15,
      }),
    );
    // Only real documents produce selectable vehicles; there is no invented fleet.
    const outgoing = data.orders
      .filter((order) => !["CANCELADO", "CANCELADA"].includes(order.estado))
      .slice(0, 9);
    const incoming = data.purchases
      .filter(
        (purchase) =>
          !["CANCELADO", "CANCELADA", "RECIBIDA"].includes(purchase.estado),
      )
      .slice(0, 3);
    incoming.forEach((purchase, index) =>
      createTruck(entities.get(`purchase:${purchase.id}`), index, true),
    );
    outgoing.forEach((order, index) =>
      createTruck(entities.get(`order:${order.id}`), index + 3, false),
    );
    flushStatic();
    geometryCache.get("ring")?.dispose();
    const ringGeometry = new THREE.RingGeometry(0.94, 1, 64);
    geometryCache.set("ring", ringGeometry);
    selectedRing = new THREE.Mesh(
      ringGeometry,
      new THREE.MeshBasicMaterial({
        color: palette.purple,
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    selectedRing.rotation.x = -Math.PI / 2;
    selectedRing.position.y = 0.22;
    selectedRing.renderOrder = 2;
    content.add(selectedRing);
    hoverRing = new THREE.Mesh(
      ringGeometry,
      new THREE.MeshBasicMaterial({
        color: palette.gold,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    hoverRing.rotation.x = -Math.PI / 2;
    hoverRing.position.y = 0.23;
    hoverRing.visible = false;
    hoverRing.renderOrder = 2;
    content.add(hoverRing);
    selectEntity(entities.has(selectedKey) ? selectedKey : "warehouse", false);
    if (!frameCount) resetCamera(false);
    requestRender();
  }

  function init3d() {
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "default",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.02;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.shadowMap.autoUpdate = false;
      renderer.domElement.tabIndex = 0;
      renderer.domElement.setAttribute(
        "aria-label",
        "Red logística esquemática. Arrastra para girar, usa la rueda para acercar y selecciona un elemento. También puedes usar el selector y la lista accesible.",
      );
      host.append(renderer.domElement);
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0xeaf0fa);
      scene.fog = new THREE.Fog(0xeaf0fa, 270, 600);
      scene.add(new THREE.HemisphereLight(0xffffff, 0xc0c0d7, 2.2));
      const sun = new THREE.DirectionalLight(0xfff8ee, 2.5);
      sun.position.set(-60, 130, 80);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.left = -180;
      sun.shadow.camera.right = 180;
      sun.shadow.camera.top = 190;
      sun.shadow.camera.bottom = -150;
      sun.shadow.normalBias = 0.2;
      sun.shadow.bias = 0.00025;
      sun.shadow.radius = 3;
      scene.add(sun);
      const fill = new THREE.DirectionalLight(0xcfc8ff, 0.75);
      fill.position.set(100, 70, -90);
      scene.add(fill);
      camera = new THREE.PerspectiveCamera(40, 1, 0.3, 900);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.12;
      controls.minDistance = 18;
      controls.maxDistance = 420;
      controls.maxPolarAngle = Math.PI * 0.475;
      controls.minPolarAngle = 0.12;
      controls.target.copy(worldCenter);
      controls.panSpeed = 0.65;
      controls.rotateSpeed = 0.55;
      controls.zoomSpeed = 0.7;
      // Exponential interpolation replaces individual wheel jumps and remains frame-rate independent.
      controls.enableZoom = true;
      host.addEventListener(
        "wheel",
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          flight = null;
          const delta =
            event.deltaY *
            (event.deltaMode === 1
              ? 16
              : event.deltaMode === 2
                ? host.clientHeight
                : 1);
          zoomTarget = THREE.MathUtils.clamp(
            (zoomTarget ?? camera.position.distanceTo(controls.target)) *
              Math.exp(Math.max(-160, Math.min(160, delta)) * 0.002),
            18,
            420,
          );
          requestRender();
        },
        { passive: false, capture: true },
      );
      controls.addEventListener("start", () => {
        controlsMoving = true;
        flight = null;
        zoomTarget = null;
        requestRender();
      });
      controls.addEventListener("end", () => {
        controlsMoving = false;
        requestRender();
      });
      controls.addEventListener("change", () => {
        dirty = true;
        requestRender();
      });
      let down = null;
      host.addEventListener("pointerdown", (event) => {
        down = { x: event.clientX, y: event.clientY };
      });
      host.addEventListener("pointerup", (event) => {
        if (
          down &&
          Math.hypot(event.clientX - down.x, event.clientY - down.y) < 7
        ) {
          const key = pick(event);
          if (key) selectEntity(key, true);
        }
        down = null;
      });
      let lastHover = 0;
      host.addEventListener("pointermove", (event) => {
        if (down || controlsMoving || performance.now() - lastHover < 70)
          return;
        lastHover = performance.now();
        const key = pick(event);
        if (key === hoveredKey) return;
        hoveredKey = key;
        host.style.cursor = key ? "pointer" : "grab";
        const entity = entities.get(key);
        hoverRing.visible = !!entity && entity.kind !== "warehouse";
        if (entity) {
          hoverRing.position.set(entity.center.x, 0.25, entity.center.z);
          hoverRing.scale.setScalar(
            entity.kind === "warehouse"
              ? 42
              : entity.kind === "branch"
                ? 17
                : 7,
          );
        }
        requestRender();
      });
      host.addEventListener("pointerleave", () => {
        hoveredKey = null;
        if (hoverRing) hoverRing.visible = false;
        requestRender();
      });
      const texture = new THREE.TextureLoader().load(
        "/images/donpepe-logo-final-gold.png",
        () => {
          texture.colorSpace = THREE.SRGBColorSpace;
          renderer.shadowMap.needsUpdate = true;
          requestRender();
        },
      );
      brandMaterial.map = texture;
      brandMaterial.needsUpdate = true;
      new ResizeObserver(resize).observe(host);
      new IntersectionObserver(
        ([entry]) => {
          isVisible = entry.isIntersecting;
          if (isVisible) {
            previousFrame = 0;
            resize();
            requestRender();
          }
        },
        { threshold: 0.01 },
      ).observe(stage);
      document.addEventListener("visibilitychange", () => {
        previousFrame = 0;
        if (!document.hidden) requestRender();
      });
      resize();
      return true;
    } catch {
      renderer?.dispose();
      renderer = null;
      root.classList.add("ln-no-webgl");
      root.querySelector(".ln-accessible").open = true;
      text(
        "loading",
        "Tu navegador no tiene 3D disponible. Consulta los mismos datos en la lista inferior.",
      );
      find("loading").classList.add("ln-loading--fallback");
      find("play").disabled = true;
      find("label").hidden = true;
      return false;
    }
  }
  function resize() {
    if (!renderer || !host.clientWidth || !host.clientHeight) return;
    const width = host.clientWidth,
      height = host.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    requestRender();
  }
  function pick(event) {
    if (!renderer || !camera) return null;
    const rect = host.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    return (
      raycaster.intersectObjects(hitTargets, false)[0]?.object.userData
        .entityKey || null
    );
  }
  function requestRender() {
    dirty = true;
    if (
      !requestId &&
      !rendering &&
      !disposed &&
      renderer &&
      isVisible &&
      !document.hidden
    )
      requestId = requestAnimationFrame(render);
  }
  function render(now) {
    requestId = 0;
    if (
      disposed ||
      !renderer ||
      !data ||
      !isVisible ||
      document.hidden ||
      !host.clientWidth
    ) {
      previousFrame = 0;
      return;
    }
    rendering = true;
    const delta = Math.min(0.05, (now - (previousFrame || now)) / 1000);
    previousFrame = now;
    let continueAnimation = false;
    if (playing) {
      for (const truck of trucks) {
        if (!truck.travelEligible) continue;
        // After one preview the truck returns to the visual starting point, never a persisted receipt.
        truck.progress += delta / 32;
        if (truck.progress >= 1) truck.progress = 0;
        const current = routePoint(truck.route, truck.progress);
        truck.group.position.copy(current.point);
        truck.group.rotation.y = current.angle;
        truck.center.copy(current.point).add(new THREE.Vector3(0, 3, 0));
      }
      continueAnimation = true;
    }
    if (flight) {
      const progress = reducedMotion.matches
        ? 1
        : Math.min(1, (now - flight.started) / 850);
      const ease = 1 - (1 - progress) ** 3;
      camera.position.lerpVectors(flight.fromPosition, flight.position, ease);
      controls.target.lerpVectors(flight.fromTarget, flight.target, ease);
      if (progress >= 1) flight = null;
      else continueAnimation = true;
    }
    if (zoomTarget !== null) {
      const distance = camera.position.distanceTo(controls.target),
        next = THREE.MathUtils.lerp(
          distance,
          zoomTarget,
          1 - Math.exp(-delta * 18),
        );
      camera.position
        .sub(controls.target)
        .normalize()
        .multiplyScalar(next)
        .add(controls.target);
      if (Math.abs(next - zoomTarget) < 0.01) zoomTarget = null;
      else continueAnimation = true;
    }
    const controlsChanged = controls.update();
    const entity = entities.get(selectedKey);
    if (entity && selectedRing) {
      selectedRing.position.set(entity.center.x, 0.24, entity.center.z);
      if (playing && entity.travelEligible)
        selectedRing.scale.setScalar(7 * (1 + Math.sin(now * 0.003) * 0.04));
      updateFloatingLabel(entity);
    }
    if (dirty || controlsChanged || continueAnimation) {
      renderer.render(scene, camera);
      frameCount++;
      root.dataset.drawCalls = String(renderer.info.render.calls);
      root.dataset.renderedFrames = String(frameCount);
      dirty = false;
    }
    rendering = false;
    if ((continueAnimation || controlsChanged || controlsMoving) && !requestId)
      requestId = requestAnimationFrame(render);
    else previousFrame = 0;
  }
  function flyTo(target, distance = 75) {
    if (!camera) return;
    zoomTarget = null;
    const direction = new THREE.Vector3(0.7, 0.72, 1)
      .normalize()
      .multiplyScalar(distance);
    flight = {
      started: performance.now(),
      fromPosition: camera.position.clone(),
      fromTarget: controls.target.clone(),
      position: target.clone().add(direction),
      target: target.clone(),
    };
    requestRender();
  }
  function resetCamera(animate = true) {
    if (!camera) return;
    const mobile = host.clientWidth < 550;
    // A wider portrait framing leaves room for the mobile inspector below the scene.
    const target = worldCenter.clone();
    target.y = 0;
    if (mobile) target.z -= 17;
    const distance = Math.max(250, worldDepth * 1.3) * (mobile ? 1.65 : 1);
    if (animate) flyTo(target, distance);
    else {
      camera.position
        .copy(target)
        .add(
          new THREE.Vector3(0.72, 0.83, 1).normalize().multiplyScalar(distance),
        );
      controls.target.copy(target);
      controls.update();
    }
    requestRender();
  }
  function updateFloatingLabel(entity) {
    const label = find("label");
    if (!camera || entity.kind === "warehouse") {
      label.hidden = true;
      return;
    }
    projected.copy(entity.center);
    projected.y += entity.kind === "branch" ? 6 : 4;
    projected.project(camera);
    if (
      projected.z > 1 ||
      Math.abs(projected.x) > 1 ||
      Math.abs(projected.y) > 1
    ) {
      label.hidden = true;
      return;
    }
    label.hidden = false;
    label.style.left = `${((projected.x + 1) * host.clientWidth) / 2}px`;
    label.style.top = `${((-projected.y + 1) * host.clientHeight) / 2}px`;
    label.textContent =
      entity.kind === "order"
        ? `${entity.order.codigo} · ${statusLabel(entity.order.estado)}`
        : entity.title || "Sucursal";
  }
  function facts(rows) {
    const container = find("facts");
    container.replaceChildren();
    for (const [label, value] of rows) {
      const row = document.createElement("div"),
        term = document.createElement("dt"),
        detail = document.createElement("dd");
      term.textContent = label;
      detail.textContent = String(value ?? "—");
      row.append(term, detail);
      container.append(row);
    }
  }
  function actions(items) {
    const container = find("actions");
    container.replaceChildren();
    for (const [label, href] of items) {
      const link = document.createElement("a");
      link.textContent = label;
      link.href = href;
      container.append(link);
    }
  }
  function selectEntity(key, focus = false) {
    const entity = entities.get(key);
    if (!entity) return;
    selectedKey = key;
    find("selector").value = key;
    text("inspect-title", entity.title || "DonPepe");
    const pill = find("inspect-status");
    pill.dataset.status = "purple";
    let rows = [],
      links = [];
    if (entity.kind === "warehouse") {
      text("inspect-icon", "▣");
      text("inspect-kind", "CENTRO DE DISTRIBUCIÓN");
      text("inspect-status", "Datos del sistema");
      text(
        "inspect-description",
        "Recepción de proveedores, preparación y salida hacia tus sucursales. Selecciona un documento para seguir su etapa.",
      );
      rows = [
        ["Centro", data.warehouse.id || "CD1"],
        [
          "Sucursales activas",
          number(
            data.branches.filter(
              (branch) => branch.activo !== 0 && branch.activo !== false,
            ).length,
          ),
        ],
        ["Tareas pendientes", number(data.stats.pendingTasks)],
        ["En ejecución", number(data.stats.inProgressTasks)],
        ["Compras pendientes", number(data.stats.pendingPurchases)],
      ];
      links = [
        ["Entrar al almacén", "/wms/mapa?view=interior"],
        ["Ver inventario", "/wms/posiciones"],
      ];
      if (data.capabilities.plan)
        links.push(["Planificar trabajo", "/wms/tareas/nueva"]);
    } else if (entity.kind === "branch") {
      const branch = entity.branch,
        orders = data.orders.filter(
          (order) => String(order.sucursal_id) === String(branch.id),
        );
      text("inspect-icon", "⌂");
      text("inspect-kind", "SUCURSAL DONPEPE");
      text(
        "inspect-status",
        branch.activo ? "Sucursal activa" : "Sucursal inactiva",
      );
      pill.dataset.status = "";
      text(
        "inspect-description",
        branch.direccion ||
          "Ubicación esquemática. La posición no representa coordenadas geográficas.",
      );
      rows = [
        ["Código", branch.codigo],
        ["Pedidos registrados", number(orders.length)],
        [
          "En preparación",
          number(
            orders.filter((order) => order.estado === "EN_PREPARACION").length,
          ),
        ],
        [
          "Listos",
          number(orders.filter((order) => order.estado === "LISTO").length),
        ],
        [
          "Despachados",
          number(
            orders.filter((order) => order.estado === "DESPACHADO").length,
          ),
        ],
      ];
      links = [["Ver pedidos", "/wms/sucursales"]];
    } else if (entity.kind === "order") {
      const order = entity.order;
      text("inspect-icon", "▰");
      text("inspect-kind", "PEDIDO DE SUCURSAL");
      text("inspect-status", statusLabel(order.estado));
      pill.dataset.status =
        order.estado === "LISTO"
          ? ""
          : order.estado === "PENDIENTE"
            ? "warning"
            : "purple";
      text(
        "inspect-description",
        order.estado === "DESPACHADO"
          ? "El sistema confirma la salida del CD. Puedes visualizar el recorrido; no existe seguimiento GPS ni confirmación de recepción en tienda."
          : "El vehículo representa este pedido, no una posición real del camión. Permanece en el CD mientras se prepara su salida.",
      );
      rows = [
        [
          "Destino",
          order.sucursal ||
            entities.get(`branch:${order.sucursal_id}`)?.title ||
            "Sin sucursal",
        ],
        ["Unidades", number(order.unidades)],
        ["Líneas de producto", number(order.lineas)],
        ["Vehículo registrado", order.placa_vehiculo || "Sin asignar"],
        ["Guía", order.referencia_guia || "Sin registrar"],
      ];
      links = [
        ["Abrir pedido", `/wms/sucursales/${encodeURIComponent(order.id)}`],
      ];
    } else {
      const purchase = entity.purchase;
      text("inspect-icon", "↓");
      text("inspect-kind", "COMPRA A PROVEEDOR");
      text("inspect-status", statusLabel(purchase.estado));
      pill.dataset.status = "warning";
      text(
        "inspect-description",
        "Visualización de una compra pendiente de recepción. El camión es una representación del documento, no una llegada confirmada ni telemetría del proveedor.",
      );
      rows = [
        ["Proveedor", purchase.proveedor || "Sin proveedor"],
        [
          "Pendiente de recibir",
          `${number(purchase.unidades_pendientes)} unidades`,
        ],
        ["Referencia", purchase.codigo_orden],
        ["Destino", "Recepción del CD"],
      ];
      links = data.capabilities.purchasesView
        ? [["Abrir compra", `/compras/${encodeURIComponent(purchase.id)}`]]
        : [["Ver trabajo de recepción", "/wms/tareas"]];
    }
    facts(rows);
    actions(links);
    updateTimeline(entity);
    if (selectedRing) {
      selectedRing.position.set(entity.center.x, 0.24, entity.center.z);
      selectedRing.scale.setScalar(
        entity.kind === "warehouse" ? 43 : entity.kind === "branch" ? 17 : 7,
      );
      selectedRing.visible = entity.kind !== "warehouse";
    }
    if (routeLine) {
      content.remove(routeLine);
      routeLine.geometry.dispose();
      routeLine.material.dispose();
      routeLine = null;
    }
    if (entity.route && renderer) {
      const points = entity.route.map(
        (point) => new THREE.Vector3(point.x, 0.25, point.z),
      );
      routeLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineDashedMaterial({
          color: palette.purple,
          dashSize: 1.8,
          gapSize: 1,
          transparent: true,
          opacity: 0.7,
        }),
      );
      routeLine.computeLineDistances();
      content.add(routeLine);
    }
    if (focus) flyTo(entity.center, entity.kind === "warehouse" ? 180 : 80);
    if (renderer) {
      renderer.shadowMap.needsUpdate = true;
      updateFloatingLabel(entity);
      requestRender();
    }
  }
  function updateTimeline(entity) {
    const list = find("progress");
    const stages =
      entity.kind === "purchase"
        ? ["Compra", "Por recibir", "Recepción", "Ubicación", "Disponible"]
        : ["Pedido", "Preparación", "Listo", "Despachado", "Recepción"];
    let current = -1;
    if (entity.kind === "order")
      current =
        { PENDIENTE: 0, EN_PREPARACION: 1, LISTO: 2, DESPACHADO: 3 }[
          entity.order.estado
        ] ?? -1;
    if (entity.kind === "purchase")
      current = ["RECIBIDA", "PARCIAL"].includes(entity.purchase.estado)
        ? 2
        : 1;
    list.replaceChildren();
    stages.forEach((label, index) => {
      const item = document.createElement("li"),
        icon = document.createElement("i"),
        caption = document.createElement("span");
      icon.textContent = index < current ? "✓" : String(index + 1);
      caption.textContent = label;
      item.append(icon, caption);
      if (index < current) item.className = "is-complete";
      if (index === current) {
        item.className = "is-current";
        item.setAttribute("aria-current", "step");
      }
      list.append(item);
    });
    text(
      "tracking-title",
      entity.kind === "order"
        ? `${entity.order.codigo} → ${entity.order.sucursal || "Sucursal"}`
        : entity.kind === "purchase"
          ? `${entity.purchase.codigo_orden} → Centro de distribución`
          : entity.kind === "branch"
            ? `Abastecimiento de ${entity.branch.nombre}`
            : "Flujo hacia tus sucursales",
    );
    text(
      "tracking-note",
      entity.kind === "order"
        ? `Etapa real: ${statusLabel(entity.order.estado)}`
        : entity.kind === "purchase"
          ? `Estado del documento: ${statusLabel(entity.purchase.estado)}`
          : "Selecciona un pedido o una compra para ver su etapa real",
    );
    text(
      "route-note",
      entity.kind === "order" && entity.travelEligible
        ? "Recorrido ilustrativo de un pedido despachado. No acredita llegada, tiempo de transporte ni recepción."
        : entity.kind === "order"
          ? "El pedido permanece en el CD. El recorrido solo se anima cuando el sistema registra su despacho."
          : "La animación explica el recorrido; no confirma movimientos ni recepción en tienda.",
    );
    updatePlayButton();
  }
  function updatePlayButton() {
    const hasRoutes = trucks.some((truck) => truck.travelEligible);
    find("play").disabled = !hasRoutes || !renderer;
    find("play").setAttribute("aria-pressed", String(playing));
    text("play-icon", playing ? "Ⅱ" : "▶");
    text("play-label", playing ? "Pausar" : "Reproducir");
    find("play").title = hasRoutes
      ? "Reproducir recorridos ilustrativos de pedidos despachados"
      : "No hay pedidos despachados con una sucursal representada";
  }
  function populateSelector() {
    const selector = find("selector");
    selector.replaceChildren();
    const groups = [
      [
        "Almacén",
        [...entities.values()].filter((entity) => entity.kind === "warehouse"),
      ],
      [
        "Sucursales",
        [...entities.values()].filter((entity) => entity.kind === "branch"),
      ],
      [
        "Pedidos de sucursales",
        [...entities.values()].filter((entity) => entity.kind === "order"),
      ],
      [
        "Compras a proveedores",
        [...entities.values()].filter((entity) => entity.kind === "purchase"),
      ],
    ];
    for (const [title, records] of groups) {
      if (!records.length) continue;
      const group = document.createElement("optgroup");
      group.label = title;
      records.forEach((entity) => {
        const option = document.createElement("option");
        option.value = entity.key;
        option.textContent =
          entity.kind === "order"
            ? `${entity.title} · ${entity.order.sucursal || statusLabel(entity.order.estado)}`
            : entity.title;
        group.append(option);
      });
      selector.append(group);
    }
    selector.value = selectedKey;
  }
  function populateAccessibleList() {
    const list = find("list");
    list.replaceChildren();
    const categories = [
      ["Sucursales", "branch"],
      ["Pedidos de sucursales", "order"],
      ["Compras a proveedores", "purchase"],
    ];
    categories.forEach(([title, kind]) => {
      const section = document.createElement("section"),
        heading = document.createElement("h3");
      heading.textContent = title;
      section.append(heading);
      const records = [...entities.values()].filter(
        (entity) => entity.kind === kind,
      );
      if (!records.length) {
        const empty = document.createElement("p");
        empty.textContent = "No hay registros en esta consulta.";
        section.append(empty);
      }
      records.forEach((entity) => {
        const button = document.createElement("button"),
          note = document.createElement("small");
        button.type = "button";
        button.textContent = entity.title;
        note.textContent =
          kind === "order"
            ? `${entity.order.sucursal || "Sucursal"} · ${statusLabel(entity.order.estado)} · ${number(entity.order.unidades)} unidades`
            : kind === "purchase"
              ? `${entity.purchase.proveedor} · ${statusLabel(entity.purchase.estado)}`
              : entity.branch.direccion || "Posición esquemática";
        button.append(note);
        button.addEventListener("click", () => {
          selectEntity(entity.key, true);
          find("inspect-title").scrollIntoView({
            block: "nearest",
            behavior: reducedMotion.matches ? "instant" : "smooth",
          });
        });
        section.append(button);
      });
      list.append(section);
    });
    text(
      "list-count",
      `${number(data.branches.length)} sucursales · ${number(data.orders.length)} pedidos · ${number(data.purchases.length)} compras`,
    );
  }
  function addFallbackEntities() {
    entities.clear();
    addEntity("warehouse", {
      kind: "warehouse",
      center: new THREE.Vector3(),
      title: data.warehouse.name,
    });
    data.branches.forEach((branch) =>
      addEntity(`branch:${branch.id}`, {
        kind: "branch",
        branch,
        center: new THREE.Vector3(),
        title: branch.nombre,
      }),
    );
    data.orders.forEach((order) =>
      addEntity(`order:${order.id}`, {
        kind: "order",
        order,
        center: new THREE.Vector3(),
        title: order.codigo,
      }),
    );
    data.purchases.forEach((purchase) =>
      addEntity(`purchase:${purchase.id}`, {
        kind: "purchase",
        purchase,
        center: new THREE.Vector3(),
        title: purchase.codigo_orden,
      }),
    );
  }
  async function loadData() {
    find("refresh").disabled = true;
    find("error").hidden = true;
    try {
      const response = await fetch(root.dataset.endpoint, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error(
          response.status === 403
            ? "Tu cuenta no puede consultar esta red."
            : "No pudimos actualizar la red. Vuelve a intentarlo.",
        );
      const payload = await response.json();
      if (
        !payload ||
        !Array.isArray(payload.branches) ||
        !Array.isArray(payload.orders) ||
        !payload.stats
      )
        throw new Error("El servidor no devolvió la información de la red.");
      data = {
        warehouse: payload.warehouse || {
          id: "CD1",
          name: "Centro de distribución DonPepe",
        },
        suppliers: [],
        tasks: [],
        purchases: [],
        capabilities: {},
        ...payload,
      };
      for (const field of [
        "branches",
        "orders",
        "purchases",
        "tasks",
        "suppliers",
      ])
        if (!Array.isArray(data[field])) data[field] = [];
      playing = false;
      text("units", number(data.stats.units));
      text(
        "tasks",
        number(
          (Number(data.stats.pendingTasks) || 0) +
            (Number(data.stats.inProgressTasks) || 0),
        ),
      );
      text("ready", number(data.stats.readyOrders));
      text("tasks-note", `${number(data.stats.inProgressTasks)} en ejecución`);
      const date = new Date(data.generatedAt);
      text(
        "updated",
        Number.isNaN(date.getTime())
          ? "Datos del sistema"
          : `Datos ${new Intl.DateTimeFormat("es-PE", { hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" }).format(date)}`,
      );
      if (renderer) {
        buildScene();
        playing =
          !reducedMotion.matches &&
          trucks.some((truck) => truck.travelEligible);
        find("loading").hidden = true;
        renderer.shadowMap.needsUpdate = true;
      } else {
        addFallbackEntities();
        find("loading").hidden = false;
      }
      populateSelector();
      populateAccessibleList();
      selectEntity(
        entities.has(selectedKey) ? selectedKey : "warehouse",
        !!requestedOrder && frameCount < 2,
      );
      updatePlayButton();
      requestRender();
    } catch (error) {
      find("error").hidden = false;
      text(
        "error",
        error.message || "No pudimos cargar los datos del sistema.",
      );
      if (!data) {
        text(
          "loading",
          "No hay datos disponibles. Usa Actualizar para volver a intentar.",
        );
        text("updated", "Datos no disponibles");
      }
    } finally {
      find("refresh").disabled = false;
    }
  }

  find("selector").addEventListener("change", (event) =>
    selectEntity(event.target.value, true),
  );
  find("refresh").addEventListener("click", loadData);
  find("focus").addEventListener("click", () => {
    const entity = entities.get(selectedKey);
    if (entity) flyTo(entity.center, entity.kind === "warehouse" ? 180 : 80);
  });
  find("play").addEventListener("click", () => {
    playing = !playing;
    updatePlayButton();
    previousFrame = 0;
    requestRender();
  });
  root.querySelectorAll("[data-ln-camera]").forEach((button) =>
    button.addEventListener("click", () => {
      if (!camera) return;
      const action = button.dataset.lnCamera;
      if (action === "home") resetCamera();
      else if (action === "rotate") {
        const relative = camera.position
          .clone()
          .sub(controls.target)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
        flight = {
          started: performance.now(),
          fromPosition: camera.position.clone(),
          fromTarget: controls.target.clone(),
          position: controls.target.clone().add(relative),
          target: controls.target.clone(),
        };
      } else if (action === "top") {
        const target = controls.target.clone();
        flight = {
          started: performance.now(),
          fromPosition: camera.position.clone(),
          fromTarget: target.clone(),
          position: target
            .clone()
            .add(
              new THREE.Vector3(
                0,
                Math.max(90, camera.position.distanceTo(target)),
                0.5,
              ),
            ),
          target,
        };
      } else
        zoomTarget = THREE.MathUtils.clamp(
          (zoomTarget ?? camera.position.distanceTo(controls.target)) *
            (action === "in" ? 0.8 : 1.25),
          18,
          420,
        );
      requestRender();
    }),
  );
  const onMotionPreference = () => {
    if (reducedMotion.matches) {
      playing = false;
      updatePlayButton();
      requestRender();
    }
  };
  reducedMotion.addEventListener("change", onMotionPreference);
  window.addEventListener(
    "pagehide",
    (event) => {
      if (event.persisted) return;
      disposed = true;
      if (requestId) cancelAnimationFrame(requestId);
      controls?.dispose();
      renderer?.dispose();
      unitBox.dispose();
      unitCylinder.dispose();
      sphere.dispose();
      plane.dispose();
      geometryCache.forEach((geometry) => geometry.dispose());
      materialCache.forEach((material) => material.dispose());
      textures.forEach((texture) => texture.dispose());
      brandMaterial.map?.dispose();
      brandMaterial.dispose();
    },
    { once: true },
  );
  init3d();
  loadData();
}
