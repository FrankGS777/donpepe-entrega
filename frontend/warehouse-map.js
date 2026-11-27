import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  createWarehouseMaterials,
  worldBoxUV,
  industrialRoofGeometry,
} from "./warehouse-materials.js";

const root = document.getElementById("warehouseMap");
if (root) start();

function start() {
  const $ = (id) => document.getElementById(id);
  const host = $("wmapCanvas");
  const status = $("wmapStatus");
  const loading = $("wmapLoading");
  const zoneSelect = $("wmapZone");
  const aisleSelect = $("wmapAisle");
  const rackSelect = $("wmapRack");
  const skuSelect = $("wmapSku");
  const inspector = $("wmapInspectBody");
  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character],
    );
  const colors = {
    free: 0x32ad78,
    filled: 0xd9a53f,
    blocked: 0xd45661,
    moving: 0x328bc5,
  };
  const zoneColors = {
    REC: 0x4d94c8,
    "REC-F": 0x5ac3dc,
    "REC-C": 0x4d8cdc,
    QUA: 0xd6865b,
    "QUA-F": 0xbd7ba6,
    "QUA-C": 0x946db0,
    "SEC-A": 0xe0b13d,
    "SEC-B": 0xa98cca,
    "SEC-C": 0x7b9ac8,
    VEN: 0xe99549,
    FRI: 0x69bec5,
    CON: 0x5b8ac7,
    DSP: 0x66ae81,
    "DSP-F": 0x6abbb8,
    "DSP-C": 0x648dc0,
  };
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdbe2e3);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
  } catch {
    loading.textContent =
      "WebGL no está disponible. Usa el localizador de inventario.";
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentScene = new RoomEnvironment();
  const environmentTarget = pmrem.fromScene(environmentScene, 0.04);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.5;
  environmentScene.dispose();
  pmrem.dispose();
  const materialStudio = createWarehouseMaterials(renderer);
  const finishes = materialStudio.materials;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute(
    "aria-label",
    "Plano 3D. En vista de pasillo usa W, A, S y D para desplazarte.",
  );
  host.append(renderer.domElement);
  const topCamera = new THREE.OrthographicCamera(-70, 70, 70, -70, 0.1, 400);
  const walkCamera = new THREE.PerspectiveCamera(58, 1, 0.1, 400);
  let camera = topCamera;
  let controls;
  let layout;
  let tasks = [];
  let bins = new Map();
  let selected = null;
  let hovered = null;
  let indexById = new Map();
  let mode = "top";
  let active = true;
  let dirty = true;
  let flight = null;
  let binMesh;
  let cartonMesh;
  let cartonIndices = new Map();
  let roof;
  let movingIds = new Set();
  let zoomGoal = null;
  let lastFrame = 0;
  let navigating = false;
  let lastNavigation = 0;
  let pendingHover = null;
  let lastHover = 0;
  let zoneHits = [];
  let signs = [];
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pointerStart = { x: 0, y: 0 };
  const materialCache = new Map();
  const geometryCache = new Map();
  const material = (color, metalness = 0) => {
    const key = `${color}:${metalness}`;
    if (!materialCache.has(key))
      materialCache.set(
        key,
        new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness }),
      );
    return materialCache.get(key);
  };
  const geometry = (size, tileSize = 0) => {
    const key = `${size.join(":")}:${tileSize}`;
    if (!geometryCache.has(key))
      geometryCache.set(
        key,
        tileSize
          ? worldBoxUV(new THREE.BoxGeometry(...size), tileSize)
          : new THREE.BoxGeometry(...size),
      );
    return geometryCache.get(key);
  };
  function texture(kind) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = kind === "barcode" ? "#eee9da" : "#ffffff";
    ctx.fillRect(0, 0, 128, 128);
    // Deterministic grain; no external assets or large texture maps.
    for (let i = 0; i < 700; i++) {
      const x = (i * 37) % 128,
        y = (i * 79) % 128;
      ctx.fillStyle = `rgba(40,30,20,${kind === "floor" ? 0.035 : 0.075})`;
      ctx.fillRect(x, y, kind === "wood" ? 28 : 2, 1);
    }
    if (kind === "barcode") {
      ctx.fillStyle = "#25292e";
      for (let x = 14; x < 114; x += 3)
        ctx.fillRect(x, 24, ((x % 7) % 3) + 1, 60);
      ctx.font = "12px monospace";
      ctx.fillText("DON PEPE", 24, 108);
    } else if (kind === "carton") {
      ctx.fillStyle = "#e5dbbd";
      ctx.fillRect(60, 0, 9, 128);
      ctx.strokeStyle = "#8d7250";
      ctx.strokeRect(1, 1, 126, 126);
    }
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return map;
  }
  const concrete = finishes.wall;
  const steel = finishes.rack;
  const beam = finishes.beam;
  const wood = finishes.wood;
  const carton = finishes.carton;
  const green = finishes.lane;
  const yellow = material(0xecc23e);
  const sharedMaterials = new Set([
    concrete,
    steel,
    beam,
    wood,
    carton,
    green,
    yellow,
    ...Object.values(finishes),
  ]);
  const barcode = material(0xffffff);
  barcode.map = texture("barcode");
  sharedMaterials.add(barcode);
  function baseColor(bin) {
    if (!bin.active) return colors.blocked;
    if (movingIds.has(bin.id)) return colors.moving;
    return bin.occupied ? colors.filled : colors.free;
  }
  function paint(id) {
    const index = indexById.get(id);
    if (index == null || !binMesh) return;
    binMesh.setColorAt(
      index,
      new THREE.Color(
        id === selected
          ? 0xffed69
          : id === hovered
            ? 0xffffff
            : baseColor(layout.locations[index]),
      ),
    );
    binMesh.instanceColor.needsUpdate = true;
    if (cartonMesh) {
      const color = new THREE.Color(
        id === selected ? 0xffe18b : id === hovered ? 0xffecbf : 0xffffff,
      );
      for (const cartonIndex of cartonIndices.get(id) || [])
        cartonMesh.setColorAt(cartonIndex, color);
      if (cartonMesh.instanceColor) cartonMesh.instanceColor.needsUpdate = true;
    }
    dirty = true;
  }

  function box(parent, size, position, surface) {
    const mesh = new THREE.Mesh(
      geometry(size, surface.userData.tileSize),
      surface,
    );
    mesh.position.set(...position);
    mesh.receiveShadow = !surface.transparent;
    mesh.castShadow = [
      steel,
      beam,
      wood,
      carton,
      concrete,
      finishes.coldWall,
      finishes.structure,
    ].includes(surface);
    parent.add(mesh);
    return mesh;
  }
  function batch(size, entries, surface, colorFor) {
    if (!entries.length) return null;
    const mesh = new THREE.InstancedMesh(
      geometry(size, surface.userData.tileSize),
      surface,
      entries.length,
    );
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.castShadow = [
      steel,
      beam,
      wood,
      carton,
      concrete,
      finishes.coldWall,
      finishes.structure,
    ].includes(surface);
    mesh.receiveShadow = !surface.transparent;
    const matrix = new THREE.Matrix4();
    entries.forEach((item, index) => {
      matrix.compose(
        new THREE.Vector3(item.x, item.y, item.z),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(item.rx || 0, item.ry || 0, item.rz || 0),
        ),
        new THREE.Vector3(item.sx || 1, item.sy || 1, item.sz || 1),
      );
      mesh.setMatrixAt(index, matrix);
      if (colorFor) mesh.setColorAt(index, new THREE.Color(colorFor(item)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
    return mesh;
  }
  function label(value, x, y, z, color = "#173b56") {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 72;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 320, 72);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 33px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(value, 160, 38, 300);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        depthTest: mode === "perspective",
        depthWrite: false,
      }),
    );
    sprite.position.set(x, y, z);
    sprite.scale.set(4.2, 0.94, 1);
    scene.add(sprite);
    signs.push(sprite);
  }
  function wallWithDoor(zone) {
    const cold = ["CAMARA_FRIA", "CAMARA_CONGELADA", "JAULA_CONTROL"].includes(
      zone.structure,
    );
    if (!cold) return;
    const wallFinish = zone.structure.startsWith("CAMARA")
      ? finishes.coldWall
      : concrete;
    const h = zone.structure === "JAULA_CONTROL" ? 4 : 6.3;
    const halfX = zone.width / 2;
    const halfZ = zone.depth / 2;
    const south = zone.z - halfZ;
    const door = Math.min(3.2, zone.width / 3);
    const segment = (zone.width - door) / 2;
    box(
      scene,
      [segment, h, 0.18],
      [zone.x - halfX + segment / 2, h / 2, south],
      wallFinish,
    );
    box(
      scene,
      [segment, h, 0.18],
      [zone.x + halfX - segment / 2, h / 2, south],
      wallFinish,
    );
    box(scene, [door, 0.45, 0.18], [zone.x, h - 0.225, south], steel);
    for (const dx of [-door / 2, door / 2])
      box(
        scene,
        [0.12, 3.3, 0.35],
        [zone.x + dx, 1.65, south],
        material(0x7f929c, 0.5),
      );
    box(
      scene,
      [door, 0.12, 0.35],
      [zone.x, 3.3, south],
      material(0x7f929c, 0.5),
    );
    box(
      scene,
      [door, h - 3.4, 0.2],
      [zone.x, (h + 3.4) / 2, south],
      wallFinish,
    );
    // Puerta corredera aislada aparcada a un lado; acceso físico libre.
    const doorPanel = box(
      scene,
      [door * 0.88, 3.1, 0.22],
      [zone.x + door * 0.95, 1.6, south - 0.24],
      finishes.coldWall,
    );
    doorPanel.receiveShadow = true;
    box(
      scene,
      [0.06, 0.8, 0.16],
      [zone.x + door * 0.65, 1.3, south - 0.43],
      finishes.galvanized,
    );
    box(
      scene,
      [door * 1.9, 0.08, 0.14],
      [zone.x + door * 0.45, 3.35, south - 0.28],
      finishes.galvanized,
    );
    label(
      zone.structure === "CAMARA_CONGELADA"
        ? "CONGELADOS"
        : zone.structure === "CAMARA_FRIA"
          ? "REFRIGERADOS"
          : "CONTROL",
      zone.x,
      3.9,
      south - 0.3,
      "#226080",
    );
    box(
      scene,
      [zone.width, h, 0.18],
      [zone.x, h / 2, zone.z + halfZ],
      wallFinish,
    );
    box(
      scene,
      [0.18, h, zone.depth],
      [zone.x - halfX, h / 2, zone.z],
      wallFinish,
    );
    box(
      scene,
      [0.18, h, zone.depth],
      [zone.x + halfX, h / 2, zone.z],
      wallFinish,
    );
    if (zone.structure.startsWith("CAMARA")) {
      for (let i = 0; i < 3; i++)
        box(
          scene,
          [1.8, 0.65, 0.8],
          [zone.x - halfX + 1.5 + i * 2.5, h - 0.65, zone.z + halfZ - 0.75],
          steel,
        );
      for (let i = 0; i < 3; i++) {
        const fan = new THREE.Mesh(
          new THREE.CylinderGeometry(0.2, 0.2, 0.07, 10),
          material(0x253c47, 0.6),
        );
        fan.rotation.x = Math.PI / 2;
        fan.position.set(
          zone.x - halfX + 1.5 + i * 2.5,
          h - 0.65,
          zone.z + halfZ - 1.2,
        );
        scene.add(fan);
      }
      const ceiling = box(
        roof,
        [zone.width, 0.12, zone.depth],
        [zone.x, h + 0.08, zone.z],
        finishes.coldWall,
      );
      ceiling.userData.roof = true;
    }
  }
  function build() {
    scene.traverse((object) => {
      if (
        object.geometry &&
        ![...geometryCache.values()].includes(object.geometry)
      )
        object.geometry.dispose();
      if (object.isSprite) object.material?.map?.dispose();
      if (object.isLight) {
        object.shadow?.map?.dispose();
        object.shadow?.mapPass?.dispose();
      }
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      materials.forEach((surface) => {
        if (
          surface &&
          !sharedMaterials.has(surface) &&
          ![...materialCache.values()].includes(surface)
        )
          surface.dispose();
      });
    });
    scene.clear();
    signs = [];
    bins = new Map(layout.locations.map((bin) => [bin.id, bin]));
    movingIds = new Set(
      tasks
        .filter((t) => t.state === "EN_PROCESO")
        .flatMap((t) => [t.originId, t.destinationId]),
    );
    zoneHits = [];
    scene.add(new THREE.HemisphereLight(0xeaf2fa, 0x6e7778, 0.7));
    const sun = new THREE.DirectionalLight(0xfff1dd, 2.4);
    sun.position.set(layout.width / 2 - 50, 100, layout.depth / 2 + 35);
    sun.target.position.set(layout.width / 2, 0, layout.depth / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, {
      left: -120,
      right: 120,
      top: 120,
      bottom: -120,
      near: 1,
      far: 260,
    });
    sun.shadow.bias = -0.00008;
    sun.shadow.normalBias = 0.08;
    sun.shadow.camera.updateProjectionMatrix();
    scene.add(sun.target);
    scene.add(sun);
    renderer.shadowMap.needsUpdate = true;
    box(
      scene,
      [layout.width + 4, 0.12, layout.depth + 4],
      [layout.width / 2, -0.1, layout.depth / 2],
      finishes.floor,
    );
    // Calle central y circulaciones: no atraviesan las cámaras cerradas.
    for (const path of [
      [layout.width - 8, 3.2, layout.width / 2, 26],
      [layout.width - 8, 3.2, layout.width / 2, 90],
      [layout.width - 8, 3.2, layout.width / 2, 127.5],
      [3.4, 64, 43, 58],
      [3.4, 64, 93, 58],
      [3.4, 64, 143, 58],
    ]) {
      box(scene, [path[0], 0.025, path[1]], [path[2], 0.015, path[3]], green);
      if (path[0] > path[1])
        for (let x = 6; x < layout.width - 3; x += 6)
          box(scene, [2.2, 0.028, 0.09], [x, 0.04, path[3]], yellow);
      for (const sign of [-1, 1])
        box(
          scene,
          path[0] > path[1] ? [path[0], 0.027, 0.09] : [0.09, 0.027, path[1]],
          [
            path[2] + (path[0] < path[1] ? (sign * path[0]) / 2 : 0),
            0.05,
            path[3] + (path[0] > path[1] ? (sign * path[1]) / 2 : 0),
          ],
          yellow,
        );
    }
    // Perímetro con tres portones; las bahías de carga están al sur.
    for (const [from, to] of [
      [0, 91],
      [99, 109],
      [117, 145],
      [160, 184],
    ])
      box(
        scene,
        [to - from, 3.2, 0.24],
        [(from + to) / 2, 1.6, layout.depth],
        concrete,
      );
    for (const dockX of [95, 113, 152]) {
      box(scene, [7, 0.08, 4], [dockX, 0.04, layout.depth - 2], green);
      box(scene, [8, 0.12, 0.24], [dockX, 3.2, layout.depth], steel);
    }
    // Marcos, amortiguadores y hojas enrolladas hacen legibles los accesos.
    const dockJambs = [],
      dockRubbers = [],
      doorSlats = [],
      bollards = [],
      dockSteps = [];
    const entries = [
      { x: 16, z: 0, w: 8 },
      { x: 42.5, z: 0, w: 9 },
      { x: 83.5, z: 0, w: 9 },
      { x: 133, z: 0, w: 10 },
      { x: 174, z: 0, w: 10 },
      { x: 95, z: layout.depth, w: 8 },
      { x: 113, z: layout.depth, w: 8 },
      { x: 152.5, z: layout.depth, w: 15 },
    ];
    entries.forEach((entry, i) => {
      for (const side of [-1, 1]) {
        dockJambs.push({
          x: entry.x + side * (entry.w / 2 - 0.12),
          y: 2,
          z: entry.z,
        });
        dockRubbers.push({
          x: entry.x + side * (entry.w / 2 - 0.4),
          y: 1.05,
          z: entry.z + (entry.z ? -0.23 : 0.23),
        });
        bollards.push({
          x: entry.x + side * (entry.w / 2 - 0.55),
          y: 0.65,
          z: entry.z + (entry.z ? -1 : 1),
        });
      }
      for (let y = 3.55; y < 4.3; y += 0.12)
        doorSlats.push({ x: entry.x, y, z: entry.z, sx: entry.w - 0.32 });
      dockSteps.push({
        x: entry.x,
        y: 0.02,
        z: entry.z + (entry.z ? -1.1 : 1.1),
        sx: entry.w - 1,
      });
      label(
        (entry.z ? "SALIDA " : "ENTRADA ") + String(i + 1).padStart(2, "0"),
        entry.x,
        4.8,
        entry.z + (entry.z ? -0.3 : 0.3),
        entry.z ? "#236c52" : "#215c90",
      );
    });
    batch([0.24, 4, 0.45], dockJambs, finishes.galvanized);
    batch([0.24, 2.1, 0.35], dockRubbers, material(0x252c32));
    batch([1, 0.08, 0.18], doorSlats, finishes.galvanized);
    batch([0.18, 1.3, 0.18], bollards, yellow);
    batch([1, 0.035, 1.8], dockSteps, finishes.galvanized);
    box(scene, [0.24, 3.2, layout.depth], [0, 1.6, layout.depth / 2], concrete);
    box(
      scene,
      [0.24, 3.2, layout.depth],
      [layout.width, 1.6, layout.depth / 2],
      concrete,
    );
    for (const [from, to] of [
      [0, 12],
      [20, 38],
      [47, 79],
      [88, 128],
      [138, 169],
      [179, 184],
    ])
      box(scene, [to - from, 3.2, 0.24], [(from + to) / 2, 1.6, 0], concrete);
    roof = new THREE.Group();
    roof.visible = mode === "perspective";
    scene.add(roof);
    // En planta, la envolvente es un corte a 3,2 m para no ocultar las LOC.
    // En pasillo se completa hasta la cubierta; los portones siguen abiertos.
    for (const [z, segments] of [
      [
        layout.depth,
        [
          [0, 91],
          [99, 109],
          [117, 145],
          [160, 184],
        ],
      ],
      [
        0,
        [
          [0, 12],
          [20, 38],
          [47, 79],
          [88, 128],
          [138, 169],
          [179, 184],
        ],
      ],
    ])
      for (const [from, to] of segments) {
        box(
          roof,
          [to - from, 5.65, 0.24],
          [(from + to) / 2, 6.025, z],
          concrete,
        );
        box(
          scene,
          [to - from, 0.32, 0.27],
          [(from + to) / 2, 0.16, z],
          finishes.skirting,
        );
      }
    for (const x of [0, layout.width]) {
      box(
        roof,
        [0.24, 5.65, layout.depth],
        [x, 6.025, layout.depth / 2],
        concrete,
      );
      box(
        scene,
        [0.27, 0.32, layout.depth],
        [x, 0.16, layout.depth / 2],
        finishes.skirting,
      );
    }
    // Cerchas y luminarias en lotes de geometría compartida; sin luces por LED.
    const roofRails = [],
      roofBraces = [],
      ledRows = [],
      suspensionRows = [];
    for (let z = 0; z <= layout.depth; z += 12) {
      box(
        roof,
        [layout.width, 0.12, 0.14],
        [layout.width / 2, 8.7, z],
        finishes.structure,
      );
      for (let x = 8; x < layout.width; x += 16) {
        ledRows.push({ x, y: 8.3, z });
        suspensionRows.push({ x, y: 8.62, z });
      }
      for (let x = 3; x < layout.width - 3; x += 6) {
        const width = Math.min(6, layout.width - 3 - x);
        roofBraces.push({
          x: x + width / 2,
          y: 9.04,
          z,
          sy: Math.hypot(width, 0.68),
          rz: Math.atan2(width, 0.68),
        });
      }
    }
    for (let x = 4; x < layout.width; x += 8)
      roofRails.push({ x, y: 8.9, z: layout.depth / 2 });
    for (const [size, rows, surface] of [
      [[0.09, 0.12, layout.depth], roofRails, finishes.structure],
      [[0.045, 1, 0.045], roofBraces, finishes.structure],
      [[1.6, 0.08, 0.34], ledRows, finishes.led],
      [[0.018, 0.58, 0.018], suspensionRows, finishes.structure],
    ]) {
      const mesh = batch(size, rows, surface);
      if (mesh) roof.attach(mesh);
    }
    roof.add(
      new THREE.Mesh(
        industrialRoofGeometry(layout.width, layout.depth),
        finishes.roof,
      ),
    );
    const pillars = [];
    for (let x = 0; x <= layout.width; x += 23)
      for (const z of [0, 90, layout.depth]) pillars.push({ x, y: 4.5, z });
    batch([0.32, 9, 0.32], pillars, concrete);
    layout.zones.forEach((zone) => {
      const surface = new THREE.Mesh(
        new THREE.PlaneGeometry(zone.width - 0.2, zone.depth - 0.2),
        new THREE.MeshStandardMaterial({
          color: zoneColors[zone.code] || 0x9b82a6,
          transparent: true,
          opacity: 0.13,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      surface.rotation.x = -Math.PI / 2;
      surface.position.set(zone.x, 0.04, zone.z);
      surface.userData = { zoneId: zone.id };
      surface.receiveShadow = true;
      scene.add(surface);
      zoneHits.push(surface);
      label(zone.code, zone.x, 0.7, zone.z - zone.depth / 2 + 1.15);
      wallWithDoor(zone);
    });
    const racks = new Map();
    const zonesById = new Map(layout.zones.map((zone) => [zone.id, zone]));
    for (const bin of layout.locations) {
      const structure = zonesById.get(bin.zoneId)?.structure;
      if (structure === "MUELLE") continue;
      if (!racks.has(bin.rackKey)) racks.set(bin.rackKey, []);
      racks.get(bin.rackKey).push(bin);
    }
    const posts = [];
    const shelves = [];
    const rails = [],
      braces = [],
      guards = [];
    const aisles = new Map();
    for (const bin of layout.locations) {
      if (zonesById.get(bin.zoneId)?.structure === "MUELLE") continue;
      const key = `${bin.zoneId}:${bin.aisle}`;
      if (!aisles.has(key)) aisles.set(key, []);
      aisles.get(key).push(bin);
    }
    const laneRows = [],
      laneEdges = [];
    for (const row of aisles.values()) {
      const first = row[0],
        area = zonesById.get(first.zoneId);
      const laneX = Math.min(...row.map((bin) => bin.x)) - 2.1;
      const from = Math.min(...row.map((bin) => bin.z)) - 1.3,
        to = Math.max(...row.map((bin) => bin.z)) + 1.3;
      const width = Math.min(
        2.6,
        Math.max(1.7, area.width / area.aisleCount - 2.8),
      );
      laneRows.push({
        x: laneX,
        y: 0.055,
        z: (from + to) / 2,
        sx: width,
        sz: to - from,
      });
      for (const dx of [-width / 2, width / 2])
        laneEdges.push({
          x: laneX + dx,
          y: 0.06,
          z: (from + to) / 2,
          sz: to - from,
        });
      label(`${first.zoneCode} · A${first.aisle}`, laneX, 2.8, from, "#235a71");
    }
    batch([1, 0.01, 1], laneRows, green);
    batch([0.055, 0.01, 1], laneEdges, yellow);
    for (const group of racks.values()) {
      const rack = group[0];
      const centerX = group.reduce((sum, bin) => sum + bin.x, 0) / group.length;
      const centerZ = group.reduce((sum, bin) => sum + bin.z, 0) / group.length;
      const levels = rack.visualRackLevels;
      const width =
        Math.max(...group.map((bin) => bin.x)) -
        Math.min(...group.map((bin) => bin.x)) +
        1.18;
      const depth =
        Math.max(...group.map((bin) => bin.z)) -
        Math.min(...group.map((bin) => bin.z)) +
        1.18;
      for (const dx of [-width / 2, width / 2])
        for (const dz of [-depth / 2, depth / 2]) {
          posts.push({
            x: centerX + dx,
            y: (levels * 1.6 + 0.25) / 2,
            z: centerZ + dz,
            height: levels * 1.6 + 0.25,
          });
          guards.push({ x: centerX + dx, y: 0.18, z: centerZ + dz });
        }
      for (let i = 0; i <= levels; i++) {
        shelves.push({
          x: centerX,
          y: 0.14 + i * 1.6,
          z: centerZ,
          width,
          depth,
        });
        for (const dx of [-width / 2, width / 2])
          rails.push({
            x: centerX + dx,
            y: 0.13 + i * 1.6,
            z: centerZ,
            sz: depth,
          });
      }
      for (const dz of [-depth / 2, depth / 2])
        for (let i = 0; i < levels; i++)
          braces.push({
            x: centerX,
            y: 0.8 + i * 1.6,
            z: centerZ + dz,
            sy: Math.hypot(width, 1.6),
            rz: Math.atan2(width, 1.6) * (i % 2 ? -1 : 1),
          });
    }
    const anchorPlates = posts.map((p) => ({ x: p.x, y: 0.05, z: p.z }));
    const anchors = posts.flatMap((p) =>
      [-0.085, 0.085].flatMap((dx) =>
        [-0.085, 0.085].map((dz) => ({ x: p.x + dx, y: 0.09, z: p.z + dz })),
      ),
    );
    const connectors = posts.flatMap((p) =>
      Array.from(
        { length: Math.max(1, Math.floor(p.height / 1.6)) },
        (_, i) => ({ x: p.x, y: 0.16 + i * 1.6, z: p.z - 0.06 }),
      ),
    );
    batch([0.28, 0.035, 0.28], anchorPlates, finishes.galvanized);
    batch([0.027, 0.026, 0.027], anchors, finishes.galvanized);
    batch([0.14, 0.19, 0.04], connectors, beam);
    // Perforaciones de los montantes; geometría instanciada, sin miles de objetos.
    const holes = posts.flatMap((p) =>
      Array.from({ length: Math.floor(p.height / 0.23) }, (_, i) => ({
        x: p.x,
        y: 0.35 + i * 0.23,
        z: p.z - 0.052,
      })),
    );
    batch([0.024, 0.07, 0.007], holes, material(0x183646));
    const postGroups = new Map();
    posts.forEach((post) => {
      const height = post.height.toFixed(2);
      if (!postGroups.has(height)) postGroups.set(height, []);
      postGroups.get(height).push(post);
    });
    postGroups.forEach((rows, height) =>
      batch([0.1, Number(height), 0.1], rows, steel),
    );
    // Las bandejas se agrupan por tamaño para compartir geometría y evitar miles de draw calls.
    const shelfGroups = new Map();
    shelves.forEach((shelf) => {
      const key = `${shelf.width.toFixed(2)}|${shelf.depth.toFixed(2)}`;
      if (!shelfGroups.has(key)) shelfGroups.set(key, []);
      shelfGroups.get(key).push(shelf);
    });
    shelfGroups.forEach((rows) =>
      batch([rows[0].width, 0.055, rows[0].depth], rows, finishes.galvanized),
    );
    batch([0.1, 0.15, 1], rails, beam);
    batch([0.045, 1, 0.045], braces, steel);
    batch([0.2, 0.36, 0.2], guards, yellow);
    const markerRows = layout.locations.map((bin) => ({
      ...bin,
      y: 0.24 + (bin.level - 1) * 1.6,
    }));
    indexById = new Map(layout.locations.map((bin, index) => [bin.id, index]));
    const binSurface = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.48,
      roughness: 0.8,
      depthWrite: false,
    });
    binMesh = batch([1.12, 0.025, 1.1], markerRows, binSurface, baseColor);
    binMesh.userData.kind = "bin";
    const cartons = markerRows.filter((bin) => bin.stock?.length);
    const boxRows = cartons.flatMap((bin) =>
      Array.from({ length: 8 }, (_, i) => ({
        x: bin.x + ((i % 2) - 0.5) * 0.49,
        y: bin.y + 0.38 + Math.floor(i / 4) * 0.49,
        z: bin.z + ((Math.floor(i / 2) % 2) - 0.5) * 0.49,
        id: bin.id,
      })),
    );
    cartonMesh = batch([0.47, 0.47, 0.47], boxRows, carton, () => 0xffffff);
    if (cartonMesh) {
      if (!geometryCache.has("rounded-carton"))
        geometryCache.set(
          "rounded-carton",
          new RoundedBoxGeometry(0.47, 0.47, 0.47, 2, 0.006),
        );
      cartonMesh.geometry = geometryCache.get("rounded-carton");
    }
    cartonIndices = new Map();
    boxRows.forEach((row, index) => {
      if (!cartonIndices.has(row.id)) cartonIndices.set(row.id, []);
      cartonIndices.get(row.id).push(index);
    });
    if (cartonMesh) {
      cartonMesh.userData.kind = "carton";
      cartonMesh.userData.binIds = boxRows.map((bin) => bin.id);
    }
    const palletRows = cartons.flatMap((bin) =>
      [-0.44, -0.22, 0, 0.22, 0.44].map((dz) => ({
        x: bin.x,
        y: bin.y + 0.09,
        z: bin.z + dz,
      })),
    );
    batch([1.12, 0.06, 0.18], palletRows, wood);
    batch(
      [0.16, 0.12, 1.05],
      cartons.flatMap((bin) =>
        [-0.42, 0, 0.42].map((dx) => ({
          x: bin.x + dx,
          y: bin.y + 0.02,
          z: bin.z,
        })),
      ),
      wood,
    );
    batch(
      [0.15, 0.13, 0.15],
      cartons.flatMap((bin) =>
        [-0.43, 0, 0.43].flatMap((dx) =>
          [-0.43, 0, 0.43].map((dz) => ({
            x: bin.x + dx,
            y: bin.y + 0.02,
            z: bin.z + dz,
          })),
        ),
      ),
      wood,
    );
    batch(
      [1.12, 0.025, 0.12],
      cartons.flatMap((bin) =>
        [-0.43, 0, 0.43].map((dz) => ({
          x: bin.x,
          y: bin.y - 0.055,
          z: bin.z + dz,
        })),
      ),
      wood,
    );
    // Código de barras frontal, geometría ligera compartida por todas las cajas ocupadas.
    const stripe = boxRows.map((bin) => ({
      x: bin.x - 0.24,
      y: bin.y,
      z: bin.z,
      ry: Math.PI / 2,
    }));
    batch([0.23, 0.15, 0.012], stripe, barcode);
    tasks
      .filter((task) => bins.has(task.originId) && bins.has(task.destinationId))
      .slice(0, 40)
      .forEach((task) => {
        const from = bins.get(task.originId),
          to = bins.get(task.destinationId);
        const points = [
          new THREE.Vector3(from.x, 0.22, from.z),
          new THREE.Vector3(from.x, 0.22, 90),
          new THREE.Vector3(to.x, 0.22, 90),
          new THREE.Vector3(to.x, 0.22, to.z),
        ];
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineDashedMaterial({
            color: task.state === "EN_PROCESO" ? 0x2b8ec4 : 0xc9a146,
            dashSize: 0.5,
            gapSize: 0.35,
            transparent: true,
            opacity: 0.78,
          }),
        );
        line.computeLineDistances();
        scene.add(line);
      });
    resize();
    controls?.dispose();
    setupControls();
    frame(null, false);
    status.textContent = `${layout.zones.length} zonas · ${layout.locations.length} LOC · ${cartons.length} HU con stock`;
    dirty = true;
  }
  function setupControls() {
    controls = new MapControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.085;
    controls.enableRotate = true;
    controls.minDistance = 0.6;
    controls.maxDistance = 300;
    controls.minZoom = 0.35;
    controls.maxZoom = 40;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.panSpeed = 0.8;
    controls.rotateSpeed = 0.65;
    controls.addEventListener("start", () => {
      navigating = true;
      flight = null;
      zoomGoal = null;
    });
    controls.addEventListener("end", () => {
      navigating = false;
      lastNavigation = performance.now();
    });
    controls.addEventListener("change", () => {
      dirty = true;
    });
  }
  // Wheel interpolation runs once per frame; raycasting is suspended while moving.
  renderer.domElement.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!controls || !layout) return;
      flight = null;
      lastNavigation = performance.now();
      pendingHover = null;
      const delta = THREE.MathUtils.clamp(
        event.deltaY *
          (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 500 : 1),
        -160,
        160,
      );
      const base =
        zoomGoal ??
        (mode === "top"
          ? camera.zoom
          : camera.position.distanceTo(controls.target));
      zoomGoal =
        mode === "top"
          ? THREE.MathUtils.clamp(base * Math.exp(-delta * 0.0018), 0.35, 40)
          : THREE.MathUtils.clamp(base * Math.exp(delta * 0.0018), 0.6, 300);
      dirty = true;
    },
    { passive: false, capture: true },
  );
  function resize() {
    const width = Math.max(1, host.clientWidth),
      height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    const aspect = width / height;
    topCamera.left = -82 * aspect;
    topCamera.right = 82 * aspect;
    topCamera.top = 82;
    topCamera.bottom = -82;
    topCamera.updateProjectionMatrix();
    walkCamera.aspect = aspect;
    walkCamera.updateProjectionMatrix();
    dirty = true;
  }
  function frame(target, animate = true) {
    if (!layout || !controls) return;
    const x = target?.x ?? layout.width / 2;
    const z = target?.z ?? layout.depth / 2;
    const span =
      target?.width || target?.depth || Math.max(layout.width, layout.depth);
    let next =
      mode === "top"
        ? new THREE.Vector3(
            x + span * 0.36,
            Math.max(18, span * 0.75),
            z + span * 0.34,
          )
        : new THREE.Vector3(
            x + Math.min(5, span * 0.12),
            2.3,
            z + Math.max(4, Math.min(11, span * 0.28)),
          );
    const look = new THREE.Vector3(x, mode === "top" ? 0 : 1.65, z);
    if (mode === "perspective" && target?.level) {
      look.y = 0.7 + (target.level - 1) * 1.6;
      next = new THREE.Vector3(x - 2.8, look.y + 0.3, z + 1.8);
    } else if (mode === "perspective" && target?.id) {
      const first = layout.locations.find((bin) => bin.zoneId === target.id);
      if (first) {
        next.set(first.x - 2.4, 2.3, first.z + 5);
        look.set(first.x - 1.4, 1.8, first.z - 3);
      }
    }
    let zoom = 1;
    if (mode === "top") {
      // Ajustar las ocho esquinas proyectadas: el encuadre isométrico de una
      // nave rectangular no cabe usando sólo su lado mayor como diámetro.
      const fit = topCamera.clone();
      fit.zoom = 1;
      fit.position.copy(next);
      fit.lookAt(look);
      fit.updateMatrixWorld(true);
      fit.updateProjectionMatrix();
      const width = target?.width || layout.width,
        depth = target?.depth || layout.depth;
      let projected = 0;
      for (const dx of [-width / 2, width / 2])
        for (const dz of [-depth / 2, depth / 2])
          for (const y of [0, 8.5]) {
            const corner = new THREE.Vector3(x + dx, y, z + dz).project(fit);
            projected = Math.max(
              projected,
              Math.abs(corner.x),
              Math.abs(corner.y),
            );
          }
      zoom = THREE.MathUtils.clamp(1 / (projected * 1.14), 0.35, 14);
    }
    zoomGoal = null;
    if (animate)
      flight = {
        started: performance.now(),
        origin: camera.position.clone(),
        destination: next,
        from: controls.target.clone(),
        to: look,
        zoomFrom: topCamera.zoom,
        zoomTo: zoom,
      };
    else {
      camera.position.copy(next);
      controls.target.copy(look);
      topCamera.zoom = zoom;
      topCamera.updateProjectionMatrix();
      controls.update();
    }
    dirty = true;
  }
  function setView(next) {
    if (mode === next || !layout) return;
    const point = selected ? bins.get(selected) : null;
    const old = camera;
    const oldTarget = controls.target.clone();
    mode = next;
    scene.fog =
      mode === "perspective" ? new THREE.Fog(0xdbe2e3, 50, 180) : null;
    signs.forEach((sign) => {
      sign.material.depthTest = mode === "perspective";
      sign.material.needsUpdate = true;
    });
    camera = mode === "top" ? topCamera : walkCamera;
    camera.position.copy(old.position);
    roof.visible = mode === "perspective";
    renderer.shadowMap.needsUpdate = true;
    controls.dispose();
    setupControls();
    controls.target.copy(oldTarget);
    frame(point || null);
    $("wmapTop").classList.toggle("active", mode === "top");
    $("wmapPerspective").classList.toggle("active", mode === "perspective");
    $("wmapTop").setAttribute("aria-pressed", String(mode === "top"));
    $("wmapPerspective").setAttribute(
      "aria-pressed",
      String(mode === "perspective"),
    );
  }
  function options(select, choices, placeholder) {
    const current = select.value;
    select.replaceChildren(new Option(placeholder, ""));
    choices.forEach(([text, value]) => select.add(new Option(text, value)));
    if (choices.some(([, value]) => value === current)) select.value = current;
  }
  function selectors() {
    options(
      zoneSelect,
      layout.zones.map((zone) => [
        `${zone.code} · ${zone.name}`,
        String(zone.id),
      ]),
      "Todas las zonas",
    );
    const zone = Number(zoneSelect.value),
      aisle = aisleSelect.value;
    const areaBins = layout.locations.filter(
      (bin) => !zone || bin.zoneId === zone,
    );
    options(
      aisleSelect,
      zone
        ? [
            ...new Map(
              areaBins.map((bin) => [
                `${bin.zoneId}|${bin.aisle}`,
                [
                  `${bin.zoneCode} · A${bin.aisle}`,
                  `${bin.zoneId}|${bin.aisle}`,
                ],
              ]),
            ).values(),
          ]
        : [],
      zone ? "Todos los pasillos" : "Selecciona una zona",
    );
    aisleSelect.disabled = !zone;
    options(
      rackSelect,
      aisle
        ? [
            ...new Map(
              areaBins
                .filter((bin) => `${bin.zoneId}|${bin.aisle}` === aisle)
                .map((bin) => [
                  bin.rackKey,
                  [`A${bin.aisle} · R${bin.rack}`, bin.rackKey],
                ]),
            ).values(),
          ]
        : [],
      aisle ? "Todos los racks" : "Selecciona un pasillo",
    );
    rackSelect.disabled = !aisle;
    options(
      skuSelect,
      [
        ...new Map(
          areaBins.flatMap((bin) =>
            bin.stock.map((item) => [
              item.sku,
              [`${item.sku} · ${item.product}`, item.sku],
            ]),
          ),
        ).values(),
      ],
      "Todos los SKU",
    );
    renderList();
  }
  function renderList() {
    const zone = Number(zoneSelect.value),
      aisle = aisleSelect.value,
      rack = rackSelect.value,
      sku = skuSelect.value;
    const matches = layout.locations.filter(
      (bin) =>
        (!zone || bin.zoneId === zone) &&
        (!aisle || `${bin.zoneId}|${bin.aisle}` === aisle) &&
        (!rack || bin.rackKey === rack) &&
        (!sku || bin.stock.some((item) => item.sku === sku)),
    );
    const list = $("wmapLocationList");
    list.replaceChildren();
    matches.slice(0, 60).forEach((bin) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wmap-list-loc";
      button.dataset.locId = String(bin.id);
      button.innerHTML = `<strong>${escape(bin.code)}</strong><span>${bin.occupied ? "Ocupado" : "Libre"} · ${bin.units} UND</span>`;
      list.append(button);
    });
    $("wmapListTitle").textContent =
      `Ubicaciones · ${matches.length} coincidencias (primeras 60)`;
  }
  function inspect(id, move = true) {
    const bin = bins.get(Number(id));
    if (!bin) return;
    const previous = selected;
    selected = bin.id;
    if (previous && previous !== selected) paint(previous);
    paint(selected);
    root.querySelector(".wmap-shell").classList.add("has-inspection");
    $("wmapInspectCode").textContent = bin.code;
    zoneSelect.value = String(bin.zoneId);
    selectors();
    aisleSelect.value = `${bin.zoneId}|${bin.aisle}`;
    selectors();
    rackSelect.value = bin.rackKey;
    renderList();
    document
      .querySelectorAll(".wmap-list-loc")
      .forEach((button) =>
        button.classList.toggle(
          "active",
          Number(button.dataset.locId) === bin.id,
        ),
      );
    const related = tasks.filter(
      (task) => task.originId === bin.id || task.destinationId === bin.id,
    );
    inspector.innerHTML = `<div class="wmap-inspect-tags"><span>${escape(bin.zoneCode)}</span><span>A${escape(bin.aisle)}</span><span>R${escape(bin.rack)}</span><span>N${bin.level}</span><span>C${bin.cell}</span><span>D${bin.depthSlot}</span></div>
      <div class="wmap-inspect-metrics"><div><small>Espacio</small><strong>${bin.occupied ? "Ocupado" : "Libre"}</strong></div>
      <div><small>HU</small><strong>${bin.occupied}/${bin.capacity}</strong></div>
      <div><small>Unidades en la HU</small><strong>${bin.units}</strong></div><div><small>Condición</small><strong>${escape(bin.condition)}</strong></div></div>
      <div class="wmap-inspect-section"><h3>CAJA O PALÉ EN EL CASILLERO</h3>${
        bin.stock.length
          ? bin.stock
              .map(
                (
                  item,
                ) => `<div class="wmap-inspect-stock"><strong>${escape(item.sku)} · ${escape(item.product)}</strong>
          <small>${escape(item.internalLot)} · fabricante ${escape(item.lot)} · ${item.quantity} UND
          ${item.handlingUnit ? " · " + escape(item.handlingUnit) : ""} · ${escape(item.state)}</small></div>`,
              )
              .join("")
          : "<p>Casillero vacío; admite una HU compatible con esta zona.</p>"
      }</div>
      <div class="wmap-inspect-section"><h3>TAREAS ABIERTAS</h3>${
        related.length
          ? related
              .map(
                (task) =>
                  `<p>${escape(task.code)} · ${escape(task.type)} · ${escape(task.state)}</p>`,
              )
              .join("")
          : "<p>No hay tareas abiertas en esta dirección.</p>"
      }</div>
      <a class="wmap-inspect-action" href="/wms/posiciones?zone=${encodeURIComponent(bin.zoneCode)}&aisle=${encodeURIComponent(bin.aisle)}&rack=${encodeURIComponent(bin.rack)}&level=${bin.level}&loc=${encodeURIComponent(bin.code)}">Abrir trazabilidad</a>
      ${
        new URLSearchParams(location.search).get("seleccionar") === "origen" &&
        root.dataset.canPlan === "true" &&
        bin.occupied
          ? `<a class="wmap-inspect-action" href="/wms/tareas/nueva?loc=${encodeURIComponent(bin.code)}">Usar como origen</a>`
          : ""
      }`;
    if (move) frame({ ...bin, width: 7, depth: 7 });
    dirty = true;
  }
  function inspectZone(id) {
    const zone = layout.zones.find((item) => item.id === Number(id));
    if (!zone) return;
    const previous = selected;
    selected = null;
    if (previous) paint(previous);
    $("wmapInspectCode").textContent = zone.name;
    root.querySelector(".wmap-shell").classList.add("has-inspection");
    inspector.innerHTML = `<div class="wmap-inspect-tags"><span>${escape(zone.code)}</span>
      <span>${escape(zone.condition)}</span></div><div class="wmap-inspect-metrics">
      <div><small>Pasillos</small><strong>${zone.aisleCount}</strong></div>
      <div><small>Racks</small><strong>${zone.rackCount * zone.aisleCount}</strong></div>
      <div><small>Casilleros</small><strong>${zone.binCount}</strong></div></div>
      <p>Selecciona un pasillo, rack y finalmente la caja del nivel/casillero.</p>`;
    frame(zone);
  }
  function pick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    return (
      raycaster.intersectObjects(
        [cartonMesh, binMesh, ...zoneHits].filter(Boolean),
      )[0] || null
    );
  }
  renderer.domElement.addEventListener("pointerdown", (event) => {
    renderer.domElement.focus({ preventScroll: true });
    pointerStart.x = event.clientX;
    pointerStart.y = event.clientY;
  });
  renderer.domElement.addEventListener("keydown", (event) => {
    if (
      mode !== "perspective" ||
      ![
        "w",
        "a",
        "s",
        "d",
        "arrowup",
        "arrowleft",
        "arrowdown",
        "arrowright",
      ].includes(event.key.toLowerCase())
    )
      return;
    event.preventDefault();
    flight = null;
    const forward = controls.target
      .clone()
      .sub(camera.position)
      .setY(0)
      .normalize();
    if (forward.lengthSq() < 0.01) forward.set(0, 0, -1);
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const direction = event.key.toLowerCase();
    const delta =
      direction === "w" || direction === "arrowup"
        ? forward
        : direction === "s" || direction === "arrowdown"
          ? forward.negate()
          : direction === "d" || direction === "arrowright"
            ? right
            : right.negate();
    const step = event.shiftKey ? 3 : 1.25;
    const next = camera.position.clone().addScaledVector(delta, step);
    next.x = THREE.MathUtils.clamp(next.x, 1, layout.width - 1);
    next.z = THREE.MathUtils.clamp(next.z, 1, layout.depth - 1);
    const movement = next.sub(camera.position);
    camera.position.add(movement);
    controls.target.add(movement);
    dirty = true;
  });
  renderer.domElement.addEventListener("pointermove", (event) => {
    if (!event.buttons)
      pendingHover = { clientX: event.clientX, clientY: event.clientY };
  });
  renderer.domElement.addEventListener("pointerleave", () => {
    pendingHover = null;
    const previous = hovered;
    hovered = null;
    if (previous) paint(previous);
  });
  renderer.domElement.addEventListener("pointerup", (event) => {
    if (
      Math.hypot(
        event.clientX - pointerStart.x,
        event.clientY - pointerStart.y,
      ) > 8
    )
      return;
    const hit = pick(event);
    if (!hit) return;
    if (hit.object === cartonMesh)
      inspect(cartonMesh.userData.binIds[hit.instanceId]);
    else if (hit.object === binMesh)
      inspect(layout.locations[hit.instanceId].id);
    else if (hit.object.userData.zoneId) {
      zoneSelect.value = String(hit.object.userData.zoneId);
      selectors();
      inspectZone(hit.object.userData.zoneId);
    }
  });
  zoneSelect.addEventListener("change", () => {
    aisleSelect.value = "";
    rackSelect.value = "";
    selectors();
    if (zoneSelect.value) inspectZone(zoneSelect.value);
    else frame();
  });
  aisleSelect.addEventListener("change", () => {
    rackSelect.value = "";
    selectors();
    const [zoneId, aisle] = aisleSelect.value.split("|");
    const row = layout.locations.filter(
      (bin) => bin.zoneId === Number(zoneId) && bin.aisle === aisle,
    );
    if (row.length)
      frame({
        x: row.reduce((s, b) => s + b.x, 0) / row.length,
        z: row.reduce((s, b) => s + b.z, 0) / row.length,
        width: 14,
        depth: 20,
      });
  });
  rackSelect.addEventListener("change", () => {
    selectors();
    const bin = layout.locations.find(
      (item) => item.rackKey === rackSelect.value,
    );
    if (bin) inspect(bin.id);
  });
  skuSelect.addEventListener("change", () => {
    selectors();
    const zone = Number(zoneSelect.value);
    const bin = layout.locations.find(
      (item) =>
        (!zone || item.zoneId === zone) &&
        item.stock.some((stock) => stock.sku === skuSelect.value),
    );
    if (bin) inspect(bin.id);
  });
  $("wmapTop").addEventListener("click", () => setView("top"));
  $("wmapPerspective").addEventListener("click", () => setView("perspective"));
  $("wmapReset").addEventListener("click", () => {
    const previous = selected;
    selected = null;
    if (previous) paint(previous);
    frame();
  });
  $("wmapInspectorClose").addEventListener("click", () =>
    root.querySelector(".wmap-shell").classList.remove("has-inspection"),
  );
  $("wmapRefresh").addEventListener("click", load);
  async function load() {
    loading.hidden = false;
    try {
      const response = await fetch(root.dataset.endpoint, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error(`Error ${response.status} al consultar el almacén`);
      const data = await response.json();
      layout = data.layout;
      tasks = data.tasks || [];
      if (!Array.isArray(layout.locations) || !Array.isArray(layout.zones))
        throw new Error("Plano incompleto");
      $("wmapSurveyNote").textContent = layout.note;
      build();
      selectors();
      if (selected && bins.has(selected)) inspect(selected, false);
      $("wmapUpdated").textContent = `Actualizado ${new Intl.DateTimeFormat(
        "es-PE",
        { dateStyle: "short", timeStyle: "short", timeZone: "America/Lima" },
      ).format(new Date(data.generatedAt))}`;
      loading.hidden = true;
    } catch (error) {
      loading.textContent = `No se pudo cargar el plano: ${error.message}`;
      status.textContent = "Plano no disponible";
    }
  }
  $("wmapLocationList").addEventListener("click", (event) => {
    const row = event.target.closest("[data-loc-id]");
    if (row) inspect(row.dataset.locId);
  });
  function animate(now) {
    requestAnimationFrame(animate);
    if (!active || document.hidden || !layout) return;
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    lastFrame = now;
    if (zoomGoal !== null && !flight) {
      const current =
        mode === "top"
          ? camera.zoom
          : camera.position.distanceTo(controls.target);
      const next = THREE.MathUtils.lerp(
        current,
        zoomGoal,
        1 - Math.exp(-dt * 18),
      );
      if (mode === "top") {
        camera.zoom = next;
        camera.updateProjectionMatrix();
      } else
        camera.position
          .sub(controls.target)
          .normalize()
          .multiplyScalar(next)
          .add(controls.target);
      if (Math.abs(next - zoomGoal) < 0.001) zoomGoal = null;
      dirty = true;
      lastNavigation = now;
    }
    if (flight) {
      const t = Math.min(1, (now - flight.started) / 700);
      const eased = 1 - (1 - t) ** 3;
      camera.position.lerpVectors(flight.origin, flight.destination, eased);
      controls.target.lerpVectors(flight.from, flight.to, eased);
      topCamera.zoom = THREE.MathUtils.lerp(
        flight.zoomFrom,
        flight.zoomTo,
        eased,
      );
      topCamera.updateProjectionMatrix();
      if (t === 1) flight = null;
      dirty = true;
    }
    const moved = controls?.update();
    if (
      pendingHover &&
      !navigating &&
      !flight &&
      zoomGoal === null &&
      now - lastNavigation > 180 &&
      now - lastHover > 90
    ) {
      const hit = pick(pendingHover);
      pendingHover = null;
      lastHover = now;
      renderer.domElement.style.cursor = hit ? "pointer" : "grab";
      const previous = hovered;
      hovered =
        hit?.object === cartonMesh
          ? cartonMesh.userData.binIds[hit.instanceId]
          : hit?.object === binMesh
            ? layout.locations[hit.instanceId]?.id
            : null;
      if (previous !== hovered) {
        if (previous) paint(previous);
        if (hovered) paint(hovered);
      }
    }
    if (dirty || moved) {
      renderer.render(scene, camera);
      // Datos de diagnóstico no visibles, útiles para detectar regresiones.
      for (const [key, value] of Object.entries({
        drawCalls: renderer.info.render.calls,
        textures: renderer.info.memory.textures,
        geometries: renderer.info.memory.geometries,
      }))
        if (root.dataset[key] !== String(value))
          root.dataset[key] = String(value);
      dirty = false;
    }
  }
  new ResizeObserver(resize).observe(host);
  new IntersectionObserver(
    ([entry]) => {
      active = entry.isIntersecting;
      dirty = true;
    },
    { threshold: 0.01 },
  ).observe($("wmapStage"));
  load();
  requestAnimationFrame(animate);
}
