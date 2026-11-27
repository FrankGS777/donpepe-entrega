import { dimensionalBrandGeometry } from './scene-brand.js';
import { tiledGeometry } from './scene-texture-geometry.js';
import { floorOcclusionMatches, floorOcclusionGeometry } from './scene-floor-occlusion.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WebGPURenderer, PMREMGenerator, RectAreaLightNode } from 'three/webgpu';
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import IndustrialMaterials from './scene-materials.js';
import { buildExteriorContext } from './scene-exterior.js';
import IndustrialLighting, { configureIndustrialSun } from './scene-lighting.js';
import WarehouseModels from './scene-model-library.js';
import {createInstances} from './scene-instancing.js';
import SceneAutomation from './scene-automation.js';
import SceneAnnotations from './scene-annotations.js';
import { ScenePhysics } from './scene-physics.js';
import { selectionVisible, selectionFromHits, insideDepot } from './scene-selection.js';
import {inspectionPose} from './scene-inspection.js';
import { roadRectangle, unionRoadRectangles, clearRoadMarkings } from './scene-roads.js';
import MapNavigation, { isNavigationKey, mapInputAllowed, cameraPlaneDelta, turnCameraTarget } from './scene-navigation.js';
import { reportedTravelPath, sampleTravelPath, playbackTime, historyWallTime, observedSimulationTime, observedUnitState, caseParts, stagingPoint, carrierLoadPoint, truckLoadPoint, LOAD } from './scene-motion.js';
import motionGuideModule from '../core/motion-guide.js';
import packagingQuality from '../core/packaging-quality.js';

// This renderer observes the simulation. It never advances it, changes stock,
// chooses routes or confirms a delivery. Positions come from the server.
const C = {
  purple: 0xf3bc3e, deep: 0x222b30, gold: 0xf3b72f, orange: 0xd16835,
  blue: 0x34556d, steel: 0xadb5b9, white: 0xf6f5ee, wall: 0xe6e5e0,
  concrete: 0xc5c6c3, pale: 0xe4e4df, road: 0x3c4143, green: 0x3d9985,
  cold: 0xb8c6c9, frost: 0xd7e0e1, dark: 0x282e31, wood: 0xb7a187,
  carton: 0xb49b7d, cartonLight: 0xc6ab86, red: 0xdf6a57,
};
const THEMES = {
  // The application may be dark; a daylight logistics diorama stays legible in
  // either UI theme. No night filter conceals the warehouse or loading process.
  dark: { background: 0xd9d6c8, sky: 0xe6f2f8, ground: 0x687e75, ambient: .5, sun: 0xfff1db, sunIntensity: 3.2, fill: 0xc1e6f5, fillIntensity: .5, exposure: 1.08,
    floorInk: '#3c555b', loading: '#cad9e1', loadingInk: '#344951', colors: { [0xd6cce9]: 0xd8d3b8 } },
  light: { background: 0xd9d6c8, sky: 0xeaf5f9, ground: 0x687e75, ambient: .5, sun: 0xfff1db, sunIntensity: 3.2, fill: 0xc1e6f5, fillIntensity: .5, exposure: 1.08,
    floorInk: '#343e3d', loading: '#e6e8e3', loadingInk: '#554b32', colors: {
      [0xd6cce9]: 0xd4cbb0, [0xd4dbe1]: 0xcbd2ce,
    } },
};
const n = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const entityKey = (type, id) => `${type}:${id}`;
const asArray = (value) => Array.isArray(value) ? value : [];
const smooth = (t) => t * t * (3 - 2 * t);
const now = () => performance.now();

export default class WarehouseScene {
  constructor(host, { onSelect = () => {}, theme = 'dark' } = {}) {
    this.host = host;
    this.startedAt = now();
    this.instanceId = crypto.randomUUID();
    this.active = true;
    this.buildCount = 0;
    this.startupTimings = {};
    this.host.dataset.sceneReady = 'false';
    this.host.setAttribute('aria-busy','true');
    this.host.dataset.renderedFrames = '0';
    this.onSelect = onSelect;
    this.theme = theme === 'light' ? 'light' : 'dark';
    this.labelRecords = new Set();
    this.view = 'overview';
    this.disposed = false;
    this.visible = true;
    this.dirty = true;
    this.frameId = 0;
    this.geometry = new Map();
    this.materials = new Map();
    this.textures = new Set();
    this.entities = new Map();
    this.hitTargets = [];
    this.movers = new Map();
    this.dynamicHus = [];
    this.staticLayers = {};
    this.listeners = [];
    this.touchPoints = new Map();
    this.navigation = new MapNavigation();
    this.navigationOffset = new THREE.Vector3();
    this.lastMotion = 0;
    this.visualSignature = '';
    this.layoutSignature = '';
    this.quality = 'high';
    this.sampleInterval = 500;
    this.renderDelay = 550;
    this.lastSnapshotAt = 0;
    this.frameTimes = [];
    this.intervals = [];
    this.clockAnchors = [];
    this.dummy = new THREE.Object3D();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = this.motionQuery.matches;
    this._frame = this._frame.bind(this);
    this.host.style.position ||= 'relative';
    this.ready = this._init().catch((error) => {
      if (this.disposed) return;
      console.error('DonPepe: no se pudo preparar el renderizado', error);
      this.failed = true;
      this.dispose();
      this.host.replaceChildren();
      const panel = document.createElement('div');
      panel.className = 'map-fallback';
      Object.assign(panel.style, { height: '100%', minHeight: '360px', display: 'grid', placeContent: 'center', padding: '32px', textAlign: 'center', color: THEMES[this.theme].loadingInk, background: THEMES[this.theme].loading, borderRadius: '24px' });
      const title = document.createElement('strong');
      title.textContent = 'El mapa 3D no está disponible en este navegador';
      const detail = document.createElement('p');
      detail.textContent = 'Activa la aceleración gráfica o abre un navegador compatible. Los pedidos y la simulación siguen disponibles fuera del mapa.';
      panel.append(title, detail); this.host.append(panel); this.fallback = panel;
      this.host.dataset.sceneReady = 'fallback';
    });
  }

  async _init() {
    const background = THEMES[this.theme].background;
    this.exteriorScene = new THREE.Scene();
    this.interiorScene = new THREE.Scene();
    for (const scene of [this.exteriorScene, this.interiorScene]) {
      scene.background = new THREE.Color(background);
      scene.fog = new THREE.Fog(background, 350, 950);
      scene.environmentRotation.y = .7;
    }
    this.world = new THREE.Group();
    this.scene = this.exteriorScene;
    this.scene.add(this.world);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.35, 1100);
    this.perspectiveCamera = this.camera;
    this.orthographicCamera = new THREE.OrthographicCamera(-88, 88, 66, -66, 0.35, 1100);
    this.camera.position.set(93, 94, 112);
    this.loading = document.createElement('div');
    this.loading.textContent = 'Preparando el centro de distribución…';
    this.loading.hidden = Boolean(this.host.querySelector('.map-preview'));
    Object.assign(this.loading.style, { position: 'absolute', inset: '0', placeContent: 'center', background: THEMES[this.theme].loading, color: THEMES[this.theme].loadingInk, font: '600 14px sans-serif', pointerEvents: 'none', borderRadius: 'inherit', zIndex: '5', textAlign: 'center', alignContent: 'center' });
    this.host.append(this.loading);
    this.renderer = new WebGPURenderer({ antialias: true, samples: 4, alpha: false,
      powerPreference: 'high-performance', colorBufferType: THREE.HalfFloatType,
      forceWebGL: new URLSearchParams(location.search).get('renderer') === 'webgl2' });
    await this.renderer.init();
    this.startupTimings.renderer = Math.round(now()-this.startedAt);
    if (this.disposed) { this.renderer.dispose(); return; }
    this.backend = this.renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2';
    this.host.dataset.rendererBackend = this.backend;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    const gl = this.renderer.backend.gl;
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    const rendererName = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : this.renderer.backend.device?.adapterInfo?.device || '';
    this.softwareRenderer = /swiftshader|llvmpipe|software|basic render/i.test(rendererName);
    this.host.dataset.gpuMode = this.softwareRenderer ? 'software' : 'graphics';
    this.materialLibrary = new IndustrialMaterials(this.renderer, { materialCache: this.materials, textureRegistry: this.textures, resolveColor: color => this._themeColor(color) });
    const environmentDownload = new RGBELoader().loadAsync('/textures/industrial/industrial_sunset_02_puresky_4k.hdr').catch(() => null);
    const modelDownload = WarehouseModels.load();
    await this.materialLibrary.loadPhotographic();
    this.startupTimings.textures = Math.round(now()-this.startedAt);
    if (this.disposed) {
      this.materialLibrary.dispose();
      (await environmentDownload)?.dispose();
      (await modelDownload)?.dispose();
      return;
    }
    const pmrem = new PMREMGenerator(this.renderer);
    try {
      const environment = await environmentDownload;
      if (!environment) throw new Error('HDR no disponible');
      if (this.disposed) { environment.dispose(); pmrem.dispose(); (await modelDownload)?.dispose(); return; }
      this.environmentTarget = pmrem.fromEquirectangular(environment);
      this.exteriorSky = environment; this.environmentSource = 'HDRI';
    } catch (error) {
      const environment = new RoomEnvironment();
      this.environmentTarget = pmrem.fromScene(environment, 0.04);
      environment.dispose(); this.environmentSource = 'studio';
      console.warn('DonPepe: entorno HDR no disponible; iluminación de estudio activa.', error.message);
    }
    this.scene.environment = this.environmentTarget.texture;
    this.scene.environmentIntensity = .85;
    pmrem.dispose();
    this.startupTimings.environment = Math.round(now()-this.startedAt);
    this.renderer.domElement.setAttribute('aria-label', 'Centro de distribución DonPepe. Arrastra para girar. Usa WASD o las flechas para desplazarte, Q y E para girar, y la rueda para acercarte. Inicio vuelve a la vista inicial. Selecciona un elemento para inspeccionarlo.');
    this.renderer.domElement.setAttribute('aria-keyshortcuts', 'W A S D ArrowUp ArrowDown ArrowLeft ArrowRight Q E Home + -');
    this.renderer.domElement.setAttribute('role', 'img');
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none;border-radius:inherit';
    this.renderer.domElement.tabIndex = 0;
    this.host.append(this.renderer.domElement);
    this.annotations = new SceneAnnotations(this.host, (type, id) => { this.focus(type, id); this.renderer.domElement.focus({ preventScroll: true }); this.onSelect({ type, id }); });
    this.host.getSceneDiagnostics = () => this.getDiagnostics();
    this.host.getSceneProjection = (type, id, offset = {}) => {
      const record = this.entities.get(entityKey(type, id));
      if (!record || this.disposed) return null;
      const point = record.position.clone().add(new THREE.Vector3(n(offset.x), n(offset.y), n(offset.z))).project(this.camera);
      const bounds = this.renderer.domElement.getBoundingClientRect();
      return { x:bounds.left+(point.x+1)*bounds.width/2, y:bounds.top+(1-point.y)*bounds.height/2,
        visible:Math.abs(point.x)<=1 && Math.abs(point.y)<=1 && point.z>=-1 && point.z<=1 };
    };
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0, 6);
    this.controls.enableDamping = !this.reducedMotion;
    this.controls.dampingFactor = 0.09;
    this.controls.enableZoom = false;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 285;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.025;
    this.controls.minPolarAngle = 0.03;
    this.controls.panSpeed = 0.85;
    this.controls.rotateSpeed = 0.6;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.ambient = new THREE.HemisphereLight(0xf1f5fa, 0x727a77, 1.75);
    this.world.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xfff4df, 2.7);
    this.sun.position.set(-65, 95, 32);
    configureIndustrialSun(this.sun);
    this.world.add(this.sun);
    this.fillLight = new THREE.DirectionalLight(0xf3f1eb, 0.85);
    this.fillLight.position.set(35, 45, -50); this.world.add(this.fillLight);
    RectAreaLightNode.setLTC(RectAreaLightTexturesLib.LTC_FLOAT_1 ? RectAreaLightTexturesLib : RectAreaLightTexturesLib.init());
    this.ceilingLights = [
      [-27,10.7,-22,42,104], [14,7.65,-42,24,75],
      [38,7.65,-42,19,75], [-67,9.7,17,25,23],
      [-58,8.8,17,17,.75,3.3], [15,8.8,21,8,.65,3.2],
    ].map(([x,y,z,width,height,intensity=1.8]) => {
      const light = new THREE.RectAreaLight(0xf5f7fa, intensity, width, height);
      light.position.set(x,y,z); light.lookAt(x,0,z);
      // Exterior shading never used these luminaires. Keep them out of its
      // light list so the driver does not build six unused area-light passes.
      this.interiorScene.add(light);
      return light;
    });
    this.sun.shadow.autoUpdate = false;
    this.sun.shadow.needsUpdate = true;
    this.content = new THREE.Group();
    this.dynamic = new THREE.Group();
    this.world.add(this.content, this.dynamic);
    this.automation = new SceneAutomation(this);
    this.selection = new THREE.Group();
    const corners = [];
    for (const x of [-.5, .5]) for (const z of [-.5, .5]) {
      corners.push(x, .025, z, x - Math.sign(x) * .19, .025, z, x, .025, z, x, .025, z - Math.sign(z) * .19);
      corners.push(x, .025, z, x, .6, z);
    }
    this.selection.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(corners, 3)), new THREE.LineBasicMaterial({ color: C.gold, transparent: true, opacity: .95, depthWrite: false })));
    this.selection.visible = false;
    this.world.add(this.selection);
    this.hover = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: C.gold, transparent: true, opacity: 0.055, depthWrite: false }));
    this.hover.add(new THREE.LineSegments(new THREE.EdgesGeometry(this._geo('box')), new THREE.LineBasicMaterial({ color: C.gold, transparent: true, opacity: 0.75, depthWrite: false })));
    this.hover.visible = false;
    this.world.add(this.hover);
    this.resizeObserver = new ResizeObserver(() => this._resize());
    this.resizeObserver.observe(this.host);
    this.intersectionObserver = new IntersectionObserver((entries) => {
      this.visible = this.active && (entries[0]?.isIntersecting ?? true);
      if (!this.visible) this.navigation.clear();
      this.host.dataset.sceneReady = 'false';
      if (this.visible) { this.lastFrameAt = 0; this.playbackAt = undefined; this.wasContinuous = false; this._request(); }
    }, { threshold: 0.01 });
    this.intersectionObserver.observe(this.host);
    this._listen(document, 'visibilitychange', () => {
      this.navigation.clear();
      this.host.dataset.sceneReady = 'false';
      if (!document.hidden) { this.lastFrameAt = 0; this.playbackAt = undefined; this.wasContinuous = false; this.frameTimes = []; this._request(); }
    });
    this._listen(this.motionQuery, 'change', (event) => {
      this.reducedMotion = event.matches; this.controls.enableDamping = !event.matches;
      if (event.matches) this.flight = null;
      this._request();
    });
    this._listen(this.renderer.domElement, 'webglcontextlost', (event) => {
      this.navigation.clear();
      event.preventDefault(); this.contextLost = true; this.host.dataset.sceneReady = 'false';
    });
    this._listen(this.renderer.domElement, 'webglcontextrestored', () => {
      this.contextLost = false; this.lastFrameAt = 0; this.playbackAt = undefined; this.wasContinuous = false;
      this.sun.shadow.needsUpdate = true; this.lastMotion = now(); this._request();
    });
    this._listen(this.renderer.domElement, 'wheel', (event) => this._wheel(event), { passive: false });
    this._listen(this.renderer.domElement, 'pointerdown', (event) => {
      this.navigation.clear();
      this.renderer.domElement.focus({ preventScroll: true });
      if (!this.pointerDown) {
        const { clientX: x, clientY: y, pointerId: id, button } = event;
        this.pointerDown = { id, button, x, y, lastX: x, lastY: y, dragged: false };
        this.flight = null;
        if (this._usesFixedLook()) this.zoomTarget = null;
      }
      if (this._usesFixedLook()) this.renderer.domElement.setPointerCapture(event.pointerId);
      this.lastMotion = now();
      if (event.pointerType === 'touch') {
        this.touchPoints.set(event.pointerId, [event.clientX, event.clientY]);
        if (this.touchPoints.size > 1) { this.usedPinch = true; const [a, b] = [...this.touchPoints.values()]; this.pinchDistance = Math.hypot(a[0] - b[0], a[1] - b[1]); }
      }
      this._request();
    });
    this._listen(this.renderer.domElement, 'pointerup', (event) => {
      const drag = this.pointerDown;
      if (drag?.id === event.pointerId) {
        this.pointerDown = null;
        if (drag.button === 0 && !drag.dragged && !this.usedPinch &&
            Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) this._pick(event, true);
      }
      this.touchPoints.delete(event.pointerId); if (!this.touchPoints.size) { this.usedPinch = false; this.pinchDistance = null; }
      this.lastMotion = now(); this._request();
    });
    this._listen(this.renderer.domElement, 'pointermove', (event) => {
      if (event.pointerType === 'touch' && this.touchPoints.has(event.pointerId)) {
        this.touchPoints.set(event.pointerId, [event.clientX, event.clientY]);
        if (this.touchPoints.size > 1) {
          const [a, b] = [...this.touchPoints.values()], distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
          if (this.pinchDistance > 1 && distance > 1) this._zoom(this.pinchDistance / distance);
          this.pinchDistance = distance;
        }
      }
      if (this.pointerDown) {
        const drag = this.pointerDown;
        if (drag.id === event.pointerId && !this.usedPinch &&
            (drag.dragged || Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= 6)) {
          drag.dragged = true;
          if (this._usesFixedLook()) {
            const dx = event.clientX - drag.lastX, dy = event.clientY - drag.lastY;
            const height = Math.max(1, this.renderer.domElement.clientHeight);
            if (drag.button === 0) {
              const radians = 2.5 / height;
              turnCameraTarget(this.camera.position, this.controls.target, -dx * radians, -dy * radians);
            } else {
              const units = this._visibleSpan() / height;
              this._panCamera(-dx * units, dy * units);
            }
          }
          drag.lastX = event.clientX; drag.lastY = event.clientY;
        }
        this.lastMotion = now(); this._request(); return;
      }
      if (now() - (this.lastHover || 0) > 45) { this.lastHover = now(); this._pick(event, false); }
    });
    this._listen(this.renderer.domElement, 'pointerleave', () => { this.hover.visible = false; this.hovered = null; this.host.style.cursor = ''; this._request(); });
    const endDrag = (event) => {
      this.touchPoints.delete(event.pointerId);
      if (this.pointerDown?.id === event.pointerId) this.pointerDown = null;
      if (!this.touchPoints.size) { this.usedPinch = false; this.pinchDistance = null; }
    };
    this._listen(this.renderer.domElement, 'pointercancel', endDrag);
    this._listen(this.renderer.domElement, 'lostpointercapture', endDrag);
    this._listen(this.renderer.domElement, 'contextmenu', (event) => event.preventDefault());
    this._listen(this.renderer.domElement, 'keydown', (event) => {
      if (!this._navigationAllowed(event)) return;
      if (isNavigationKey(event.code)) {
        event.preventDefault();
        if (!this.navigation.active) this.navigationFrameAt = now();
        this.navigation.press(event.code);
        this.flight = null; this.lastMotion = now(); this._request();
        return;
      }
      if (['+', '=', '-', '_', 'Home'].includes(event.key)) {
        event.preventDefault();
        if (event.key === 'Home') this.setView(this.view);
        else this._zoom(['+', '='].includes(event.key) ? 0.8 : 1.25);
      }
    });
    this._listen(window, 'keyup', (event) => { if (this.navigation.release(event.code)) this._request(); });
    this._listen(this.renderer.domElement, 'blur', () => this.navigation.clear());
    this._listen(window, 'blur', () => this.navigation.clear());
    this.controls.addEventListener('start', () => { this.lastMotion = now(); this._request(); });
    this.controls.addEventListener('change', () => { this.dirty = true; this._request(); });
    this.controls.addEventListener('end', () => { this.lastMotion = now(); this._request(); });
    this.models = await modelDownload;
    if (this.disposed) { this.models?.dispose(); return; }
    this.startupTimings.blender = Math.round(now()-this.startedAt);
    this.lighting = new IndustrialLighting(this.renderer);
    this.initialized = true;
    this.setQuality('high');
    this.setTheme(this.theme);
    if (this.pendingSnapshot) { const snapshot = this.pendingSnapshot; this.pendingSnapshot = null; this.update(snapshot); }
  }

  _prepareInteriorEnvironment() {
    if (this.interiorEnvironmentRequest || this.disposed) return;
    this.interiorEnvironmentRequest = new RGBELoader().loadAsync('/textures/industrial/empty_warehouse_01_2k.hdr').then(source => {
      if (this.disposed) { source.dispose(); return; }
      const pmrem = new PMREMGenerator(this.renderer);
      try {
        this.interiorEnvironmentTarget = pmrem.fromEquirectangular(source);
        this.interiorScene.environment = this.interiorEnvironmentTarget.texture;
        if (this._usesFixedLook()) this._request();
      } finally {
        source.dispose();
        pmrem.dispose();
      }
    }).catch(() => {});
  }

  _listen(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    this.listeners.push(() => target.removeEventListener(type, fn, options));
  }

  _geo(type = 'box') {
    if (!this.geometry.has(type)) {
      const geometry = type === 'machineShell' ? new RoundedBoxGeometry(1,1,1,3,.06) : type === 'chamferedBox' ? new RoundedBoxGeometry(1, 1, 1, 2, 0.009)
        : type === 'cylinder' ? new THREE.CylinderGeometry(1, 1, 1, 32)
        : type === 'bolt' ? new THREE.CylinderGeometry(1, 1, 1, 6)
        : type === 'sphere' ? new THREE.SphereGeometry(1, 24, 16)
          : type === 'plane' ? new THREE.PlaneGeometry(1, 1) : new THREE.BoxGeometry(1, 1, 1);
      this.geometry.set(type, geometry);
    }
    return this.geometry.get(type);
  }

  _materialGeometry(geometry, material) { return tiledGeometry(geometry, material, this.geometry); }

  _instances(geometry, material, count) { return createInstances(geometry,material,count,this.backend); }

  _texture(kind) { return this.materialLibrary.texture(kind); }

  _mat(color, options = {}) {
    return this.materialLibrary.material(color, options);
  }

  _beaconMaterial(color) {
    return this._mat(color,{emissive:color,emissiveIntensity:.55,roughness:.24,metalness:0});
  }

  _contactShadowMaterial() {
    if (this.contactShadowMaterial) return this.contactShadowMaterial;
    const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
    const context=canvas.getContext('2d'),gradient=context.createRadialGradient(64,64,18,64,64,64);
    gradient.addColorStop(0,'rgba(19,36,40,.3)');gradient.addColorStop(.65,'rgba(19,36,40,.18)');gradient.addColorStop(1,'rgba(19,36,40,0)');
    context.fillStyle=gradient;context.fillRect(0,0,128,128);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;this.textures.add(texture);
    this.contactShadowMaterial=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1,toneMapped:false});
    this.generatedMaterials ||= new Set();this.generatedMaterials.add(this.contactShadowMaterial);
    return this.contactShadowMaterial;
  }

  _themeColor(color) { return THEMES[this.theme].colors[color] ?? color; }

  setTheme(theme = 'dark') {
    this.theme = theme === 'light' ? 'light' : 'dark';
    this.host.dataset.theme = this.theme;
    const palette = THEMES[this.theme];
    if (this.fallback) { this.fallback.style.background = palette.loading; this.fallback.style.color = palette.loadingInk; }
    if (this.failed || this.disposed || !this.initialized) return;
    this._setSceneLight();
    this.materials.forEach((material) => this.materialLibrary.recolor(material));
    this.labelRecords.forEach((record) => this._paintLabel(record));
    if (this.loading) { this.loading.style.background = palette.loading; this.loading.style.color = palette.loadingInk; }
    this.sun.shadow.needsUpdate = true;
    this.host.dataset.sceneReady = 'false';
    this._request();
  }

  _setSceneLight() {
    const outside = this.models && ['overview', 'network'].includes(this.view);
    const palette = THEMES[this.theme];
    const rebuilt = Boolean(this.models);
    const sky = outside ? 0x3b5375 : palette.background;
    this.perspectiveCamera.near=outside ? .6 : .12;
    this.perspectiveCamera.far=outside?1250:260;
    this.perspectiveCamera.updateProjectionMatrix();
    this.scene.background.setHex(sky);
    this.scene.fog.color.setHex(sky);
    this.scene.fog.near = outside ? 135 : 350;
    this.scene.fog.far = outside ? 815 : 950;
    this.ambient.color.setHex(outside ? 0xa5c5fa : (rebuilt ? 0xf5f2ec : palette.sky));
    this.ambient.groundColor.setHex(outside ? 0x71645a : (rebuilt ? 0x8d847a : palette.ground));
    this.ambient.intensity = outside ? .65 : (rebuilt ? .25 : palette.ambient);
    this.sun.color.setHex(outside ? 0xb5caff : (rebuilt ? 0xfffcf5 : palette.sun));
    this.sun.intensity = outside ? 1.65 : (rebuilt ? 1.65 : palette.sunIntensity);
    this.sun.position.set(-65, outside ? 54 : 95, 32);
    this.fillLight.color.setHex(outside ? 0xd8a27b : palette.fill);
    this.fillLight.intensity = outside ? .28 : (rebuilt ? .22 : palette.fillIntensity);
    this.renderer.toneMappingExposure = outside ? 1.08 : (rebuilt ? 1.15 : palette.exposure);
    this.scene.environmentIntensity = outside ? .65 : .8;
    this.scene.environment = (!outside && this.interiorEnvironmentTarget ? this.interiorEnvironmentTarget : this.environmentTarget).texture;
    // Camera modes change both sun direction and roof visibility. Reusing the
    // exterior depth map here leaves the hidden roof casting a false shadow
    // over the entire interior until a robot happens to move.
    this.sun.shadow.needsUpdate = true;
  }

  _shape(parent, geo, color, position, scale, rotation = [0, 0, 0], batch = true, options = {}) {
    const {castShadow: shadowOption, squareEdges, ...materialOptions} = options;
    let material = typeof color === 'object' ? color : this._mat(color, materialOptions);
    const groundSurface = position[1] < .3 && Math.abs(scale[1]) < 1.5 && Math.min(Math.abs(scale[0]),Math.abs(scale[2])) > 5;
    const castShadow = shadowOption !== false && !groundSurface && geo !== 'plane' && Math.min(...scale.map(Math.abs)) > .035 && (!material.transparent || material.opacity >= .5);
    // Bevel the large readable forms, not every bolt, slat or giant floor slab.
    // A shared low-segment mesh preserves instancing and the original footprint.
    if (geo === 'box' && material.visible !== false && !squareEdges) {
      const min = Math.min(...scale.map(Math.abs)), max = Math.max(...scale.map(Math.abs));
      if (min >= .26 && max <= 18 && max / min <= 9) geo = 'chamferedBox';
    }
    let geometry = this._materialGeometry(this._geo(geo), material);
    if (this.floorOcclusionValid && parent === this.staticLayers.floor && position[1] >= -.2 && position[1] < .15 && scale[1] < .5 && scale[0] > 2 && scale[2] > 2
      && Math.abs(position[0])+scale[0]/2 <= 53 && position[2]-scale[2]/2 >= this.models.floorOcclusionLayout.rear-1 && position[2]+scale[2]/2 <= 36) {
      this.floorMaterials ||= new Map();
      if (!this.floorMaterials.has(material.uuid)) {
        const clone=material.clone(); clone.aoMap=this.models.floorOcclusion; clone.aoMapIntensity=.8;
        this.generatedMaterials ||= new Set(); this.generatedMaterials.add(clone);
        this.floorMaterials.set(material.uuid,clone);
      }
      material=this.floorMaterials.get(material.uuid);
      geometry=floorOcclusionGeometry(geometry,position,scale,rotation,this.models.floorOcclusionLayout,this.geometry);
    }
    if (batch && parent.userData.batches) {
      const key = `${geometry.uuid}:${material.uuid}:${castShadow}`;
      if (!parent.userData.batches.has(key)) parent.userData.batches.set(key, { geo: geometry, material, castShadow, transforms: [] });
      this.dummy.position.set(...position); this.dummy.scale.set(...scale); this.dummy.rotation.set(...rotation); this.dummy.updateMatrix();
      parent.userData.batches.get(key).transforms.push(this.dummy.matrix.clone());
      return null;
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position); mesh.scale.set(...scale); mesh.rotation.set(...rotation);
    mesh.castShadow = castShadow; mesh.receiveShadow = true; parent.add(mesh);
    return mesh;
  }

  _box(parent, x, y, z, w, h, d, color, rotation, options) {
    return this._shape(parent, 'box', color, [x, y, z], [w, h, d], rotation, true, options);
  }

  _layer(name) {
    const group = new THREE.Group(); group.name = name; group.userData.batches = new Map();
    this.staticLayers[name] = group; this.content.add(group); return group;
  }

  _finish(group) {
    this.models?.finish(group, this);
    for (const { geo, material, transforms, castShadow } of group.userData.batches.values()) {
      const mesh = this._instances(geo, material, transforms.length);
      transforms.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.castShadow = castShadow !== false; mesh.receiveShadow = true;
      mesh.computeBoundingSphere(); group.add(mesh);
    }
    group.userData.batches.clear();
  }

  _label(text, x, y, z, { width = 7, color = '#e3d8b8', background = '#171c20', floor = false, parent = this.content, fontSize = 36 } = {}) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 112;
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(this.renderer.getMaxAnisotropy(), 8);
    const record = { canvas, texture, text, color, background, floor, fontSize };
    this.labelRecords.add(record); this._paintLabel(record);
    this.textures.add(texture);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.FrontSide, depthWrite: false, alphaTest: .06, polygonOffset: floor, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.generatedMaterials ||= new Set(); this.generatedMaterials.add(material);
    const plane = new THREE.Mesh(this._geo('plane'), material); plane.position.set(x, y, z); plane.scale.set(width, width * 112 / 512, 1);
    plane.userData.ownedResources = [texture, material]; plane.userData.labelRecord = record;
    if (floor) plane.rotation.x = -Math.PI / 2;
    plane.renderOrder = floor ? 2 : 3;
    parent.add(plane); return plane;
  }

  _paintLabel(record) {
    const { canvas, texture, text, floor, fontSize } = record, ctx = canvas.getContext('2d');
    let { background, color } = record;
    if (background === '#422256') background = '#171c20';
    if (color === '#422256') color = '#e3d8b8';
    if (floor && background === 'transparent') color = THEMES[this.theme].floorInk;
    ctx.clearRect(0, 0, 512, 112);
    if (background !== 'transparent') {
      ctx.fillStyle = background; ctx.beginPath(); ctx.roundRect(3, 3, 506, 106, 5); ctx.fill();
      ctx.strokeStyle = '#a7946a'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#d8b96f'; ctx.fillRect(16, 25, 3, 62);
    }
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `600 ${fontSize}px sans-serif`; ctx.fillText(String(text).slice(0, 50), 266, 57, 458);
    texture.needsUpdate = true;
  }

  _brandSign(parent, x, y, z, width = 15, { floor = false, decal = false } = {}) {
    let mark;
    if(decal) {
      if(!this.logoMaterial) {
        const texture=new THREE.TextureLoader().load('/images/donpepe-mark-light.svg',()=>this._request());
        texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=8;this.textures.add(texture);
        this.logoMaterial=new THREE.MeshStandardMaterial({map:texture,transparent:false,alphaTest:.4,depthWrite:true,roughness:.54,metalness:0,side:THREE.FrontSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
        this.generatedMaterials ||= new Set();this.generatedMaterials.add(this.logoMaterial);
      }
      mark=new THREE.Mesh(this._geo('plane'),this.logoMaterial);
      mark.scale.set(width,width/2.85,1);
    } else {
      if(!this.geometry.has('dimensional-brand'))this.geometry.set('dimensional-brand',dimensionalBrandGeometry());
      mark=new THREE.Mesh(this.geometry.get('dimensional-brand'),this._mat(0xb78d2e,{metalness:.82,roughness:.29,clearcoat:.22}));
      mark.scale.setScalar(width);mark.castShadow=true;mark.receiveShadow=true;
    }
    mark.position.set(x,y,z+.025);
    if(floor)mark.rotation.x=-Math.PI/2;
    mark.name=decal?'DonPepe · vinilo sin fondo':'DonPepe · letras metálicas en relieve';
    parent.add(mark);
  }

  _register(type, id, position, size = [3, 2, 3], parent = this.content) {
    const key = entityKey(type, id);
    const record = { type, id: String(id), position: new THREE.Vector3(...position), size };
    this.entities.set(key, record);
    const mesh = new THREE.Mesh(this._geo('box'), this._mat(C.gold, { visible: false }));
    mesh.position.set(...position); mesh.scale.set(...size); mesh.userData.entity = record;
    parent.add(mesh); this.hitTargets.push(mesh); return record;
  }

  update(snapshot) {
    if (this.failed || this.disposed || !snapshot) return;
    if (!this.initialized) { this.pendingSnapshot = snapshot; return; }
    this.snapshot = snapshot;
    const layout = snapshot.layout || {};
    const branches = snapshot.catalog?.branches || snapshot.branches || [];
    // Occupancy belongs to the dynamic layer. Serialising it as architecture
    // used to rebuild every rack, wall and texture after a single pickup.
    const layoutSignature = JSON.stringify([{ ...layout,
      locations: asArray(layout.locations).map(({ huId, state, blocked, reservedFor, ...geometry }) => geometry),
      stations: asArray(layout.stations).map(({ bufferOccupancy, occupiedHus, availableHus, reservedReturnHus, ...geometry }) => geometry),
    }, branches.map((b) => [b.id, b.name, b.x, b.z])]);
    if (layoutSignature !== this.layoutSignature) {
      this.layoutSignature = layoutSignature;
      this._build(layout, branches);
    }
    const hus = asArray(snapshot.inventory?.hus || snapshot.hus);
    const robots = asArray(snapshot.equipment?.robots || snapshot.robots);
    const trucks = asArray(snapshot.equipment?.trucks || snapshot.trucks);
    const missions = asArray(snapshot.missions);
    const signature = JSON.stringify([hus.map((h) => [h.id, h.locationId, h.robotId, h.status, h.state, h.cases, h.qty, h.quantity, h.x, h.y, h.z]), robots, trucks, missions.map((m) => [m.id, m.status, m.state, m.robotId, m.route])]);
    if (this.paused !== Boolean(snapshot.clock?.paused)) this.playbackAt = undefined;
    this.paused = Boolean(snapshot.clock?.paused);
    const receivedAt = now();
    this.previousSnapshotAnchor = this.snapshotAnchor;
    this.snapshotAnchor = { at: receivedAt, elapsed: n(snapshot.clock?.elapsed) };
    if (this.previousSnapshotAnchor && this.snapshotAnchor.elapsed < this.previousSnapshotAnchor.elapsed) this.clockAnchors.length = 0;
    this.clockAnchors.push(this.snapshotAnchor);
    while (this.clockAnchors.length > 2 && (this.clockAnchors[1].at < receivedAt - 12000 || this.clockAnchors.length > 80)) this.clockAnchors.shift();
    if (this.lastSnapshotAt) {
      const interval = receivedAt - this.lastSnapshotAt;
      if (interval > 100 && interval < 3000) {
        this.sampleInterval = this.sampleInterval * 0.7 + interval * 0.3;
        this.intervals.push(interval); if (this.intervals.length > 12) this.intervals.shift();
      }
    }
    this.lastSnapshotAt = receivedAt;
    const sortedIntervals = [...this.intervals].sort((a, b) => a - b);
    const jitterCover = sortedIntervals[Math.floor(Math.max(0, sortedIntervals.length - 1) * 0.85)] || this.sampleInterval;
    this.renderDelay = Math.max(280, Math.min(1800, jitterCover + 35));
    const automationChanged = this.automation.update(snapshot);
    if (signature === this.visualSignature) { if (automationChanged) this._request(); return; }
    this.visualSignature = signature;
    this._syncMovers(robots, trucks);
    this._syncHus(hus);
    this._syncRoutes(robots, trucks);
    this.sun.shadow.needsUpdate = true;
    this._request();
  }

  _clearContent() {
    this.hitTargets = this.hitTargets.filter((mesh) => ['robot', 'truck'].includes(mesh.userData.entity?.type));
    for (const key of [...this.entities.keys()]) if (!key.startsWith('robot:') && !key.startsWith('truck:')) this.entities.delete(key);
    this.staticLayers = {};
    this.content.traverse((object) => {
      if (object.isInstancedMesh) object.dispose();
      if (object.userData.labelRecord) this.labelRecords.delete(object.userData.labelRecord);
      for (const resource of object.userData.ownedResources || []) {
        resource.dispose(); this.textures.delete(resource); this.generatedMaterials?.delete(resource);
      }
    });
    this.content.clear();
  }

  _build(layout, branches) {
    this.buildCount++;
    this._clearContent();
    this.layout = layout;
    this.storeSignPlacements = [];
    this.roadSegments = [];
    if (this.physics) this.physics.setLayout(layout);
    else this.physics = new ScenePhysics(layout);
    this.locations = new Map(asArray(layout.locations).map((l) => [String(l.id), l]));
    this.racks = new Map(asArray(layout.racks).map((r) => [String(r.id), r]));
    const rear = layout.rearExpansionVersion ? -82 : -33, buildingDepth = 35 - rear, buildingCenter = (rear + 35) / 2;
    this.floorOcclusionValid = Boolean(this.models?.floorOcclusion && floorOcclusionMatches(layout,this.models.floorOcclusionLayout));
    const floor = this._layer('floor');
    const architecture = this._layer('architecture');
    const overhead = this._layer('overhead');
    const walls = this._layer('walls');
    const facade = this._layer('facade');
    const roof = this._layer('roof');
    const fixtures = this._layer('fixtures');
    const exterior = this._layer('exterior');
    this._box(floor, -12, -0.72, (rear - 10 + 127) / 2, 238, 1.3, 127 - (rear - 10), this._mat(0xb5b2a5, {texture:"concrete",repeat:[26,buildingDepth/4],roughness:.92}));
    this._box(floor, 0, -0.12, buildingCenter, 104, 0.3, buildingDepth + 2, this._mat(C.concrete, { texture: 'concrete', repeat: [26, buildingDepth / 4], roughness: 0.78 }));
    // Expansion joints, a physically continuous transverse transport lane and
    // protected front circulation. These are infrastructure, never stock.
    for (let x = -48; x <= 48; x += 8) this._box(floor, x, 0.034, buildingCenter, 0.035, 0.004, buildingDepth - 4, 0x9baeb9);
    for (let z = rear + 3; z <= 34; z += 8) this._box(floor, 0, 0.034, z, 100, 0.004, 0.035, 0x9baeb9);
    this._lane(floor, 0, 6, 99, 5.2, false);
    this._lane(floor, 0, 32, 98, 2.3, false);
    for (const zone of asArray(layout.zones)) {
      const w = n(zone.width, 12), d = n(zone.depth, 12), x = n(zone.x), z = n(zone.z);
      const type = String(zone.type || zone.id).toUpperCase();
      const tint = /FREEZ|CONG/.test(type) ? 0xc1c8c9 : /COLD|REFR|CHILL/.test(type) ? 0xc0c8c5
        : /RECE|ENTR/.test(type) ? 0xc5c7c1 : /QUAR|CUAR/.test(type) ? 0xc8bfb0
          : /PACK|PREP/.test(type) ? 0xc7c5bb : /DISPATCH|SHIP|EXP/.test(type) ? 0xc9c5ba : 0xc7c8c2;
      this._box(floor, x, 0.055, z, w - 0.5, 0.025, d - 0.5, this._mat(tint, { texture: 'concrete', repeat: [w / 4, d / 4], roughness: 0.72 }));

      this._label(zone.name || zone.label || zone.id, x, 0.11, z + d / 2 - 1.2, { width: Math.min(w - 2, 12), background: 'transparent', color: '#35425a', floor: true, parent: fixtures });
      this._register('zone', zone.id, [x, 0.16, z], [w - 0.8, 0.12, d - 0.8]);
    }
    this._register('warehouse', 'CD1', [0, 5.8, buildingCenter], [102, 11.6, buildingDepth], facade);
    // One building, two presentations: opaque exterior or a deliberate cutaway.
    // Neither camera mode changes the physical layout or equipment coordinates.
    for (let x = -50; x <= 50; x += 10) {
      this._box(architecture, x, 4.5, rear, 0.5, 9, 0.6, C.white);
      this._box(architecture, x, 4.5, 35, 0.5, 9, 0.6, C.white);
    }
    const depotWhite = this._mat(0xeff2e9, { texture: 'wall', repeat: [6, 2] }), roofBlue = this._mat(0x28677a, { texture: 'roof', repeat: [5, 10], metalness: .42, roughness: .64 }), blueEdge = 0x194b60;
    this._box(walls, 0, 5.6, rear, 101, 11.2, 0.55, depotWhite);
    // A full-height transfer aperture connects the new receiving annex. No
    // conveyor or inbound load passes through a solid perimeter wall.
    if (layout.automation) {
      let cursor = rear;
      for (const opening of [...(layout.rearCleaning ? [{z:-32,width:6}] : []),{z:17,width:5}]) {
        const left=opening.z-opening.width/2;
        if(left>cursor) this._box(walls,-50.7,5.6,(cursor+left)/2,.55,11.2,left-cursor,depotWhite);
        this._box(walls,-50.7,8.1,opening.z,.55,6.2,opening.width,depotWhite);
        cursor=opening.z+opening.width/2;
      }
      this._box(walls,-50.7,5.6,(cursor+35)/2,.55,11.2,35-cursor,depotWhite);
    } else this._box(walls, -50.7, 5.6, buildingCenter, 0.55, 11.2, buildingDepth, depotWhite);
    this._box(walls, 50.7, 5.6, buildingCenter, 0.55, 11.2, buildingDepth, depotWhite);
    if(layout.rearCleaning) {
      this._box(floor,-66.5,-.12,-55,33,.3,54,this._mat(C.concrete,{texture:'concrete',repeat:[4,6]}));
      this._box(floor,-66.5,.055,-55,32,.025,53,this._mat(0xadc3b1,{texture:'concrete',repeat:[8,13],roughness:.75}));
      this._box(walls,-83,5.6,-55,.55,11.2,54,depotWhite);
      for(const z of [rear,-28]) this._box(walls,-66.5,5.6,z,33,11.2,.55,depotWhite);
      this._box(roof,-66.5,11.5,-55,33,.24,54,roofBlue);
      this._label('LIMPIEZA · RESERVA SEGREGADA',-67,.11,-30,{width:24,floor:true,parent:fixtures});
    }
    for(const aisle of (layout.aisles || []).filter(a=>a.added)) {
      const x=aisle.zoneId==='DRY'?-24:aisle.zoneId==='COLD'?14:aisle.zoneId==='FROZEN'?38:-67;
      this._label(`PASILLO ${String(aisle.number).padStart(2,'0')}`,x,.12,aisle.z,{width:6,floor:true,parent:fixtures,color:'#42534f',background:'transparent'});
    }
    // Sandwich-panel joints, impact rails, downpipes and kick plates give the
    // nave a construction scale rather than a single smooth toy-like block.
    for (let x = -49; x <= 49; x += 2) {
      this._box(walls, x, 5.6, rear-.3, 0.035, 11.1, 0.05, 0xcbd7e5);
    }
    for (const x of [-50.36, 50.36]) {
      if (x > 0 || !layout.automation) this._box(walls, x, 0.3, buildingCenter, 0.06, 0.6, buildingDepth - 2.5, 0xb3bfd1);
      for (let z = rear + 1; z < 35; z += 1.25) if ((x > 0 || !layout.automation || z < 14.5 || z > 19.5) && (x > 0 || !layout.rearCleaning || Math.abs(z+32)>3)) this._box(walls, x * 1.014, 5.6, z, 0.045, 11.1, 0.04, 0xcbd7e5);
    }
    const panelJoint=this._mat(0xb9bfc0,{metalness:.12,roughness:.58});
    for(let x=-49;x<=49;x+=1.25)this._box(walls,x,5.6,rear+.302,.018,10.95,.025,panelJoint);
    for(const side of [-1,1])for(let z=rear+1;z<34;z+=1.25) {
      if(side<0 && layout.automation && Math.abs(z-17)<2.7)continue;
      if(side<0 && layout.rearCleaning && Math.abs(z+32)<3.2)continue;
      this._box(walls,side*50.405,5.6,z,.025,10.95,.018,panelJoint);
    }
    this._box(walls, 0, 0.3, rear+.33, 100, 0.6, 0.06, 0xb3bfd1);
    for (const x of [-50.98, 50.98]) {
      this._box(walls, x, 5.6, rear, 0.35, 11.2, 0.65, blueEdge);
      this._box(facade, x, 5.6, 35, 0.35, 11.2, 0.65, blueEdge);
    }
    const modelledFacade = this.models?.place(facade, 'DepotFront', [0, 0, 35]);
    if (modelledFacade) {
      const count = Math.ceil(buildingDepth/3.8);
      const span = buildingDepth/count;
      for (let panel = 0; panel < count; panel++) {
        const z = rear+(panel+.5)*span;
        this.models.place(facade, 'DepotSide', [50.7,0,z], [1,1,span], 0, false);
        if (panel % 5 === 1) this.models.place(facade, 'Downpipe', [50.7,0,z], [1,1,1], 0, false);
      }
    }
    if (!modelledFacade) for (const [left, right] of [[-50.5, -39], [-31, 25.3], [30.7, 41.3], [46.7, 50.5]]) {
      this._box(facade, (left + right) / 2, 5.6, 35, right - left, 11.2, 0.55, depotWhite);
      for (let x = Math.ceil(left); x < right; x += 0.8) this._box(facade, x, 5.6, 35.3, 0.035, 11.1, 0.05, 0xd0dbea);
      this._box(facade, (left + right) / 2, 0.25, 35.34, right - left, 0.5, 0.09, 0xb9c6d7);
    }
    if (!modelledFacade) this._box(facade, 0, 10.95, 35.38, 102, 0.18, 0.4, C.gold);
    this._label('RECEPCIÓN', -35, 7.4, 35.67, { width: 8, color: '#314c78', background: '#f4f7fc', parent: facade });
    this._label('01', 28, 7.25, 35.67, { width: 2, color: '#fff', background: '#2157ad', fontSize: 62, parent: facade });
    this._label('02', 44, 7.25, 35.67, { width: 2, color: '#fff', background: '#2157ad', fontSize: 62, parent: facade });
    for (const x of [-35, 28, 44]) {
      const half = x === -35 ? 4 : 2.7;
      if (!modelledFacade) this._box(facade, x, 8.35, 35, half * 2, 5.7, 0.55, depotWhite);
      if (!modelledFacade) for (const side of [-1, 1]) {
        this._box(facade, x + side * half, 2.8, 35.4, 0.48, 5.6, 1.02, blueEdge);
        this._box(facade, x + side * (half - 0.2), 2.8, 35.7, 0.13, 5.4, 0.2, 0xa7bad4);
        this._box(facade, x + side * (half + 0.08), 0.55, 35.98, 0.5, 1.1, 0.25, C.deep);
        this._shape(exterior, 'cylinder', C.gold, [x + side * (half + 0.65), 0.65, 36.1], [0.15, 1.3, 0.15]);
        this._shape(exterior, 'cylinder', C.deep, [x + side * (half + 0.65), 0.92, 36.1], [0.155, 0.2, 0.155]);
      }
      if (!modelledFacade) {
        this._box(facade, x, 5.62, 35.4, half * 2 + 0.48, 0.48, 1.02, blueEdge);
        this._box(facade, x, 6.15, 35.38, half * 2 + 0.48, 0.45, 0.65, depotWhite);
        for (let y = 5.8; y <= 6.35; y += 0.18) this._box(facade, x, y, 35.75, half * 2 - 0.2, 0.08, 0.12, 0xc3cfde);
        this._box(facade, x + half + 0.75, 3, 35.65, 0.3, 0.72, 0.18, C.deep);
        this._box(facade, x + half + 0.75, 3.14, 35.77, 0.15, 0.14, 0.025, 0xe4d28a);
      }
      this._outline(exterior, x, 43.2, 6.8, 14.4, C.gold, 0.13);
      for (const side of [-1, 1]) this._box(exterior, x + side * 3.4, 0.085, 49.5, 0.36, 0.03, 1.7, C.white);
      if (x !== -35) {
        const slope = -Math.atan2(1.2, 5.5);
        this._box(exterior, x, 0.6, 31.75, 3.1, 0.12, Math.hypot(5.5, 1.2), 0x778e9a, [slope, 0, 0]);
        for (const side of [-1, 1]) this._box(exterior, x + side * 1.6, 0.64, 31.75, 0.08, 0.08, Math.hypot(5.5, 1.2), C.gold, [slope, 0, 0]);
      }
    }
    this._brandSign(facade, -7, 7.5, 35.39, 15);
    if (modelledFacade) this._dockLighting(facade);
    this._coldRooms(architecture, walls, roof);
    // The reference depot has a distinctive sawtooth silhouette. Repeated
    // shallow north-light bays replace the broad featureless flat sheet while
    // staying wholly above the existing rooms, racking and operating paths.
    if (!this.geometry.has('depotGable')) {
      const section = new THREE.Shape();
      section.moveTo(-0.5, 0); section.lineTo(0.5, 0); section.lineTo(0.5, 1); section.closePath();
      const gable = new THREE.ExtrudeGeometry(section, { depth: 1, bevelEnabled: false, steps: 1 });
      gable.translate(0, 0, -0.5); this.geometry.set('depotGable', gable);
    }
    const roofSpan = 20.4, roofRise = 3.5, roofLow = 11.38, roofTilt = Math.atan2(roofRise, roofSpan);
    for (let bay = 0; bay < 5; bay++) {
      const left = -51 + bay * roofSpan, cx = left + roofSpan / 2;
      const modelledRoof = this.models?.place(roof, 'DepotRoof', [cx, roofLow, buildingCenter], [1, 1, buildingDepth+1.2]);
      if (!modelledRoof) this._box(roof, cx, roofLow + roofRise / 2, buildingCenter, Math.hypot(roofSpan, roofRise), 0.22, buildingDepth + 1.2, roofBlue, [0, 0, roofTilt]);
      for (const z of [rear-.55, 35.55]) {
        this._shape(roof, 'depotGable', depotWhite, [cx, 11.2, z], [roofSpan, roofRise + 0.18, 0.36]);
        this._box(roof, cx, roofLow + roofRise / 2 + 0.07, z, Math.hypot(roofSpan, roofRise) + 0.16, 0.18, 0.32, blueEdge, [0, 0, roofTilt]);
        for (let offset = 1.2; offset < roofSpan; offset += 1.6) {
          const h = (roofRise + 0.18) * offset / roofSpan;
          this._box(roof, left + offset, 11.2 + h / 2, z + (z > 0 ? 0.2 : -0.2), .065, h, .055, 0xc1d5d3);
        }
      }
      // Glazed vertical north-light strip and mullions along each roof step.
      const edge = left + roofSpan;
      if (modelledRoof) {
        const count = Math.ceil(buildingDepth/4.8), length = (buildingDepth + .6)/count;
        for (let pane = 0; pane < count; pane++)
          this.models.place(roof, 'Clerestory', [edge, roofLow, rear - .3 + (pane+.5)*length], [1,1,length]);
        continue;
      }
      this._box(roof, edge, roofLow + roofRise / 2, buildingCenter, 0.14, roofRise, buildingDepth+.8, 0xb9d4ec);
      this._box(roof, edge, roofLow + roofRise, buildingCenter, 0.24, 0.18, buildingDepth+1.6, blueEdge);
      this._box(roof, left, roofLow + 0.04, buildingCenter, 0.22, 0.16, buildingDepth+1.6, blueEdge);
      for (let z = rear+1; z < 35; z += 5) this._box(roof, edge + 0.08, roofLow + roofRise / 2, z, 0.08, roofRise, 0.075, 0x7296bf);
      for (let offset = 2.8; offset < roofSpan; offset += 2.8) this._box(roof, left + offset, roofLow + roofRise * offset / roofSpan + .18, buildingCenter, .14, .06, buildingDepth+.7, 0x3c7886);
    }
    const truss = this._mat(0x315574,{metalness:.12,roughness:.46});
    for (let x = -42; x <= 42; x += 14) {
      for (const y of [9.315,9.485]) this._box(overhead,x,y,buildingCenter,.18,.03,buildingDepth-3,truss);
      this._box(overhead,x,9.4,buildingCenter,.035,.14,buildingDepth-3,truss);
      this._box(overhead, x, 10.45, buildingCenter, 0.14, 0.16, buildingDepth-3, truss);
      for (let z = rear+1.5; z <= 31.5; z += 3.5) {
        this._box(overhead,x,9.92,z,.09,1.05,.09,truss);
        this._box(overhead,x,9.92,z+1.65,.075,.075,Math.hypot(3.3,1.05),truss,[Math.atan2(1.05,3.3),0,0]);
      }
      for (let z = rear+7; z <= 30; z += 14) {
        this._box(overhead, x, 9.55, z, 0.1, 0.1, 14.5, truss, [0.07, 0, 0]);
        this._box(overhead, x, 9.55, z, 0.1, 0.1, 14.5, truss, [-0.07, 0, 0]);
      }
      for (let z = rear+10; z <= 18; z += 18) {
        if (!this.models?.place(overhead,'PendantLamp',[x,9.18,z],[1,1,1],0,false)) {
          this._box(overhead, x, 9.2, z, 3, 0.11, 0.7, 0xdde5eb);
          this._box(overhead, x, 9.1, z, 2.8, 0.04, 0.5, this._mat(0xf4f6ec, { emissive: 0xe3eadc, emissiveIntensity: 0.4, roughness: 0.4 }));
        }
      }
    }
    for (const rack of asArray(layout.racks)) this._rack(fixtures,rack);
    this._rails(fixtures);
    for (const station of asArray(layout.stations)) this._station(fixtures, station);
    this._quarantine(fixtures);
    for (const station of asArray(layout.stations)) {
      const capacity = station.capacityHus || ({ RECEIVE: 12, PACK: 4, 'DOCK-1': 24, 'DOCK-2': 24, Q: 4, 'Q-COLD': 4, 'Q-FROZEN': 4 }[station.id] || 0);
      if (/^Q-/.test(station.id)) continue;
      for (let i = 0; i < capacity; i++) {
        const p = (station.id === 'RECEIVE' ? layout.automation?.receivingBufferSlots?.[i] : null) || asArray(layout.loadingDocks).find((dock) => dock.id === station.id)?.stagingSlots?.[i] || stagingPoint(station, i);
        this._outline(fixtures, p.x, p.z, LOAD.width + 0.14, LOAD.depth + 0.14, 0xc4c2ad, 0.04);
        for (const dx of [-0.53, 0.53]) for (const dz of [-0.4, 0.4]) this._box(fixtures, p.x + dx, .11, p.z + dz, .08, .14, .08, C.steel);
      }
    }
    // Frozen floor positions use insulated floor slots rather than imaginary
    // multilevel lifts. Empty positions remain empty in the map.
    for (const loc of asArray(layout.locations)) {
      const x = n(loc.x), y = n(loc.y, 0.2), z = n(loc.z);
      this._register('loc', loc.id, [x, Math.max(y, 0.3) + 0.65, z], [2.5, 1.4, 2.1]);
      if (!loc.rackId && !loc.rack_id) {
        this._outline(fixtures, x, z, 3, 2.6, 0xffffff, 0.1);
        // Automated floor-buffer stands leave a free docking well below the
        // pallet. A filled solid pedestal would intersect the shuttle itself.
        for (const dx of [-1.17, 1.17]) {
          this._box(fixtures, x + dx, 0.45, z, 0.12, 0.9, 1.8, C.steel);
          this._box(fixtures, x + dx * 0.63, 0.99, z, 0.24, 0.08, 1.65, this._mat(0xafbab5, { metalness: 0.65, roughness: 0.44 }));
          this._box(fixtures, x + dx * 0.81, 0.96, z, 0.65, 0.08, 0.15, C.steel);
        }
      }
    }
    // No decorative conveyor crosses the graph used by the AMRs. The only
    // rollers are the physical hand-off and consolidation stations.
    this._yard(exterior, branches);
    this._cityContext(exterior);
    if (layout.automation) this._automationAnnex(floor, architecture, walls, roof, exterior, overhead);
    this._buildRoadNetwork(exterior);
    Object.values(this.staticLayers).forEach((group) => this._finish(group));
    this.automation.build(layout, branches);
    this._applyView();
    if (!this.hasBuilt) { this.hasBuilt = true; this.setView(this.view); this.startupTimings.geometry = Math.round(now()-this.startedAt); }
    this._request();
    this.sun.shadow.needsUpdate = true;
  }

  _dockLighting(parent) {
    const geometry = this._geo('plane');
    const material = new THREE.MeshBasicMaterial({
      color: 0xffc37c, map: this.models.lightAtlas, side: THREE.DoubleSide,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .96,
    });
    this.generatedMaterials ||= new Set();
    this.generatedMaterials.add(material);
    const planes = this._instances(geometry, material, 15);
    const place = (i, x, y, z, w, h, rotation) => {
      this.dummy.position.set(x, y, z);
      this.dummy.rotation.set(rotation, 0, 0);
      this.dummy.scale.set(w, h, 1);
      this.dummy.updateMatrix();
      planes.setMatrixAt(i, this.dummy.matrix);
    };
    const luminaires = [-47, -23, 4, 19, 35.5, 49];
    luminaires.forEach((x, i) => {
      place(i, x, 4.35, 35.372, 9.2, 7.45, Math.PI);
      place(i+6, x, .076, 40.7, 12, 11, Math.PI/2);
    });
    [-35, 28, 44].forEach((x, i) => place(i+12, x, .079, 43, 12, 15.5, Math.PI/2));
    planes.computeBoundingSphere();
    planes.renderOrder = 2;
    planes.userData.ownedResources = [material];
    parent.add(planes);
  }

  _outline(parent, x, z, w, d, color, thickness = 0.12) {
    if (color === C.gold && parent !== this.staticLayers.exterior) return;
    color = this._mat(color, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    this._box(parent, x, 0.082, z - d / 2, w, 0.025, thickness, color);
    this._box(parent, x, 0.082, z + d / 2, w, 0.025, thickness, color);
    this._box(parent, x - w / 2, 0.082, z, thickness, 0.025, d, color);
    this._box(parent, x + w / 2, 0.082, z, thickness, 0.025, d, color);
  }

  _automationAnnex(floor, architecture, walls, roof, exterior, overhead) {
    const wall = this._mat(0xe8ece7, { texture: 'wall', repeat: [8, 3], roughness: .74 });
    const concrete = this._mat(C.concrete, { texture: 'concrete', repeat: [8.25, 8], roughness: .7 });
    this._box(floor, -66.5, -.12, 18, 33, .3, 32, concrete);
    this._box(floor, -66.5, .055, 17, 31.5, .025, 9, this._mat(0xb9bcb9, { texture: 'epoxy', repeat: [8, 2.25], roughness: .56 }));
    this._outline(floor, -66.5, 17, 31.5, 9, C.gold, .1);
    for (let x = -82; x < -50; x += 4) this._box(floor, x, .034, 18, .035, .004, 32, 0x9b9e96);
    for (const z of [2, 34]) {
      this._box(walls, -66.5, 5.5, z, 33, 11, .38, wall);
      this._box(walls, -66.5, .27, z + (z === 2 ? .24 : -.24), 33, .54, .14, C.steel);
      for (let x = -82; x < -50; x += 4) {
        this._box(walls, x, 5.5, z, .23, 11, .5, C.blue);
        if (z === 2) this._box(overhead, x, 9.7, 18, .16, .24, 31.5, C.steel);
      }
    }
    for (const [z, length] of [[8.25,12.5],[26.75,14.5]]) this._box(walls, -83, 5.5, z, .4, 11, length, wall);
    this._box(walls, -83, 8, 17, .4, 6, 5, wall);
    for (const x of [-83, -50.7]) {
      for (const z of [14.5,19.5]) this._box(architecture, x, 2.5, z, .72, 5, .28, C.blue);
      this._box(architecture, x, 5.1, 17, .72, .26, 5.4, C.blue);
    }
    this._box(roof, -66.5, 11.45, 18, 34, .18, 33, this._mat(0x28677a, { texture: 'roof', repeat: [6, 5], metalness: .42, roughness: .64 }), [0,0,.025]);
    for (const z of [2,34]) this._box(roof, -66.5, 11.4, z, 34, .24, .22, C.blue);
    for (const x of [-76,-64,-54]) {
      this._box(overhead,x,9.4,17,2.3,.15,.75,C.steel);
      this._box(overhead,x,9.3,17,2.1,.05,.6,this._mat(0xf6f5e8,{emissive:0xfff1cb,emissiveIntensity:.7}));
    }

    // A dedicated supplier apron remains clear of the west office, shop road
    // and outbound fleet. The docked supplier vehicle belongs to its ASN job.
    this._box(exterior,-97,-.04,18,27,.2,32,this._mat(C.concrete,{texture:'concrete',repeat:[7,8]}));
    this._road(exterior,-104,18,-104,60,7);
    this._outline(exterior,-94,17,20,5,C.gold,.12);
    for(const z of [14.3,19.7]) for(let x=-103;x<-84;x+=2.4) this._box(exterior,x,.12,z,1.1,.03,.12,C.white);
    for(const z of [13.6,20.4]) {
      this._shape(exterior,'cylinder',C.gold,[-84,.65,z],[.15,1.3,.15]);
      this._shape(exterior,'cylinder',C.dark,[-84,.9,z],[.16,.2,.16]);
    }
  }

  _lane(parent, x, z, w, d, vertical = false) {
    this._box(parent, x, 0.065, z, w, 0.025, d, this._mat(0x737b7c, { texture: 'epoxy', repeat: [w / 4, d / 4], roughness: 0.58 }));
    this._outline(parent, x, z, w, d, C.gold, 0.12);
    const length = vertical ? d : w;
    for (let a = -length / 2 + 2; a < length / 2; a += 6) this._box(parent, x + (vertical ? 0 : a), 0.087, z + (vertical ? a : 0), vertical ? 0.12 : 2.4, 0.02, vertical ? 2.4 : 0.12, 0xe4eadf);
  }

  _coldRooms(architecture, walls, roof) {
    const rear=this.layout.rearExpansionVersion ? -81 : -30;
    for (const room of [{ x:14,w:25.5,name:'REFRIGERADO',color:C.cold },{ x:38,w:20.5,name:'CONGELADO',color:C.frost }]) {
      const left=room.x-room.w/2,right=room.x+room.w/2;
      for(const x of [left,right]) {
        const gaps=room.x===14 && x===left ? [-16,...(this.layout.rails || []).filter(r=>r.zoneId==='COLD' && r.id!=='STACKER-2').map(r=>r.z)].sort((a,b)=>a-b) : [];
        let cursor=rear;
        const panel = this._mat(0xe4e3dc,{texture:'wall',roughness:.47,metalness:0,repeat:[1,4]});
        for(const z of gaps){ if(z-2>cursor)this._box(walls,x,3.9,(cursor+z-2)/2,.35,7.8,z-2-cursor,panel);this._box(walls,x,6.2,z,.35,3.2,4,C.cold);cursor=z+2; }
        if(-4>cursor)this._box(walls,x,3.9,(cursor-4)/2,.35,7.8,-4-cursor,panel);
      }
      const door = room.x;
      this._box(architecture, left + (door - left - 4) / 2, 3.5, -4, door - left - 4, 7, 0.4, C.white);
      this._box(architecture, right - (right - door - 4) / 2, 3.5, -4, right - door - 4, 7, 0.4, C.white);
      this._box(architecture, door, 6.1, -4, 8, 1.8, 0.5, room.color);
      this._box(architecture, door - 4.05, 2.2, -4, 0.25, 4.4, 0.65, C.blue);
      this._box(architecture, door + 4.05, 2.2, -4, 0.25, 4.4, 0.65, C.blue);
      for (let x = door - 3.6; x < door + 3.8; x += 0.65) this._box(architecture, x, 2.1, -4.1, 0.55, 4.2, 0.055, this._mat(room.color, { transparent: true, opacity: 0.23, depthWrite: false }));
      this._label(room.name, room.x, 5.8, -3.62, { width: 9, color: '#274a68', background: '#f1fbff', fontSize: 32, parent: architecture });
      for (const x of [left + 1.1, right - 1.1]) {
        this._box(architecture, x, 0.5, -3.4, 0.35, 1, 0.35, C.gold);
        this._box(architecture, x, 0.7, -3.4, 0.4, 0.2, 0.4, C.dark);
      }
      this._box(roof, room.x, 9.7, (rear-2)/2, room.w, 0.3, -2-rear, C.white);
      this._box(roof, room.x, 10.4, -19, 5.4, 1.3, 3.5, C.steel);
      for (const x of [room.x - 1.3, room.x + 1.3]) this._shape(roof, 'cylinder', C.dark, [x, 11.1, -19], [0.75, 0.13, 0.75]);
    }
  }

  _rack(parent, rack) {
    const x = n(rack.x), z = n(rack.z), width = n(rack.width, 7), depth = n(rack.depth, 3.8), levels = n(rack.levels, 3);
    const slots = asArray(this.layout.locations).filter((loc) => String(loc.rackId) === String(rack.id));
    const shelfLevels = [...new Set(slots.map((loc) => n(loc.y, 0.8)))].sort((a, b) => a - b);
    const step = shelfLevels.length > 1 ? shelfLevels[1] - shelfLevels[0] : 3.2;
    const height = Math.max(8.9, ...shelfLevels.map((y) => y + 1.8));
    const upright = this._mat(0xaab4b9, {texture:'metal',metalness:.78,roughness:.43,repeat:[1,4]});
    for (const dx of [-width / 2, width / 2]) {
      for (const dz of [-depth / 2, depth / 2]) {
        const modelled = this.models?.parts.has('RackUpright');
        if (modelled) for (let y = 0; y < height; y += 1)
          this.models.place(parent, 'RackUpright', [x+dx, y, z+dz], [1,Math.min(1,height-y),1]);
        if (modelled) this.models.place(parent, 'RackFoot', [x+dx, 0, z+dz]);
        else {
          this._box(parent,x+dx,height/2,z+dz-.08,.2,height,.04,upright);
          for(const flange of [-.08,.08]) this._box(parent,x+dx+flange,height/2,z+dz,.04,height,.2,upright);
          this._box(parent, x + dx, 0.055, z + dz, 0.36, 0.1, 0.36, upright);
          for(const anchor of [-.13,.13]) this._shape(parent,'bolt',upright,[x+dx+anchor,.12,z+dz+.12],[.035,.035,.035]);
          this._box(parent, x + dx, 0.35, z + dz, 0.28, 0.6, 0.28, C.gold);
        }
        for (let y = 0.9; y < height - 0.1; y += 0.48) this._shape(parent, 'plane', this._mat(0x172c39, { side: THREE.DoubleSide }), [x + dx + (dx > 0 ? -.105 : .105), y, z + dz], [0.065, 0.09, 1], [0, Math.PI / 2, 0]);
      }
      for (let level = 0; level < levels; level++) {
        const base = n(shelfLevels[level], 0.8 + level * step), rise = Math.min(step, height - base);
        const y = base + rise / 2, braceLength = Math.hypot(depth, rise);
        this._box(parent, x + dx, y, z, 0.055, 0.07, braceLength, upright, [Math.atan2(rise, depth), 0, 0]);
        this._box(parent, x + dx, y, z, 0.055, 0.07, braceLength, upright, [-Math.atan2(rise, depth), 0, 0]);
      }
    }
    for (let level = 0; level < levels; level++) {
      const y = n(shelfLevels[level], 0.8 + level * step);
      for (const dz of [-depth / 2, depth / 2]) {
        if (!this.models?.place(parent, 'RackBeam', [x,y,z+dz], [width+.02,1,1], dz < 0 ? Math.PI : 0))
          this._box(parent, x, y, z + dz, width + 0.02, 0.24, 0.2, C.orange);
        for (const dx of [-width / 2 + 0.14, width / 2 - 0.14]) {
          if (!this.models?.place(parent, 'RackConnector', [x+dx,y,z+dz+.09])) {
            this._box(parent, x + dx, y, z + dz + 0.09, 0.16, 0.33, 0.045, 0xa44c26);
            this._shape(parent, 'bolt', 0xb9c1bd, [x + dx, y, z + dz + 0.12], [0.035, 0.035, 0.02]);
          }
        }
      }
      // Open galvanized decking exposes the load supports and catches light
      // between slats, rather than looking like a solid blue plastic shelf.
      for(let slat=-depth/2+.12;slat<depth/2;slat+=.24)
        this._box(parent,x,y+.02,z+slat,width-.2,.055,.1,upright);
      for (const dx of [-width * 0.3, 0, width * 0.3]) this._box(parent, x + dx, y - 0.1, z, 0.075, 0.2, depth - 0.1, C.steel);
      for (const dx of [-width / 4, width / 4]) this._box(parent, x + dx, y - 0.01, z + depth / 2 + 0.095, 0.6, 0.12, 0.025, 0xf6f8ee);
    }
    this._label(rack.name || rack.code || rack.id, x, height - 0.45, z + depth / 2 + 0.1, { width: Math.min(width, 1.8), background: '#33424a', color: '#eee4bf', fontSize: 32, parent });
    this._register('rack', rack.id, [x, height / 2, z], [width + 0.15, height, depth + 0.15]);
  }

  _rails(parent) {
    for (const rail of this.layout.rails || [{ z: -12, left: -43, right: -2 }, { z: -16, left: 1, right: 27 }]) {
      for (const dz of [-0.65, 0.65]) this._box(parent, (rail.left + rail.right) / 2, 0.12, rail.z + dz, rail.right - rail.left, 0.12, 0.12, C.steel);
      this._box(parent, (rail.left + rail.right) / 2, 8.9, rail.z, rail.right - rail.left, 0.12, 0.16, C.steel);
      for (const x of [rail.left, rail.right]) this._box(parent, x, 0.3, rail.z, 0.3, 0.6, 1.7, C.gold);
    }
    // A dedicated fixed rail transfer system serves frozen floor positions.
    const frozenZ=asArray(this.layout.locations).filter(l=>l.zoneId==='FROZEN').map(l=>l.z), rear=Math.min(-28,...frozenZ)-2;
    for (const x of [37.55,38.45]) this._box(parent,x,.13,(rear-3)/2,.09,.12,-3-rear,C.steel);
    for (const z of [...new Set(frozenZ)]) for (const dz of [-0.45, 0.45]) this._box(parent, 38, 0.13, z + dz, 11, 0.12, 0.09, C.steel);
  }

  _station(parent, station) {
    const x = n(station.x), z = n(station.z), type = String(station.type || '').toUpperCase();
    this._register('station', station.id, /^DOCK/.test(type) ? [x, 2.6, 35.6] : [x, 0.5, z], /^DOCK/.test(type) ? [5.4, 5.2, 0.6] : [4, 1.3, 3], /^DOCK/.test(type) ? this.staticLayers.exterior : parent);
    if (/QUAR/.test(type)) return;
    if (station.id === 'RECEIVE' && this.layout.automation) return;
    if (/CHARG/.test(type)) {
      const modelled = this.models?.place(parent, 'Charger', [x,0,z-.8], [1.8, 1.35, 1.25]);
      if (!modelled) {
        this._box(parent, x, 0.12, z, 3.1, 0.2, 2.4, C.deep);
        this._shape(parent,'machineShell',this._mat(C.deep,{roughness:.38}),[x,.9,z-1.1],[2.2,1.5,.35]);
        this._box(parent,x,1.55,z-.91,2,.07,.02,C.gold);
        this._box(parent, x, 1.14, z - 0.88, 0.8, 0.4, 0.04, C.green);
        for(const side of [-1,1]){
          this._box(parent,x+side*.55,.48,z-.84,.12,.28,.1,this._mat(0x9ca5aa,{metalness:.8,roughness:.3}));
          for(let y=.4;y<1.4;y+=.13)this._box(parent,x+side*.95,y,z-.91,.08,.035,.03,C.deep);
        }
      }
      this._label('CARGA', x, 1.45, z - .88, { width:.8,fontSize:28,parent });
    } else if (/PACK|PICK/.test(type)) {
      if (this.layout.automation) return;
      this._outline(parent, x, z, 5.2, 4.5, C.gold);
      // Open docking well: an AMR fits below the transfer rails; there is no
      // solid table inside the authoritative arrival point.
      for (const dx of [-1.25, 1.25]) {
        this._box(parent, x + dx, 0.46, z, 0.18, 0.92, 2.5, C.steel);
        this._box(parent, x + dx * 0.59, 1.02, z, 0.3, 0.1, 2.5, this._mat(0xc8d0ce, { texture: 'metal', metalness: 0.65 }));
        this._box(parent, x + dx * 0.78, 0.97, z, 0.7, 0.12, 0.22, C.steel);
      }
      // A fictional enclosed case-consolidation gantry, not the Mecalux
      // single-item picking arm (which has a different load capability).
      for (const dx of [-2, 2]) this._box(parent, x + dx, 2, z - 1.2, 0.22, 4, 0.25, C.purple);
      this._box(parent, x, 4.1, z - 1.2, 4.5, 0.3, 0.6, C.deep);
      this._box(parent, x, 3.55, z - 1.2, 0.75, 0.9, 0.75, C.gold);
      this._box(parent, x, 3.4, z - 1.2, 1.8, 0.12, 1.6, C.steel);
      this._label(station.name || 'PREPARACIÓN', x, 3.7, z - 1.5, { width: 5, parent });
      for (const dx of [-2.5, 2.5]) this._box(parent, x + dx, 1.6, z - 2, 0.08, 3.2, 0.1, C.gold);
    } else if (/DOCK/.test(type)) {
      this._outline(parent, x, z, 5.2, 3.5, C.gold, 0.1);
      for (const dx of [-2.4, 2.4]) this._box(parent, x + dx, 0.5, z + 1, 0.3, 1, 0.3, C.gold);
      this._label(station.name || 'MUELLE', x, 0.13, z - 1.8, { width: 5, floor: true, parent });
    } else {
      for (const dx of [-1.25, 1.25]) {
        this._box(parent, x + dx, 0.4, z, 0.2, 0.8, 2.2, C.steel);
        this._box(parent, x + dx * 0.59, 1.02, z, 0.3, 0.1, 2.3, C.steel);
        this._box(parent, x + dx * 0.78, 0.97, z, 0.7, 0.12, 0.22, C.steel);
      }
      for (const dz of [-0.82, -0.4, 0, 0.4, 0.82]) for (const dx of [-0.74, 0.74]) this._shape(parent, 'cylinder', 0xc2cbca, [x + dx, 1.07, z + dz], [0.065, 0.3, 0.065], [0, 0, Math.PI / 2]);
      this._outline(parent, x, z, 4.2, 3.3, /RECE/.test(type) ? C.green : C.gold);
    }
  }

  _conveyor(parent, x, z, length, axis) {
    const alongX = axis === 'x';
    const xx = (v) => x + (alongX ? v : 0), zz = (v) => z + (alongX ? 0 : v);
    for (const side of [-0.9, 0.9]) this._box(parent, x + (alongX ? 0 : side), 0.75, z + (alongX ? side : 0), alongX ? length : 0.15, 0.22, alongX ? 0.15 : length, C.purple);
    for (let v = -length / 2; v <= length / 2; v += 0.5) {
      this._shape(parent, 'cylinder', 0xb9c6ce, [xx(v), 0.83, zz(v)], [0.12, 1.7, 0.12], [alongX ? Math.PI / 2 : 0, 0, alongX ? 0 : Math.PI / 2]);
      if (Math.abs(v % 3) < 0.1) for (const side of [-0.7, 0.7]) this._box(parent, xx(v) + (alongX ? 0 : side), 0.4, zz(v) + (alongX ? side : 0), 0.1, 0.7, 0.1, C.steel);
    }
  }

  _quarantine(parent) {
    if(this.layout.stations.some(station=>station.id==='Q-CLEANING')){
      this._outline(parent,-76,-32,7,6,C.red,.12);
      this._box(parent,-76,1.1,-35,7,2.2,.12,C.steel);
      for(const x of [-79.4,-72.6]) this._box(parent,x,1.1,-33,.12,2.2,4,C.steel);
      this._label('RETENIDO · LIMPIEZA',-76,2.5,-34.9,{width:6,parent,color:'#f3ce60',background:'#273831'});
    }

    for (const compartment of [{ x: -18, name: 'RETENIDO · FRÍO', color: C.cold }, { x: -10, name: 'RETENIDO · CONGELADO', color: C.frost }]) {
      const x = compartment.x;
      this._box(parent, x, 0.25, 18.15, 4.1, 0.5, 3.4, C.steel);
      this._box(parent, x, 1.9, 16.5, 4.1, 3.8, 0.24, C.white);
      for (const dx of [-2, 2]) this._box(parent, x + dx, 1.9, 18.15, 0.2, 3.8, 3.3, this._mat(C.white, { texture: 'metal' }));
      this._box(parent, x, 3.9, 19, 4.3, 0.25, 5.3, compartment.color);
      // Service bay is open while the automated transfer is available. Its
      // sliding insulated door is parked beside the opening, not through an AMR.
      this._box(parent, x - 2.13, 2.1, 17.9, 0.12, 3.3, 2.8, compartment.color);
      for (const side of [-1, 1]) this._box(parent, x + side * 1.94, 2.0, 19.75, 0.12, 3.7, 0.17, C.blue);
      this._box(parent, x + 2.12, 2, 18.9, 0.08, 1, 0.16, C.steel);
      this._label(compartment.name, x, 3.5, 21.75, { width: 3.6, background: '#422256', color: '#f1ce60', fontSize: 23, parent });
    }
    for (const x of [-15.9, -12.1]) for (const z of [22.35, 26.6]) this._box(parent, x, 1, z, 0.08, 2, 0.08, C.orange);
    this._label('RETENIDO · AMBIENTE', -14, 0.11, 25.7, { width: 5.4, floor: true, background: 'transparent', fontSize: 28, parent });
  }

  _road(parent, ax, az, bx, bz, width = 8) {
    const length = Math.hypot(bx - ax, bz - az);
    if (length < 0.1) return;
    this.roadSegments.push({ ax, az, bx, bz, width });
  }

  _buildRoadNetwork(parent) {
    const segments = this.roadSegments || [], roads = segments.map(segment => roadRectangle(segment));
    const draw = (rect, y, h, material) => this._box(parent, (rect.minX + rect.maxX) / 2, y, (rect.minZ + rect.maxZ) / 2, rect.maxX - rect.minX, h, rect.maxZ - rect.minZ, material);
    for (const rect of unionRoadRectangles(segments.map(segment => roadRectangle(segment, 1.4)))) draw(rect, -.045, .09, 0xe5eae2);
    const asphalt = this._mat(C.road, { texture: 'asphalt', roughness: .9 });
    for (const rect of unionRoadRectangles(roads)) draw(rect, .045, .08, asphalt);
    segments.forEach((segment, index) => {
      const horizontal = Math.abs(segment.bx - segment.ax) >= Math.abs(segment.bz - segment.az), r = roads[index];
      const other = roads.filter((_, i) => i !== index);
      const paint = rect => { for (const p of clearRoadMarkings(rect, other)) draw(p, .112, .014, this._mat(0xf6f5e8, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })); };
      for (const side of [-1, 1]) {
        const offset = side * (segment.width / 2 - .28), half = .055;
        paint(horizontal ? { minX:r.minX,maxX:r.maxX,minZ:segment.az+offset-half,maxZ:segment.az+offset+half }
          : { minX:segment.ax+offset-half,maxX:segment.ax+offset+half,minZ:r.minZ,maxZ:r.maxZ });
      }
      const length = Math.hypot(segment.bx-segment.ax,segment.bz-segment.az);
      for (let d=3;d<length-2;d+=6) {
        const x=segment.ax+(segment.bx-segment.ax)*d/length,z=segment.az+(segment.bz-segment.az)*d/length;
        paint(horizontal ? {minX:x-1.4,maxX:x+1.4,minZ:z-.07,maxZ:z+.07} : {minX:x-.07,maxX:x+.07,minZ:z-1.4,maxZ:z+1.4});
      }
    });
  }

  _yard(parent, branches) {
    const depotWhite = 0xf4f7fc, blueEdge = 0x2157ad;
    this._box(parent, -20, -0.04, 48, 152, 0.2, 26, this._mat(C.concrete, { texture: 'concrete', repeat: [38, 6.5] }));
    // Clear aprons and painted walkways follow the real loading portals. They
    // never introduce a pretend dock or obstruct the trucks' authoritative lane.
    this._box(parent, -2, 0.025, 36.65, 100, 0.05, 2.5, 0xeaf0f8);
    for (const [left, right] of [[-50, -40], [-30, 24], [32, 40], [48, 50]]) {
      this._box(parent, (left + right) / 2, 0.07, 37.9, right - left, 0.03, 0.14, C.gold);
    }
    for (let x = -50; x < 54; x += 5) this._box(parent, x, 0.075, 52.5, 2, 0.025, 0.12, C.gold);
    this._road(parent, -110, 60, 90, 60, 8);
    // The returning fleet turns in a real concrete pocket before backing into
    // its bays; the old narrow rectangle left that manoeuvre on bare ground.
    this._box(parent, 20, -.04, 74, 84, .2, 32, this._mat(C.concrete, { texture:'concrete',repeat:[7,3] }));
    for (const x of [29, 38, 47]) {
      this._outline(parent, x, 75, 5, 19.5, C.white, 0.12);
      this._box(parent, x, 0.1, 85, 5, 0.02, 0.2, C.gold);
      for (const dx of [-1.6, 1.6]) this._box(parent, x + dx, 0.2, 85, 0.75, 0.2, 0.3, 0xb7c6da);
    }
    // Office block, a transparent entrance and a guarded vehicle gate.
    const office = new THREE.Group(); office.userData.batches = new Map(); parent.add(office);
    office.position.z = this.layout.automation ? -32 : 0;
    this._box(office, -64, 0.08, 14, 19.2, 0.25, 21.2, 0xeaf0f8);
    this._box(office, -64, 2.1, 14, 18, 4.2, 20, depotWhite);
    this._box(office, -64, 4.4, 14, 19, 0.4, 21, blueEdge);
    this._box(office, -64, 4.64, 14, 18.5, 0.08, 20.5, 0xd1dce9);
    for (const x of [-73.1, -54.9]) this._box(office, x, 2.1, 24.1, 0.25, 4.2, 0.3, blueEdge);
    for (let z = 7; z < 23; z += 4) {
      this._box(office, -54.94, 2.1, z, 0.08, 2.3, 2.8, 0x8fb1d1);
      this._box(office, -54.87, 2.1, z, 0.06, 2.35, 0.06, 0xeaf0f8);
    }
    this._box(office, -64, 1.8, 24.05, 4, 3.6, 0.06, 0x8fb1d1);
    this._box(office, -64, 1.8, 24.12, 0.07, 3.6, 0.05, 0xeaf0f8);
    this._box(office, -64, 3.9, 25.2, 7.5, 0.18, 2.7, depotWhite);
    this._box(office, -64, 3.88, 26.55, 7.5, 0.22, 0.1, C.gold);
    this._brandSign(office, -64, 3.1, 24.15, 9);
    for (const z of [9, 19]) {
      this._box(office, -64, 5, z, 4.6, 0.65, 3, depotWhite);
      for (const dx of [-1.1, 1.1]) {
        this._shape(office, 'cylinder', 0x617a98, [-64 + dx, 5.36, z], [0.65, 0.08, 0.65]);
        this._box(office, -64 + dx, 5.42, z, 1.1, 0.04, 0.08, 0xb4c3d8, [0, 0.7, 0]);
      }
    }
    this._finish(office);
    this._box(parent, -55, 1.4, 36, 4, 2.8, 4, depotWhite);
    this._box(parent, -55, 3, 36, 4.5, 0.4, 4.5, blueEdge);
    this._box(parent, -55, 1.7, 38.05, 3.1, 1.2, 0.06, 0x8fb1d1);
    this._box(parent, -52.95, 1.7, 36, 0.06, 1.2, 3.1, 0x8fb1d1);
    this._box(parent, -51.4, 1.2, 42, 0.4, 2.4, 0.4, C.deep);
    this._box(parent, -47.8, 2.2, 42, 7, 0.24, 0.28, C.white);
    for (let x = -50; x < -45; x += 1) this._box(parent, x, 2.21, 42.16, 0.42, 0.25, 0.02, C.red);
    const fenceRear=(this.layout.bounds?.minZ ?? -33)-3, fenceDepth=52-fenceRear, fenceCenter=(52+fenceRear)/2;
    for (const x of [-112, 59]) {
      this._box(parent, x + (x < 0 ? -1.9 : 1.9), -0.02, fenceCenter, 4.4, 0.18, fenceDepth, 0xc5e4cf);
      this._box(parent, x, 0.14, fenceCenter, 0.32, 0.28, fenceDepth, 0xeaf0f8);
      for (let z = fenceRear; z <= 52; z += 5.6) this._box(parent, x, 1.35, z, 0.12, 2.7, 0.12, 0x91a8c3);
      for (let z = fenceRear; z <= 52; z += 0.8) this._box(parent, x, 1.25, z, 0.025, 2.15, 0.025, 0xbbcadd);
      for (const y of [0.35, 2.4]) this._box(parent, x, y, fenceCenter, 0.065, 0.06, fenceDepth, 0x91a8c3);
    }
    this._box(parent, -26, 0.14, fenceRear, 172, 0.28, 0.32, 0xeaf0f8);
    for (let x = -112; x <= 60; x += 5.6) this._box(parent, x, 1.35, fenceRear, 0.12, 2.7, 0.12, 0x91a8c3);
    for (let x = -112; x < 60; x += 0.8) this._box(parent, x, 1.25, fenceRear, 0.025, 2.15, 0.025, 0xbbcadd);
    for (const y of [0.35, 2.4]) this._box(parent, -26, y, fenceRear, 172, 0.06, 0.065, 0x91a8c3);
    for (const x of [-114, 61]) for (const z of [-27, -10, 7, 24, 41]) this._tree(parent, x, z);
    for (const [x, z] of [[-45, 55], [18, 83], [57, 83]]) this._tree(parent, x, z);
    // Pedestrian crossing stays clear of the receiving portal and truck bays.
    for (let z = 56.4; z < 64; z += 1.2) this._box(parent, -66, 0.104, z, 4, 0.025, 0.55, 0xf6f9ff);
    for (const x of [-62, -23, 18, 60]) {
      this._box(parent, x, 3.5, 52, 0.15, 7, 0.15, C.steel);
      this._box(parent, x + 0.8, 7, 52, 1.9, 0.14, 0.15, C.steel);
      this._box(parent, x + 1.6, 6.9, 52, 0.8, 0.15, 0.4, 0xf8eed0);
    }
    for (const [index, branch] of asArray(branches).entries()) {
      // Branch coordinates are the authoritative truck delivery bay, not the
      // middle of a building. Set the shop twelve metres beyond that bay.
      const x = n(branch.x), bayZ = n(branch.z, 70), z = bayZ + 19;
      const receivingZ=n(branch.receivingPoint?.z,bayZ+12),approachX=x-24;
      if (Math.abs(receivingZ-60)>.1) {
        this._road(parent, approachX, 60, approachX, receivingZ, 6.5);
        this._road(parent, approachX, receivingZ, x, receivingZ, 6.5);
      }
      this._box(parent, x, -0.12, z - 4, 23, 0.16, 24, 0xdde6e0);
      this._outline(parent, x, bayZ, 5, 9.5, C.gold, 0.1);
      const storefronts = ['StoreCorner','StoreArcade','StoreStreet'];
      const storefront = this.models?.place(parent, storefronts[index % storefronts.length], [x,0,z]);
      if (!storefront) {
        this._box(parent, x, 2.3, z, 14, 4.6, 9, C.white);
        this._box(parent, x, 4.8, z, 15, 0.45, 10, C.purple);
        // The finish sits above the roof slab rather than 5 mm inside its top
        // face, which competed for depth at the exterior camera's distance.
        this._box(parent, x, 5.09, z, 14.4, 0.08, 9.4, this._mat(0xaab0aa, { texture: 'metal', metalness: 0.55 }));
        this._box(parent, x, 4.13, z + 4.6, 14, 1.15, 0.25, C.deep);
      }
      // Individual metal letters are mounted on the building's continuous
      // fascia, not suspended above the roof on a billboard frame.
      const signWidth=3.8,signHeight=signWidth/2.85,signBottom=4.74-signHeight/2;
      this._box(parent,x,4.74,z+4.99,14.95,1.52,.32,C.deep);
      this._brandSign(parent,x,4.74,z+5.19,signWidth);
      this.storeSignPlacements.push({branchId:branch.id,roofTop:5.13,signBottom,signTop:signBottom+signHeight,mounting:'facade',fasciaBottom:3.98,fasciaTop:5.5});
      if (!storefront) {
        for (const dx of [-4.5, -1.5, 1.5, 4.5]) this._box(parent, x + dx, 1.9, z + 4.56, 2.4, 3.1, 0.08, 0x8aadc0);
        for (const dx of [-6.8, -3.1, 0, 3.1, 6.8]) this._box(parent, x + dx, 1.8, z + 4.65, 0.07, 3.4, 0.08, 0x636d70);
      }
      this._box(parent, x, 1.4, z - 4.56, 2.7, 2.8, 0.12, this._mat(0xb4bcb9, { texture: 'metal', metalness: 0.45 }));
      this._label('RECEPCIÓN', x, 3.4, z - 4.67, { width: 3.8, color: '#39494a', background: '#e6e8e3', parent, fontSize: 30 }).rotation.y = Math.PI;
      if (!storefront) for (let dx = -6.5; dx < 7; dx += 1.35) this._box(parent, x + dx, 3.4, z + 5.1, 1.35, 0.18, 1.4, Math.round((dx + 6.5) / 1.35) % 2 ? C.gold : C.white, [0.15, 0, 0]);
      this._label(branch.name || branch.id, x, .13, z + 7.6, { width: 15, background:'transparent', color: '#274b52', floor: true, fontSize: 34, parent });
      this._register('branch', branch.id, [x, 3.75, z], [15.5, 7.5, 10.5]);
      // The receiving platform and its accumulation lanes occupy the west
      // side. Landscaping belongs on the opposite public-facing frontage.
      this._tree(parent, x + 11, z + 2);
    }
  }

  _cityContext(parent) {
    this.exteriorDetails = buildExteriorContext(this, parent);
  }

  _tree(parent, x, z) {
    if (!this.leafMaterials) {
      const canvas=document.createElement('canvas');canvas.width=128;canvas.height=256;
      const ctx=canvas.getContext('2d'),gradient=ctx.createLinearGradient(15,0,115,256);
      gradient.addColorStop(0,'#b2c385');gradient.addColorStop(.5,'#ecedbb');gradient.addColorStop(1,'#809654');
      ctx.fillStyle=gradient;ctx.beginPath();ctx.moveTo(64,8);ctx.bezierCurveTo(120,60,114,170,64,247);ctx.bezierCurveTo(15,165,6,58,64,8);ctx.fill();
      ctx.strokeStyle='rgba(210,223,156,.65)';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(64,12);ctx.lineTo(64,247);ctx.stroke();
      for(let y=40;y<230;y+=25){ctx.beginPath();ctx.moveTo(64,y+15);ctx.lineTo(28,y-10);ctx.moveTo(64,y+15);ctx.lineTo(100,y-10);ctx.stroke();}
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=8;this.textures.add(texture);
      this.generatedMaterials ||= new Set();
      this.leafMaterials=[0x657d43,0x738b4f,0x59733f].map(color=>{
        const material=new THREE.MeshStandardMaterial({color,map:texture,alphaTest:.15,alphaToCoverage:true,side:THREE.DoubleSide,roughness:.85,metalness:0});
        this.generatedMaterials.add(material);return material;
      });
      this.geometry.set('leaf',new THREE.PlaneGeometry(1,1));
    }
    const wood=this._mat(0x74634c,{texture:'wood',roughness:.9});
    this._shape(parent,'cylinder',wood,[x,1.3,z],[.13,2.6,.13]);
    const random=index=>{const value=Math.sin(x*12.9898+z*78.233+index*37.719)*43758.5453;return value-Math.floor(value);};
    for(let branch=0;branch<7;branch++) {
      const angle=branch*2.399,spread=branch===0?0:.8;
      const tip=new THREE.Vector3(x+Math.cos(angle)*spread,3.4+(branch%3)*.4,z+Math.sin(angle)*spread);
      const base=new THREE.Vector3(x,2.1+branch*.06,z),direction=tip.clone().sub(base),mid=base.clone().add(tip).multiplyScalar(.5);
      const rotation=new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(THREE.Object3D.DEFAULT_UP,direction.clone().normalize()));
      this._shape(parent,'cylinder',wood,mid.toArray(),[.035,direction.length(),.035],[rotation.x,rotation.y,rotation.z]);
      for(let leaf=0;leaf<70;leaf++) {
        const seed=branch*300+leaf*4,u=random(seed),v=random(seed+1),a=u*Math.PI*2,r=Math.sqrt(v)*.9;
        this._shape(parent,'leaf',this.leafMaterials[leaf%3],
          [tip.x+Math.cos(a)*r,tip.y+(random(seed+2)-.5)*1.5,tip.z+Math.sin(a)*r],
          [.16+v*.12,.3+v*.13,1],[random(seed+3)*Math.PI,angle+a,random(seed+4)*.6]);
      }
    }
    this._box(parent,x,.015,z,2.5,.12,2.5,0x748768);
  }

  _equipmentFinish(group,carriage,type,item) {
    const steel=this._mat(0x9ca5aa,{texture:'metal',metalness:.8,roughness:.32});
    const dark=this._mat(0x343b40,{metalness:.55,roughness:.38});
    const family=String(item.type||type).toUpperCase();
    if(type==='truck') {
      for(const side of [-1,1]) {
        this._box(group,side*1.36,1.13,7.4,.06,.16,1.1,dark);
        for(let y=1.94;y<2.35;y+=.1)this._box(group,side*1.36,y,7.5,.025,.025,.65,dark);
        for(const z of [-5.4,-3.9])this._box(group,side*1.27,1.15,z,.49,.09,1.35,dark);
      }
    } else if(family==='FORKLIFT') {
      for(const side of [-1,1]) {
        for(let z=-1.02;z<-.5;z+=.09)this._box(group,side*.63,.92,z,.025,.19,.035,dark);
        this._shape(group,'cylinder',steel,[side*.33,1.4,.62],[.055,2.2,.055]);
        this._box(group,side*.51,1.42,.54,.04,2.2,.045,dark);
      }
      if(carriage){this._box(carriage,0,.24,.75,1.05,.08,.09,dark);this._finish(carriage);}
    } else if(/STACK/.test(family)) {
      for(const side of [-1,1]) {
        this._box(group,side*.55,4.5,.13,.045,8.55,.04,steel);
        this._box(group,side*.72,.6,-.05,.2,.43,.8,dark);
        for(let y=1;y<8.5;y+=.7)this._box(group,side*.64,y,-.12,.09,.045,.08,steel);
      }
      for(let y=1.1;y<2.9;y+=.13)this._box(group,.36,y,-.52,.02,.045,.3,dark);
    } else if(/SHUTTLE|TRANSFER/.test(family)) {
      for(const side of [-1,1])for(const z of [-.75,.75]){
        this._shape(group,'cylinder',dark,[side*1.08,.27,z],[.15,.14,.15],[0,0,Math.PI/2]);
        this._shape(group,'cylinder',steel,[side*1.16,.27,z],[.07,.035,.07],[0,0,Math.PI/2]);
      }
      for(let x=-.8;x<=.8;x+=.2)this._box(group,x,.8,0,.08,.045,1.7,steel);
    } else {
      for(const side of [-1,1]) {
        for(let z=-.35;z<.4;z+=.1)this._box(group,side*.383,.12,z,.013,.035,.04,steel);
        this._box(group,side*.23,.11,-.593,.09,.035,.015,steel);
      }
    }
  }

  _movableModel(type, item) {
    const group = new THREE.Group(); group.userData.batches = new Map();
    let carriage = null, doors = null, vehicleRoof = null;
    const wheels = [];
    const wheel = (x, y, z, radius, thickness) => {
      const wheelGroup = new THREE.Group();
      wheelGroup.position.set(x,y,z);
      if (this.models?.attach(wheelGroup,'IndustrialWheel',[0,0,0],[thickness,radius,radius],x < 0 ? Math.PI : 0)) {
        group.add(wheelGroup);
        wheels.push({hub:wheelGroup,radius});
        return;
      }

      this._shape(group, 'cylinder', this._mat(0x25292b,{texture:'rubber',roughness:.82,repeat:[2,1]}), [x, y, z], [radius, thickness, radius], [0, 0, Math.PI / 2]);
      const hub = new THREE.Group(); hub.position.set(x + Math.sign(x) * thickness * .55, y, z); hub.userData.batches = new Map();
      this._shape(hub, 'cylinder', 0xe2e8ed, [0, 0, 0], [radius * .52, .026, radius * .52], [0, 0, Math.PI / 2]);
      for (const angle of [0, Math.PI / 3, -Math.PI / 3]) this._box(hub, Math.sign(x) * .02, 0, 0, .025, radius * .78, .045, C.steel, [angle, 0, 0]);
      for(let i=0;i<8;i++) {
        const angle=i*Math.PI/4, r=radius*.32;
        this._shape(hub,'bolt',this._mat(0x899399,{metalness:.85,roughness:.28}),
          [Math.sign(x)*.035,Math.cos(angle)*r,Math.sin(angle)*r],[.018,.025,.018],[0,0,Math.PI/2]);
      }
      this._shape(hub,'cylinder',this._mat(0x4e575e,{metalness:.8,roughness:.3}),[Math.sign(x)*.045,0,0],[radius*.2,.045,radius*.2],[0,0,Math.PI/2]);
      this._finish(hub); group.add(hub); wheels.push({ hub, radius });
    };
    if (type === 'truck') {
      this._box(group, 0, 0.85, 0.7, 2.6, 0.3, 16.6, C.deep);
      this._box(group, 0, 1.14, -0.2, 2.6, 0.12, 14, this._mat(0xaab4ba,{texture:'metal',roughness:.42,metalness:.75}));
      for(const side of [-1,1]) {
        this._box(group,side*.65,.7,.7,.12,.3,16.2,C.deep);
        this._shape(group,'cylinder',this._mat(0xa7b0b5,{metalness:.85,roughness:.32}),[side*1.02,.75,5.4],[.25,1.1,.25],[Math.PI/2,0,0]);
        this._box(group,side*1.4,.62,1.2,.09,.18,5.5,C.steel);
        for(const z of [-5.4,-3.9,7.8]) {
          this._shape(group,'cylinder',this._mat(0x41494e,{metalness:.75,roughness:.5}),[0,.55,z],[.1,2.55,.1],[0,0,Math.PI/2]);
          this._box(group,side*.66,.65,z,.24,.12,1.2,C.deep);
        }
        for(let z=-6.2;z<6;z+=2.4) this._box(group,side*1.445,1.45,z,.025,.07,.24,this._mat(0xe9ae25,{emissive:0xb66c08,emissiveIntensity:.15,roughness:.25}));
      }
      const trailer = this.models?.attach(group, 'TrailerSides');
      if (!trailer) {
        for (const side of [-1, 1]) {
          this._box(group, side * 1.34, 2.65, -0.2, 0.08, 2.9, 14, C.white);
          this._box(group, side * 1.4, 1.5, -0.2, 0.03, 0.22, 14, C.gold);
          for (let z = -6.8; z < 6.8; z += 0.65) this._box(group, side * 1.39, 2.65, z, 0.025, 2.85, 0.035, 0xcbd6d8);
        }
        this._box(group, 0, 2.65, 6.8, 2.7, 2.9, 0.12, C.white);
      }
      vehicleRoof = new THREE.Group(); vehicleRoof.userData.batches = new Map();
      this._box(vehicleRoof, 0, 4.15, -0.2, 2.8, 0.12, 14.2, C.white);
      this._finish(vehicleRoof); group.add(vehicleRoof);
      if (!this.models?.attach(group, 'DeliveryCab')) {
        this._shape(group,'machineShell',this._mat(0x303c43,{metalness:.22,roughness:.3,clearcoat:.35}),[0,2.2,8],[2.65,2.7,2.7]);
        this._box(group,0,1.92,9.4,2.4,.14,.04,C.gold);
        this._box(group, 0, 2.8, 9.39, 2.35, 1.05, 0.07, 0x47697d);
        this._box(group, 0, 2.8, 9.44, .055, 1.05, .035, C.deep);
        for (const side of [-1, 1]) {
          this._box(group, side * .57, 2.39, 9.46, .7, .025, .035, C.deep, [0, 0, side * .14]);
          this._box(group, side * 1.38, 2.1, 7.9, .04, .055, .35, C.steel);
          this._box(group, side * 1.45, 1.13, 8.1, .3, .1, .95, C.steel);
        }
        this._box(group, 0, 1.45, 9.4, 1.4, 0.55, 0.07, C.deep);
        for(let y=1.24;y<1.69;y+=.085) this._box(group,0,y,9.445,1.28,.025,.035,C.steel);
        this._box(group,0,3.84,7.1,2,.25,.65,C.white);
        for(const side of [-1,1]) {
          this._box(group,side*1.48,2.85,8.72,.32,.045,.07,C.deep);
          this._box(group,side*1.645,2.9,8.72,.035,.37,.15,C.steel);
        }
        this._box(group, 0, 0.94, 9.45, 2.75, 0.25, 0.15, C.steel);
        for (const side of [-1, 1]) {
          this._box(group, side * 1.34, 2.8, 8.3, 0.06, 1.05, 1.6, 0x648ba1);
          this._box(group, side * 1.65, 2.8, 9, 0.12, 0.5, 0.3, C.deep);
          this._box(group, side, 1.65, 9.45, 0.4, 0.2, 0.03, 0xfff4cc);
        }
      }
      for (const side of [-1, 1]) for (const z of [-5.4, -3.9, 7.8]) wheel(side * 1.28, .55, z, .55, .32);
      doors = [-1, 1].map((side) => {
        const pivot = new THREE.Group(); pivot.position.set(side * 1.3, 1.2, -7.22); pivot.userData.batches = new Map();
        this._box(pivot, -side * 0.65, 1.45, 0, 1.3, 2.9, 0.08, C.white);
        this._box(pivot, -side * 0.6, 1.45, -0.07, 0.045, 2.6, 0.04, C.steel);
        this._box(pivot, -side * 0.6, 0.9, -0.1, 0.3, 0.06, 0.04, C.deep);
        for(const y of [.35,1.45,2.55]) {
          this._box(pivot,-side*.08,y,-.07,.18,.12,.06,C.steel);
          this._shape(pivot,'cylinder',this._mat(0xaab4ba,{metalness:.8,roughness:.35}),[-side*.04,y,-.1],[.035,.18,.035]);
        }
        this._finish(pivot); group.add(pivot); return pivot;
      });
      if (!trailer) for (const x of [-1.1, 1.1]) this._box(group, x, 0.99, -7.3, 0.3, 0.2, 0.05, C.red);
      for (const side of [-1, 1]) {
        const sign = new THREE.Group(); sign.position.set(side * 1.46, 2.85, -0.2); sign.rotation.y = side * Math.PI / 2;
        this._brandSign(sign, 0, 0, 0, 5.7, {decal:true}); group.add(sign);
      }
    } else if (String(item.type).toUpperCase() === 'FORKLIFT') {
      if (!this.models?.attach(group, 'Forklift')) {
        this._shape(group,'machineShell',this._mat(0x3f494e,{metalness:.25,roughness:.36}),[0,.55,-.25],[1.28,.7,2.2]);
        this._box(group, 0, .29, .12, 1.3, .23, 1.45, C.blue);
        this._shape(group,'machineShell',this._mat(C.gold,{roughness:.35}),[0,.9,-.85],[1.24,.45,.9]);
        this._box(group, 0, 1.16, -1.12, .65, .18, .08, C.deep);
        this._shape(group, 'cylinder', C.dark, [0, 1.34, -.55], [.16, .15, .16]);
        this._box(group, 0, 1.05, -0.1, 0.85, 0.3, 0.8, C.deep);
        for (const side of [-1, 1]) {
          this._box(group, side * 0.53, 1.75, -0.45, 0.07, 1.7, 0.07, C.deep);
          this._box(group, side * 0.49, 1.4, 0.7, 0.12, 2.5, 0.16, C.deep);
          this._box(group, side * 0.39, 1.4, 0.73, 0.08, 2.4, 0.12, C.steel);
        }
        this._box(group, 0, 2.65, -0.4, 1.25, 0.12, 1.55, C.deep);
        this._box(group, 0, 2.65, 0.7, 1.15, 0.14, 0.25, C.deep);
      }
      for (const side of [-1, 1]) for (const z of [-0.8, 0.35]) wheel(side * .64, .32, z, .32, .16);
      carriage = new THREE.Group(); carriage.userData.batches = new Map(); carriage.userData.forklift = true;
      if (!this.models?.attach(carriage, 'ForkCarriage')) {
        this._box(carriage, 0, 0.18, 0.79, 1.05, 0.4, 0.13, C.steel);
        for (const x of [-0.4, 0.4]) this._box(carriage, x, -0.055, 1.32, 0.12, 0.09, 0.9, C.steel);
      }
      this._finish(carriage); group.add(carriage);
    } else if (String(item.type).toUpperCase().includes('STACK')) {
      const modelled = this.models?.attach(group, 'Stacker');
      if (!modelled) {
        this._box(group, 0, 0.45, 0, 2.2, 0.7, 1.4, C.deep);
        for (const dx of [-0.55, 0.55]) this._box(group, dx, 4.5, 0, 0.17, 8.8, 0.22, C.deep);
        this._box(group, 0, 8.8, 0, 1.7, 0.3, 0.5, C.gold);
        this._box(group, 0, 2.1, -0.3, 0.7, 2.4, 0.4, C.purple);
      }
      carriage = new THREE.Group(); carriage.userData.batches = new Map();
      const modelledLift = this.models?.attach(carriage,'StackerLift');
      if (!modelledLift) this._box(carriage, 0, 0.3, -0.17, 1.4, 0.6, 0.18, C.steel);
      for(const x of [-.55,.55]) {
        if (!modelled) for(let y=.8;y<8.6;y+=.24) this._box(group,x,y,-.14,.075,.11,.045,C.deep);
        if (!modelledLift) this._shape(carriage,'cylinder',this._mat(0x909ca3,{metalness:.85,roughness:.3}),[x,.3,0],[.09,.2,.09],[Math.PI/2,0,0]);
      }
      carriage.userData.forks = [-0.53, 0.53].map((x) => this._shape(carriage, 'box', this._mat(0xa9b3af, { metalness: 0.7, roughness: 0.45 }), [x, 0.05, 0], [0.16, 0.12, 1.5], [0, 0, 0], false));
      this._finish(carriage); carriage.position.y = Math.max(0.8, n(item.y, 0.8)); group.add(carriage);
    } else if (/SHUTTLE|TRANSFER/.test(String(item.type).toUpperCase())) {
      if (!this.models?.attach(group, 'Shuttle')) {
        this._box(group, 0, 0.37, 0, 2.4, 0.5, 2.4, C.steel);
        this._box(group,0,.7,0,2.4,.17,2.4,C.deep);
        for (const dx of [-0.9, 0.9]) this._box(group, dx, 0.78, 0, 0.2, 0.12, 2, C.deep);
        this._box(group, 0, 0.95, -0.75, 0.5, 0.4, 0.4, C.gold);
      }
    } else {
      // A low under-pallet AGV can physically withdraw after setting a load on
      // the four buffer feet. A tall solid AMR could not lower its own cargo
      // through its body; the central telescopic deck makes that transfer real.
      if (!this.models?.attach(group, 'AMR')) {
        this._box(group, 0, 0.095, 0, 0.75, 0.09, 1.1, C.deep);
        for (const x of [-0.405, 0.405]) for (const z of [-0.38, 0.38]) this._shape(group, 'cylinder', C.deep, [x, 0.095, z], [0.065, 0.08, 0.065], [0, 0, Math.PI / 2]);
        this._box(group, 0, 0.13, 0.57, 0.7, 0.06, 0.04, C.gold);
        this._box(group, 0, 0.13, -0.57, 0.7, 0.06, 0.04, C.gold);
        for(const side of [-1,1]) {
          this._box(group,side*.34,.115,side*.54,.1,.06,.07,C.deep);
          this._box(group,side*.34,.12,side*.578,.065,.025,.012,this._mat(0x274f61,{metalness:.6,roughness:.12}));
        }
      }
      carriage = new THREE.Group(); carriage.userData.batches = new Map(); carriage.userData.agv = true;
      if (!this.models?.attach(carriage,'AmrLiftDeck')) this._box(carriage, 0, -0.02, 0, 0.78, 0.04, 0.68, C.steel);
      this._finish(carriage); group.add(carriage);
      group.userData.agvLift = [];
      for (const x of [-0.28, 0.28]) for (const sign of [-1, 1]) {
        const guide = this._shape(group, 'box', C.steel, [x, 0.55, 0], [0.035, 0.035, 0.9], [0, 0, 0], false);
        group.userData.agvLift.push({ guide, sign });
      }
    }
    if (!this.models) this._equipmentFinish(group,carriage,type,item);
    this._finish(group);
    const lamp = new THREE.Mesh(this._geo('cylinder'), this._beaconMaterial(0x7ac8ad));
    const lowAgv = Boolean(carriage?.userData.agv);
    const [lx,ly,lz] = type === 'truck' ? [0,3.61,7.6]
      : /STACK/.test(String(item.type)) ? [.36,8.955,0]
      : item.type === 'FORKLIFT' ? [-.54,2.665,-.76]
      : lowAgv ? [.324,.145,-.463] : [.86,.82,-.61];
    const lampRadius=lowAgv ? .021 : .078;
    this._shape(group,'cylinder',C.deep,[lx,ly+.009,lz],[lampRadius*1.13,.022,lampRadius*1.13],undefined,false);
    lamp.position.set(lx,ly+(lowAgv ? .025 : .072),lz);
    lamp.scale.set(lampRadius,lowAgv ? .014 : .105,lampRadius);
    group.add(lamp);
    this.dynamic.add(group);
    const record = { type, id: String(item.id), position: new THREE.Vector3(n(item.x), 0, n(item.z)), size: type === 'truck' ? [3.2, 4.3, 18.7] : /STACK/.test(String(item.type)) ? [2.4, 7.5, 2.3] : item.type === 'FORKLIFT' ? [1.9, 3.3, 3.4] : [2.1, 1.2, 2.6] };
    this.entities.set(entityKey(type, item.id), record);
    // Reuse the actual articulated model for pointer picking, not a generous
    // invisible box around air between cab, trailer, forks or lift platform.
    // These sources stay in the transform tree after render batching.
    const pickTargets = [];
    group.traverse(source => {
      if (!source.isMesh || source.material?.visible === false) return;
      source.userData.entity = record; pickTargets.push(source);
    });
    group.position.set(n(item.x), 0, n(item.z));
    const sample = this._poseSample(item, type, now());
    return { group, carriage, doors, vehicleRoof, wheels, lamp, record, pickTargets, item, pose: sample, samples: [sample], angle: n(item.heading || item.rotation), targetQuaternion: new THREE.Quaternion(), at: now() };
  }

  _poseSample(item, type, at) {
    const guide = motionGuideModule.motionGuide(item);
    return { at, x: n(item.x), y: n(item.y), z: n(item.z), heading: n(item.heading), liftHeight: n(item.liftHeight, 0.15), cargoHeight: n(item.cargoHeight, 0.95), doorProgress: n(item.doorProgress), state: item.state, carryingHuId: item.carryingHuId, orderId:item.orderId || null,
      routeIndex: guide.index, route: asArray(guide.route).map((p) => ({ x: n(p.x), y: n(p.y), z: n(p.z) })) };
  }

  _syncMovers(robots, trucks) {
    const present = new Set();
    let structureChanged = false;
    for (const [type, items] of [['robot', robots], ['truck', trucks]]) {
      for (const item of items) {
        const key = entityKey(type, item.id); present.add(key);
        let mover = this.movers.get(key);
        if (!mover) { mover = this._movableModel(type, item); this.movers.set(key, mover); structureChanged = true; }
        mover.item = item;
        mover.lamp.material = this._beaconMaterial(item.state === 'FAULT' ? C.red : /WAIT|CHARG|LOADING/.test(String(item.state)) ? C.gold : /MOV|SOURCE|DEST|OUTBOUND|RETURN/.test(String(item.state)) ? C.cold : 0x7ac8ad);
        const sample = this._poseSample(item, type, now());
        const previous = mover.samples.at(-1);
        sample.path = reportedTravelPath(previous, sample);
        if (this.paused || sample.at - previous.at > 5000) {
          mover.samples = [sample];
          if (sample.at - previous.at > 5000) this.playbackAt = undefined;
        }
        else {
          const anchor = this.previousSnapshotAnchor, current = this.snapshotAnchor;
          mover.routeCache ||= new Map();
          for (const h of asArray(item.motionHistory)) if (h.route?.length) mover.routeCache.set(h.routeId, h.route);
          const history = anchor && current.elapsed > anchor.elapsed ? asArray(item.motionHistory).filter((h) => h.elapsed > anchor.elapsed && h.elapsed <= current.elapsed) : [];
          for (const h of history) {
            const at = historyWallTime(h.elapsed, anchor, current);
            if (at <= mover.samples.at(-1).at) continue;
            const entry = this._poseSample({ ...h, route: h.route || mover.routeCache.get(h.routeId) || motionGuideModule.motionGuide(item).route }, type, at);
            entry.path = reportedTravelPath(mover.samples.at(-1), entry); mover.samples.push(entry);
          }
          if (sample.at > mover.samples.at(-1).at) { sample.path = reportedTravelPath(mover.samples.at(-1), sample); mover.samples.push(sample); }
          while (mover.samples.length > 450 || (mover.samples.length > 2 && mover.samples[1].at < current.at - 4000)) mover.samples.shift();
          if (mover.routeCache.size > 160) { const keep = new Set(asArray(item.motionHistory).map((h) => h.routeId)); for (const id of mover.routeCache.keys()) if (!keep.has(id)) mover.routeCache.delete(id); }
        }
        mover.record.position.set(sample.x, sample.y, sample.z);
      }
    }
    for (const [key, mover] of this.movers) if (!present.has(key)) {
      this.dynamic.remove(mover.group); mover.group.traverse((m) => {
        if (m.isInstancedMesh) m.dispose();
        if (m.userData.labelRecord) this.labelRecords.delete(m.userData.labelRecord);
        for (const resource of m.userData.ownedResources || []) { resource.dispose(); this.textures.delete(resource); this.generatedMaterials?.delete(resource); }
      });
      this.movers.delete(key); this.entities.delete(key);
      structureChanged = true;
      const retired = new Set(mover.pickTargets);
      this.hitTargets = this.hitTargets.filter((mesh) => !retired.has(mesh));
    }
    if (structureChanged) this._mergeMoverBatches();
  }

  _mergeMoverBatches() {
    if (this.moverInstances) { this.dynamic.remove(this.moverInstances); this.moverInstances.traverse((o) => o.isInstancedMesh && o.dispose()); }
    this.moverInstances = new THREE.Group(); this.dynamic.add(this.moverInstances);
    const batches = new Map();
    for (const mover of this.movers.values()) mover.group.traverse((source) => {
      if (!source.isMesh || source === mover.lamp || source.material.visible === false) return;
      const key = `${source.geometry.uuid}:${source.material.uuid}:${source.castShadow}`;
      if (!batches.has(key)) batches.set(key, { geometry: source.geometry, material: source.material, castShadow:source.castShadow, refs: [] });
      for (let index = 0; index < (source.isInstancedMesh ? source.count : 1); index++) {
        const matrix = new THREE.Matrix4(); if (source.isInstancedMesh) source.getMatrixAt(index, matrix);
        batches.get(key).refs.push({ source, matrix, mover });
      }
      // Keep the transform tree for articulated doors and forks, but submit one
      // draw per shared material for the whole fleet, not one per vehicle.
      source.visible = false;
    });
    this.moverBatches = [...batches.values()].map(({ geometry, material, refs, castShadow }) => {
      const mesh = this._instances(geometry, material, refs.length); mesh.frustumCulled = false;
      mesh.castShadow = castShadow; mesh.receiveShadow = true; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.moverInstances.add(mesh); return { mesh, refs };
    });
    this._applyView();
  }

  _updateMoverInstances() {
    const matrix = this.instanceMatrix ||= new THREE.Matrix4();
    this.dynamic.updateMatrixWorld(true);
    for (const { mesh, refs } of this.moverBatches || []) {
      let count = 0;
      for (const ref of refs) {
        let p = ref.source.parent, visible = true;
        while (p && p !== this.dynamic) { if (!p.visible) { visible = false; break; } p = p.parent; }
        if (!visible) continue;
        mesh.setMatrixAt(count++, matrix.multiplyMatrices(ref.source.matrixWorld, ref.matrix));
      }
      mesh.count = count; mesh.instanceMatrix.needsUpdate = true;
    }
  }

  _huPosition(hu, interpolate = false) {
    if (interpolate) hu = this._visualHu(hu);
    const automaticPose = interpolate && this.automation.huPose?.(hu.id);
    if (automaticPose) return new THREE.Vector3(automaticPose.x, automaticPose.y, automaticPose.z);
    const carrier = [...this.movers.values()].find((m) => m.record.type === 'robot' && String((interpolate ? m.pose : m.item).carryingHuId || '') === String(hu.id));
    if (carrier) {
      const robot = carrier.item, position = interpolate ? carrier.pose : robot;
      if (robot.type === 'FORKLIFT') {
        const p = carrierLoadPoint({ ...position, heading: interpolate ? carrier.angle : n(robot.heading) }, n(robot.cargoOffsetZ, 1.35), n(position.liftHeight, 0.15));
        return new THREE.Vector3(p.x, p.y, p.z);
      }
      return new THREE.Vector3(n(position.x), /STACK/.test(String(robot.type)) ? Math.max(0.8, n(position.y, 0.8)) + 0.13 : n(position.y) + n(position.cargoHeight, 0.95), n(position.z));
    }
    const truck = this.movers.get(entityKey('truck', hu.locationId || hu.truckId));
    if (truck) {
      const slot = asArray(truck.item.loadPositions).find((p) => String(p.id) === String(hu.truckSlotId) || String(p.huId) === String(hu.id));
      if (slot) { const p = truckLoadPoint(interpolate ? { ...truck.pose, heading: truck.angle } : truck.item, slot); return new THREE.Vector3(p.x, p.y, p.z); }
    }
    const loc = this.locations.get(String(hu.locationId || hu.location_id || ''));
    if (loc) return new THREE.Vector3(n(loc.x), loc.kind === 'FLOOR' ? 1.03 : n(loc.y, 0.18) + .0475, n(loc.z));
    if (hu.x != null && hu.z != null) return new THREE.Vector3(n(hu.x), n(hu.y, 0.15), n(hu.z));
    const stationId = String(hu.stationId || hu.locationId || '');
    const dockSlot = asArray(this.layout.loadingDocks).flatMap((dock) => asArray(dock.stagingSlots)).find((slot) => String(slot.id) === String(hu.stagingSlotId));
    if (dockSlot && /^DOCK-/.test(stationId)) return new THREE.Vector3(n(dockSlot.x), n(dockSlot.y, 0.18), n(dockSlot.z));
    const station = [...asArray(this.layout.stations), ...asArray(this.layout.nodes)].find((s) => String(s.id) === stationId);
    if (station) {
      // Multiple loads waiting at a station occupy a visible local staging grid,
      // not the same overlapping box. This does not create stock locations.
      const slotIndex = this.stagingAssignments?.get(String(hu.id))?.index || 0;
      const position = (station.id === 'RECEIVE' ? this.layout.automation?.receivingBufferSlots?.[slotIndex] : null) || stagingPoint(station, slotIndex);
      return new THREE.Vector3(position.x, position.y, position.z);
    }
    return null;
  }

  _syncHus(hus, recordHistory = true) {
    this.huHistory ||= new Map();
    this.huBirthAt ||= new Map();
    const at = this.lastSnapshotAt || now();
    for (const hu of recordHistory ? hus : []) {
      const history = this.huHistory.get(String(hu.id)) || [];
      const anchor = this.previousSnapshotAnchor, current = this.snapshotAnchor;
      if (anchor && current.elapsed > anchor.elapsed) for (const h of asArray(hu.motionHistory)) {
        if (h.elapsed <= anchor.elapsed || h.elapsed > current.elapsed) continue;
        const sampleAt = historyWallTime(h.elapsed, anchor, current);
        if (sampleAt > (history.at(-1)?.at || 0)) history.push({ at: sampleAt, hu: { ...hu, ...h } });
      }
      history.push({ at, hu: { ...hu } }); while (history.length > 10) history.shift();
      if (!this.huBirthAt.has(String(hu.id))) this.huBirthAt.set(String(hu.id), this.hasHusSnapshot ? history[0].at : -Infinity);
      this.huHistory.set(String(hu.id), history);
    }
    if (recordHistory) this.hasHusSnapshot = true;
    this.stagingAssignments ||= new Map();
    for (const [id, assignment] of this.stagingAssignments) {
      const hu = hus.find((h) => String(h.id) === id);
      const visual = hu && this._visualHu(hu);
      // A fully consumed pallet keeps its historical location in the ledger,
      // but must release its physical pad after the observed visual handoff.
      if (!hu || (n(hu.cases) <= 0 && n(visual.cases) <= 0)
        || (String(hu.locationId) !== assignment.stationId && String(visual.locationId) !== assignment.stationId)) this.stagingAssignments.delete(id);
    }
    for (const hu of hus) {
      const stationId = String(hu.locationId || '');
      // Do not reserve a second visible pad for an output HU whose birth is
      // still ahead of the buffered rendering clock.
      if (!asArray(this.layout.stations).some((s) => String(s.id) === stationId) || this.stagingAssignments.has(String(hu.id)) || n(hu.cases) <= 0 || n(this._visualHu(hu).cases) <= 0) continue;
      const occupied = new Set([...this.stagingAssignments.values()].filter((s) => s.stationId === stationId).map((s) => s.index));
      const prepared = this.automation.bufferAssignment?.(String(hu.id));
      let index = prepared?.stationId === stationId && !occupied.has(prepared.index) ? prepared.index : 0;
      while (occupied.has(index)) index++;
      this.stagingAssignments.set(String(hu.id), { stationId, index });
    }
    const visible = hus.map((h) => ({ ...h, ...this._visualHu(h) })).filter((h) => this._huPosition(h, true) && !['EMPTY', 'CONSUMED', 'DELIVERED', 'SHIPPED', 'CANCELLED'].includes(String(h.status || h.state).toUpperCase()) && n(h.cases ?? h.qty ?? h.quantity, 1) > 0);
    const signature = visible.map((h) => `${h.id}:${h.cases ?? h.qty ?? h.quantity ?? 1}:${h.packagingDefect || ""}`).join('|');
    if (signature !== this.huSignature) {
      this.huSignature = signature;
      if (this.huGroup) {
        this.dynamic.remove(this.huGroup); this.huGroup.traverse((m) => { if (m.isInstancedMesh) m.dispose(); });
      }
      this.huGroup = new THREE.Group(); this.dynamic.add(this.huGroup);
      this.huBatches = [];
      const add = (geo, color, transforms, options = {}) => {
        const count = visible.reduce((sum, hu) => sum + (typeof transforms === 'function' ? transforms(hu).length : transforms.length), 0);
        const mesh = this._instances(typeof geo === 'string' ? this._geo(geo) : geo, color?.isMaterial ? color : this._mat(color, options), Math.max(1, count));
        mesh.castShadow = options.texture === 'carton' || options.texture === 'wood'; mesh.receiveShadow = true; mesh.frustumCulled = false;
        mesh.userData.selectable = !Array.isArray(transforms) || !transforms.every(part => part.contactShadow);
        const partsByHu = new Map(visible.map((hu) => [String(hu.id), typeof transforms === 'function' ? transforms(hu) : transforms]));
        this.huGroup.add(mesh); this.huBatches.push({ mesh, transforms, partsByHu });
      };
      const planks = [];
      for (const z of [-0.37, -0.185, 0, 0.185, 0.37]) planks.push({ p: [0, 0.155, z], s: [LOAD.width, 0.05, 0.18] });
      for (const x of [-0.43, 0, 0.43]) {
        planks.push({ p: [x, 0.025, 0], s: [0.18, 0.05, LOAD.depth] });
        for (const z of [-0.35, 0, 0.35]) planks.push({ p: [x, 0.09, z], s: [0.18, 0.08, 0.2] });
      }
      const pallet = this.models?.parts.get('PalletWood')?.meshes;
      if (pallet?.length) {
        for (const [index, {mesh, matrix}] of pallet.entries()) {
          const key = `blender-pallet-${index}`;
          const geometry = this.geometry.get(key) || mesh.geometry.clone().applyMatrix4(matrix);
          this.geometry.set(key, geometry);
          add(geometry, mesh.material, [{p:[0,0,0],s:[1,1,1]}], {texture:'wood'});
        }
      } else add('box', C.wood, planks, { texture: 'wood' });
      add('plane', this._contactShadowMaterial(), [{p:[0,.003,0],s:[1.6,1.3,1],r:[-Math.PI/2,0,0],contactShadow:true}]);
      const partsFor = (hu, makePart) => caseParts(n(hu.cases ?? hu.qty ?? hu.quantity, 1), ({ x, y, z, index }) => ({ ...makePart(x, y, z), caseIndex: index }));
      const cartons = (hu) => partsFor(hu, (x, y, z) => ({ p: [x, y, z], s: [LOAD.boxWidth, LOAD.boxHeight, LOAD.boxDepth] }));
      const { damageKind } = packagingQuality;
      add('chamferedBox', C.cartonLight, hu => damageKind(hu.packagingDefect) === 'liquid' ? []
        : cartons(hu).map(part => damageKind(hu.packagingDefect) === 'crushed'
          ? { ...part, p:[part.p[0],part.p[1]-LOAD.boxHeight*.11,part.p[2]], s:[part.s[0],part.s[1]*.78,part.s[2]] } : part), { texture: 'carton' });
      add('chamferedBox', 0x67513a, hu => damageKind(hu.packagingDefect) === 'liquid' ? cartons(hu) : [], { texture: 'carton' });
      add('box', C.carton, hu => damageKind(hu.packagingDefect) === 'open' ? partsFor(hu, (x,y,z) =>
        ({p:[x,y+LOAD.boxHeight/2+.09,z],s:[LOAD.boxWidth*.8,.025,LOAD.boxDepth*.7],r:[0,0,.35]})) : [], {texture:'carton'});
      add('box', 0x513c24, hu => damageKind(hu.packagingDefect) === 'torn' ? partsFor(hu, (x,y,z) =>
        ({p:[x+.095,y+.058,z+LOAD.boxDepth/2+.009],s:[.035,.155,.012],r:[0,0,.58]})) : []);
      add('box', 0xf0dfb9, (hu) => partsFor(hu, (x, y, z) => ({ p: [x, y + LOAD.boxHeight / 2 + 0.004 - (hu.packagingDefect === 'DENTED' ? LOAD.boxHeight * .22 : 0), z], s: [0.065, 0.008, LOAD.boxDepth + 0.002] })), { roughness: 0.49 });
      add('box', 0xf0dfb9, (hu) => partsFor(hu, (x, y, z) => ({ p: [x, y + 0.11, z + LOAD.boxDepth / 2 + 0.002], s: [0.065, 0.18, 0.005] })), { roughness: 0.49 });
      add('box', C.white, (hu) => partsFor(hu, (x, y, z) => ({ p: [x - 0.07, y - 0.03, z + LOAD.boxDepth / 2 + 0.006], s: [0.22, 0.18, 0.008] })), { texture: 'barcode' });
      add('box', 0xc4c9c0, [{ p: [0, 0.09, LOAD.depth / 2 + 0.008], s: [0.42, 0.10, 0.012] }], { texture: 'barcode' });
    }
    this.dynamicHus = visible;
    for (const key of [...this.entities.keys()]) if (key.startsWith('hu:')) this.entities.delete(key);
    for (const hu of visible) {
      const height = LOAD.palletHeight + Math.ceil(Math.min(24, n(hu.cases ?? hu.qty ?? hu.quantity, 1)) / 6) * (LOAD.boxHeight + 0.014);
      this.entities.set(entityKey('hu', hu.id), { type: 'hu', id: String(hu.id), position: this._huPosition(hu, true).clone().add(new THREE.Vector3(0, height / 2, 0)), size: [LOAD.width, height, LOAD.depth] });
    }
    this._renderHus();
  }

  _renderHus() {
    if (!this.huBatches) return;
    const loads = [];
    for (const hu of this.dynamicHus) {
      const visualHu = this._visualHu(hu);
      if (['EMPTY', 'CONSUMED', 'DELIVERED', 'SHIPPED', 'CANCELLED'].includes(String(visualHu.state || visualHu.status).toUpperCase()) || n(visualHu.cases ?? visualHu.qty ?? visualHu.quantity, 1) <= 0) continue;
      const p = this._huPosition(hu, true); if (!p) continue;
      const carrier = [...this.movers.values()].find((m) => String(m.pose.carryingHuId || '') === String(hu.id) || (m.record.type === 'truck' && String(visualHu.locationId) === String(m.item.id)));
      const yaw = this.automation.huHeading?.(hu.id) ?? carrier?.angle ?? 0;
      const locationId = String(visualHu.locationId || '');
      const mechanicalSupport = this.automation.huSupport?.(hu.id);
      // A transfer pallet is constrained to the same authored support surface
      // as the visible lift/forks. Its machine is an observed presentation
      // carrier, never a new inventory owner.
      if (mechanicalSupport && Number.isFinite(mechanicalSupport.surfaceY)) p.y = mechanicalSupport.surfaceY;
      const supported = this.physics?.supportLoad(String(hu.id), { x:p.x,y:p.y,z:p.z }, this.paused ? 0 : this.supportDelta || 0, {
        locationId, carrierId:mechanicalSupport?.mechanismId || carrier?.item.id,
        elapsed:this.previousPhysicsAt,
        mechanicallySupported: Boolean(this.automation.huPose?.(hu.id) || this.stagingAssignments?.has(String(hu.id)) || /^DOCK-|^TRUCK-/.test(locationId)),
      });
      if (supported) p.set(supported.x,supported.y,supported.z);
      loads.push({ hu, p, yaw, cos: Math.cos(yaw), sin: Math.sin(yaw), visualHu, attached:Boolean(carrier || this.automation.huPose?.(hu.id)) });
      const record = this.entities.get(entityKey('hu', hu.id));
      if (record) {
        record.position.set(p.x, p.y + record.size[1] / 2, p.z);
        record.inspectionHeading = yaw;
        record.locationId = locationId;
        record.onEquipment = Boolean(carrier || mechanicalSupport);
      }
    }
    this.renderedLoadPoses = loads.map(({ hu, p, visualHu }) => ({ id: hu.id, locationId: visualHu.locationId, state: visualHu.state, position: p.toArray() }));
    for (const { mesh, partsByHu } of this.huBatches) {
      let index = 0;
      const instanceIds = [];
      loads.forEach(({ hu, p, yaw, cos, sin, attached }) => {
        const parts = partsByHu.get(String(hu.id)) || [];
        for (const part of parts) {
          if (part.contactShadow && attached) continue;
          this.dummy.position.set(p.x + part.p[0] * cos + part.p[2] * sin, p.y + part.p[1], p.z + part.p[2] * cos - part.p[0] * sin);
          const offset = part.caseIndex == null ? null : this.automation.cargoOffset?.(hu.id, part.caseIndex);
          if (offset) { this.dummy.position.x += offset.x; this.dummy.position.y += offset.y; this.dummy.position.z += offset.z; }
          this.dummy.rotation.set(part.r?.[0] || 0, yaw + (part.r?.[1] || 0), part.r?.[2] || 0); this.dummy.scale.set(...part.s); this.dummy.updateMatrix();
          mesh.setMatrixAt(index++, this.dummy.matrix); instanceIds.push(hu.id);
        }
      });
      mesh.count = index; mesh.instanceMatrix.needsUpdate = true;
      mesh.userData.huIds = instanceIds;
    }
  }

  _visualHu(hu) {
    const history = this.huHistory?.get(String(hu.id));
    if (!history?.length) return hu;
    const selected = observedUnitState(history, this.visualAt ?? Infinity, this.huBirthAt?.get(String(hu.id)) ?? -Infinity);
    // A new inventory unit cannot coexist visually with its incoming ASN or
    // source pallet before the observed custody transition reaches playback.
    return selected || { ...hu, state: 'EMPTY', status: 'EMPTY', cases: 0 };
  }

  _syncRoutes(robots, trucks) {
    const signature = JSON.stringify([this.selected, [...robots, ...trucks].map((item) => [item.id, item.state, motionGuideModule.motionGuide(item), item.trip?.startedAt])]);
    if (signature === this.routeSignature) return;
    this.routeSignature = signature;
    if (this.routes) { this.world.remove(this.routes); this.routes.traverse((m) => { if (m.isInstancedMesh) m.dispose(); m.geometry?.dispose(); m.material?.dispose(); }); }
    this.routes = new THREE.Group(); this.routePin = null; this.world.add(this.routes);
    for (const [type, item] of [...robots.map(item => ['robot', item]), ...trucks.map(item => ['truck', item])]) {
      if (entityKey(type, item.id) !== this.selected || ['AVAILABLE', 'IDLE', 'AT_STORE'].includes(item.state)) continue;
      const route = asArray(motionGuideModule.motionGuide(item).route);
      if (route.length < 2) continue;
      // Render the reported path, with regular ground dots as in the reference.
      // Never interpolate a decorative shortcut through the warehouse.
      const points = route.map(p => new THREE.Vector3(n(p.x), n(p.y) + .14, n(p.z)));
      if (points.length < 2) continue;
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: C.gold, dashSize: .8, gapSize: .7, transparent: true, opacity: .7, depthWrite: false }));
      line.computeLineDistances(); this.routes.add(line);
      const dots = [];
      for (let i = 1; i < points.length; i++) {
        const length = points[i].distanceTo(points[i - 1]), count = Math.ceil(length / 1.5);
        for (let j = 0; j < count; j++) dots.push(points[i - 1].clone().lerp(points[i], j / count));
      }
      const dotGeometry = new THREE.CircleGeometry(.16, 12), dotMaterial = new THREE.MeshBasicMaterial({ color: C.gold, depthWrite: false, transparent: true, opacity: .9, side: THREE.DoubleSide });
      const dotMesh = this._instances(dotGeometry, dotMaterial, dots.length);
      dots.forEach((p, i) => { this.dummy.position.copy(p); this.dummy.rotation.set(-Math.PI / 2, 0, 0); this.dummy.scale.set(1, 1, 1); this.dummy.updateMatrix(); dotMesh.setMatrixAt(i, this.dummy.matrix); });
      dotMesh.computeBoundingSphere(); this.routes.add(dotMesh);
      const target = points.at(-1);
      const halo = new THREE.Mesh(new THREE.RingGeometry(.65, .88, 32), new THREE.MeshBasicMaterial({ color: C.gold, side: THREE.DoubleSide, transparent: true, opacity: .85, depthWrite: false }));
      halo.rotation.x = -Math.PI / 2; halo.position.copy(target); this.routes.add(halo);
      const pinShape = new THREE.Shape();
      pinShape.moveTo(0, 0); pinShape.bezierCurveTo(-.22, .5, -.76, 1.18, -.76, 1.65);
      pinShape.bezierCurveTo(-.76, 2.66, .76, 2.66, .76, 1.65); pinShape.bezierCurveTo(.76, 1.18, .22, .5, 0, 0);
      const pin = new THREE.Group(); pin.position.copy(target); pin.position.y += .2;
      pin.add(new THREE.Mesh(new THREE.ShapeGeometry(pinShape), new THREE.MeshBasicMaterial({ color: C.gold, side: THREE.DoubleSide })));
      const center = new THREE.Mesh(new THREE.CircleGeometry(.3, 20), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
      center.position.set(0, 1.72, .015); pin.add(center); this.routes.add(pin); this.routePin = pin;
    }
    this.routes.visible = Boolean(this.selected);
  }

  _applyView() {
    this.controls.enabled = !this._usesFixedLook();
    if (!this.staticLayers.roof) return;
    const outside = ['overview', 'network'].includes(this.view);
    if (!outside) this._prepareInteriorEnvironment();
    const enclosed = this.view === 'aisle' || (this.view === 'interior' && this.interiorEnclosed);
    const scene = outside ? this.exteriorScene : this.interiorScene;
    const lightModeChanged = this.scene !== scene;
    if (lightModeChanged) {
      // The GPU caches material bindings per scene. Keep each HDR environment
      // attached to its own scene while reusing the same objects and post pass.
      this.scene = scene;
      scene.add(this.world);
      this._setSceneLight();
    }
    if (lightModeChanged || this.staticLayers.roof.visible !== (outside || enclosed) ||
        this.staticLayers.overhead?.visible !== enclosed) this.sun.shadow.needsUpdate = true;
    this.staticLayers.roof.visible = outside || enclosed;
    this.staticLayers.facade.visible = true;
    if (this.staticLayers.overhead) this.staticLayers.overhead.visible = enclosed;
    this.staticLayers.fixtures.visible = !outside;
    this.staticLayers.architecture.visible = !outside;
    this.staticLayers.walls.visible = true;
    this.staticLayers.exterior.visible = this.view !== 'aisle';
    if (this.exteriorContext) this.exteriorContext.visible = outside;
    this.automation.setView?.(this.view);
    for (const mover of this.movers.values()) mover.group.visible = !outside || mover.record.type === 'truck' || mover.item.type === 'FORKLIFT';
    if (this.routes) this.routes.visible = Boolean(this.selected);
    this._updateMoverInstances();
  }

  setView(view = 'overview') {
    if (this.failed || this.disposed || !this.initialized) return;
    const previousView = this.view;
    this.view = ['overview', 'interior', 'network', 'aisle'].includes(view) ? view : 'overview';
    this.interiorEnclosed = this.view === 'interior';
    const camera = this.view === 'network' ? this.orthographicCamera : this.perspectiveCamera;
    if (camera !== this.camera) {
      camera.position.copy(this.camera.position); camera.quaternion.copy(this.camera.quaternion);
      this.camera = camera; this.controls.object = camera; this._resize();
    }
    this._applyView();
    const presets = {
      overview: [this.models ? [108, 64, 153] : [132, 82, 174], [-12, 3, this.layout.rearExpansionVersion ? -10 : 10]],
      interior: [[-45, 8.2, 29], [-4, 3, this.layout.rearExpansionVersion ? -31 : -13]],
      network: [[125, 132, 164], [-12, 0, 29]],
      aisle: [[-40, 1.85, -12], [-12, 1.8, -12]],
    };
    const [position, target] = presets[this.view];
    const to = new THREE.Vector3(...target), eye = new THREE.Vector3(...position);
    let zoom = this.view === 'network' ? .8 : this.host.clientWidth < 700 ? .78 : 1.15;
    if(this.camera.isOrthographicCamera && this.layout.rearExpansionVersion){
      const preview=this.camera.clone();preview.position.copy(eye);preview.lookAt(to);preview.zoom=1;preview.updateProjectionMatrix();preview.updateMatrixWorld(true);
      let extent=1;
      const network=this.view==='network';
      for(const x of network?[-115,95]:[-86,53]) for(const z of network?[-88,111]:[-85,38])for(const y of [0,16]){
        const p=new THREE.Vector3(x,y,z).project(preview);extent=Math.max(extent,Math.abs(p.x),Math.abs(p.y));
      }
      zoom=.9/extent;
    }
    const nextZoom = this.camera.isOrthographicCamera ? zoom : this.camera.zoom;
    if (!this.firstReadyMs || ['overview', 'network'].includes(previousView) !== ['overview', 'network'].includes(this.view)) {
      // The destinations are separated by solid walls. Jump directly to the
      // framing instead of rendering hundreds of metres of the path through them.
      this.navigation.clear();
      this.flight = this.zoomTarget = null;
      this.camera.position.copy(eye);
      this.controls.target.copy(to);
      this.camera.zoom = nextZoom;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(to);
      this._request();
    } else this._fly(eye, to, nextZoom, 280);
  }

  getView() { return this.view; }

  _usesFixedLook() { return this.view === 'interior' || this.view === 'aisle'; }

  zoomBy(factor = 1.2) {
    if (this.failed || this.disposed || !Number.isFinite(Number(factor)) || Number(factor) <= 0) return;
    this.flight = null; this._zoom(1 / Number(factor));
  }

  _navigationAllowed(event = { target: this.renderer.domElement }) {
    return mapInputAllowed(event, this.renderer.domElement, {
      activeElement: document.activeElement, hidden: document.hidden,
      blocked: Boolean(document.querySelector('dialog[open], [aria-modal="true"], #workspace-nav[data-console-open]')),
    });
  }

  _panCamera(right, forward) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const delta = cameraPlaneDelta(right, forward, offset.x, offset.z);
    const x = THREE.MathUtils.clamp(this.controls.target.x + delta.x, -160, 160) - this.controls.target.x;
    const z = THREE.MathUtils.clamp(this.controls.target.z + delta.z, -140, 160) - this.controls.target.z;
    this.navigationOffset.set(x, 0, z);
    this.camera.position.add(this.navigationOffset); this.controls.target.add(this.navigationOffset);
  }

  // Screen-relative steps for touch/accessible camera buttons. They use the
  // same bounds and direction as continuous keyboard navigation.
  panBy(right = 0, forward = 0) {
    if (this.failed || this.disposed || !Number.isFinite(right) || !Number.isFinite(forward)) return;
    const step = THREE.MathUtils.clamp(this._visibleSpan() * .1, 1.5, 12);
    this.flight = null; this.navigation.clear();
    this._panCamera(THREE.MathUtils.clamp(right, -1, 1) * step, THREE.MathUtils.clamp(forward, -1, 1) * step);
    this.lastMotion = now(); this._request();
  }

  _visibleSpan() {
    return this.camera.isOrthographicCamera ? (this.camera.top - this.camera.bottom) / this.camera.zoom
      : this.camera.position.distanceTo(this.controls.target) * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 2;
  }

  _stepNavigation(dt, time) {
    if (!this.navigation.active) return false;
    if (!this._navigationAllowed()) { this.navigation.clear(); return false; }
    dt = Math.min(dt, Math.max(0, (time - (this.navigationFrameAt ?? time)) / 1000));
    this.navigationFrameAt = time;
    const move = this.navigation.step(dt, THREE.MathUtils.clamp(this._visibleSpan() * .32, 2.5, 52), this.reducedMotion);
    if (move.right || move.forward) this._panCamera(move.right, move.forward);
    if (move.yaw) {
      if (this._usesFixedLook()) turnCameraTarget(this.camera.position, this.controls.target, move.yaw);
      else {
        this.navigationOffset.copy(this.camera.position).sub(this.controls.target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, move.yaw);
        this.camera.position.copy(this.controls.target).add(this.navigationOffset);
      }
    }
    this.lastMotion = now();
    return move.active;
  }

  getDiagnostics() {
    if (!this.camera || this.disposed) return null;
    return { view: this.view, camera: { position: this.camera.position.toArray(), target: this.controls.target.toArray(), zoom: this.camera.zoom, projection: this.camera.isOrthographicCamera ? 'orthographic' : 'perspective' }, navigation: { active: this.navigation.active, keys: [...this.navigation.keys], focused: document.activeElement === this.renderer.domElement },
      movers: [...this.movers.values()].map((m) => ({ id: m.item.id, type: m.item.type || m.record.type, position: m.group.position.toArray(), rotation: m.angle,
        doorProgress: m.pose.doorProgress, liftHeight: m.pose.liftHeight, cargoHeight: m.pose.cargoHeight, carryingHuId: m.pose.carryingHuId })),
      loads: (this.renderedLoadPoses || []).map((load) => ({ ...load, position: [...load.position] })),
      automation: this.automation.diagnostics?.(),
      physics: this.physics?.diagnostics(),
      surfaces: this.materialLibrary.diagnostics?.(),
      inspection: {enabled: false, hiddenPieces: 0, selected:this.selected, cameraFocus:'frontal', occlusion:'disabled'},
      lifecycle: {instanceId:this.instanceId, buildCount:this.buildCount, startupTimings:this.startupTimings, firstReadyMs:this.firstReadyMs, active:this.active},
      exterior: this.exteriorDetails,
      geometry: { style: 'industrial-pbr', blenderParts: this.models ? [...this.models.parts.keys()] : [], storeSigns: this.storeSignPlacements?.map(sign => ({ ...sign })) || [] },
      renderer: { calls: this.lastDrawCalls || 0, triangles: this.lastTriangles || 0, frames: Number(this.host.dataset.renderedFrames), frameMs: Number(this.host.dataset.frameMs || 0), sampleDelay: this.renderDelay, quality: this.effectiveQuality, shadowsEnabled: this.renderer.shadowMap.enabled, shadowMapSize: this.sun.shadow.mapSize.x, antialias: true, samples: 4, backend: this.backend, environment: this.environmentSource, toneMapping:'AgX', ambientOcclusion:'GTAO-16-three-quarter', frameCap:60, areaLights:this.ceilingLights?.length || 0 } };
  }

  focus(type, id) {
    if (this.failed || this.disposed) return;
    const record = this.entities.get(entityKey(type, id));
    if (!record) return;
    this.interiorEnclosed = false;
    this.selected = entityKey(type, id); this.selection.visible = true;
    this.selection.position.copy(record.position); this.selection.position.y = Math.max(0.15, record.position.y - record.size[1] / 2);
    this.selection.scale.set(Math.max(1.6, record.size[0] + .7), 1, Math.max(1.6, record.size[2] + .7));
    this.selection.rotation.y = 0;
    this._syncRoutes(asArray(this.snapshot?.equipment?.robots || this.snapshot?.robots), asArray(this.snapshot?.equipment?.trucks || this.snapshot?.trucks));
    const p = record.position.clone();
    const distance = type === 'zone' ? Math.max(record.size[0], record.size[2]) * 1.6 : type === 'branch' ? 30 : type === 'truck' ? 24 : type === 'asset' ? 16 : type === 'rack' ? 16 : 10;
    const dock = type === 'station' && /^DOCK-/.test(String(id));
    if (dock) p.set(record.position.x, 1.2, 37);
    const mover = this.movers.get(entityKey(type, id));
    const forklift = mover?.item.type === 'FORKLIFT';
    const outdoorLoad = type === 'hu' && !insideDepot(this.layout,p);
    const storeReceiving = type === 'asset' && String(id).includes('STORE-RECEIVING');
    const outdoor = dock || type === 'warehouse' || type === 'branch' || type === 'truck' || storeReceiving || outdoorLoad || (forklift && p.z >= 35);
    if (outdoor && this.camera !== this.orthographicCamera) { this.orthographicCamera.position.copy(this.camera.position); this.camera = this.orthographicCamera; this.controls.object = this.camera; }
    if (outdoor) { this.view = 'overview'; this._applyView(); }
    if (!outdoor) {
      if (this.camera !== this.perspectiveCamera) { this.perspectiveCamera.position.copy(this.camera.position); this.camera = this.perspectiveCamera; this.controls.object = this.camera; this._resize(); }
      this.view = 'interior'; this._applyView();
    }
    if(type==='hu' && this.camera!==this.perspectiveCamera){this.perspectiveCamera.position.copy(this.camera.position);this.camera=this.perspectiveCamera;this.controls.object=this.camera;this._resize();}
    const locationId = type === 'loc' ? String(id) : type === 'hu' && !record.onEquipment ? record.locationId : null;
    const location = this.locations.get(locationId);
    const rack = type === 'rack' ? this.racks.get(String(id)) : location?.rackId ? this.racks.get(String(location.rackId)) : null;
    if (type === 'warehouse') { this.setView('overview'); return; }
    const zoom = this.camera.isOrthographicCamera ? (dock ? 2.5 : type === 'truck' || type === 'robot' ? 3.1 : 2.1) : undefined;
    if (storeReceiving) {
      // Look at the receiving yard from the trailer's rear, not through the
      // shop facade. Keep the bridge, gate and original truck in one frame.
      this._fly(p.clone().add(new THREE.Vector3(-20, 19, -24)), p.clone().add(new THREE.Vector3(3, 0, -2)), 3.6);
    } else if (rack || mover || type === 'hu' || type === 'loc' || type === 'asset') {
      const view = inspectionPose(record, rack, {
        aspect: this.perspectiveCamera.aspect, fov: this.perspectiveCamera.fov,
        heading: mover?.angle ?? record.inspectionHeading,
      });
      this._fly(view.position, view.target, zoom);
    } else this._fly(p.clone().add(new THREE.Vector3(distance * .85, Math.max(6, distance * .74), distance)), p, zoom);
  }

  clearSelection() {
    if (this.failed || this.disposed) return;
    this.selected = null;
    this.hovered = null;
    if (this.routes) this.routes.visible = false;
    this.selection.visible = false;
    this.hover.visible = false;
    this.host.style.cursor = '';
    this._request();
  }

  _fly(position, target, zoom = this.camera.zoom, duration = 900) {
    this.navigation.clear();
    this.zoomTarget = null;
    this.flight = { from: this.camera.position.clone(), to: position, fromTarget: this.controls.target.clone(), toTarget: target, fromZoom: this.camera.zoom, toZoom: zoom, at: now(), duration: this.reducedMotion ? 1 : duration };
    this._request();
  }

  _pick(event, select) {
    if (this.failed || this.disposed) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hitMeshes = this.hitTargets.filter((m) => {
      if (['overview', 'network'].includes(this.view) && !['warehouse', 'branch', 'truck', 'robot', 'asset'].includes(m.userData.entity?.type) && !(m.userData.entity?.type === 'station' && /^DOCK-/.test(m.userData.entity.id))) return false;
      if (['overview', 'network'].includes(this.view) && m.userData.entity?.type === 'asset' && !String(m.userData.entity.id).includes('STORE-RECEIVING')) return false;
      let p = m; while (p) { if (!p.visible) return false; p = p.parent; } return true;
    });
    const huMeshes = this.huBatches?.map((b) => b.mesh).filter(mesh => selectionVisible(mesh)) || [];
    const moverMeshes = [...this.movers.values()].flatMap(mover => mover.pickTargets || []).filter(mesh => selectionVisible(mesh, { batchedSource:true }));
    const outside = ['overview', 'network'].includes(this.view);
    const hits = this.raycaster.intersectObjects([...hitMeshes, ...moverMeshes, ...huMeshes], false).filter(hit => {
      if (!outside || hit.instanceId == null || !hit.object.userData.huIds) return true;
      const id = hit.object.userData.huIds[hit.instanceId], hu = this.dynamicHus.find(h => h.id === id);
      const p = hu && this._huPosition(hu, true);
      if (!p || insideDepot(this.layout,p)) return false;
      const carrier = this.movers.get(entityKey('truck', this._visualHu(hu).locationId));
      return !carrier || carrier.pose.doorProgress >= .3;
    });
    const resolve=hit => hit.instanceId != null && hit.object.userData.huIds
      ? this.entities.get(entityKey('hu',hit.object.userData.huIds[hit.instanceId])) : hit.object.userData.entity;
    const record = selectionFromHits(hits,resolve,{preferLoads:true});
    this.host.style.cursor = record ? 'pointer' : '';
    this.hovered = record ? entityKey(record.type, record.id) : null;
    this.hover.visible = Boolean(record);
    if (record) {
      this.hover.position.copy(record.position); this.hover.scale.set(...record.size);
      this.hover.rotation.y = this.movers.get(entityKey(record.type, record.id))?.angle ?? record.inspectionHeading ?? 0;
      if (select) { this.focus(record.type, record.id); this.onSelect({ type: record.type, id: record.id }); }
    }
    this._request();
  }

  _wheel(event) {
    event.preventDefault(); this.flight = null;
    this._zoom(Math.exp(Math.max(-140, Math.min(140, event.deltaY)) * 0.0017));
  }

  _zoom(factor) {
    if (this.camera.isOrthographicCamera) {
      this.zoomTarget = THREE.MathUtils.clamp((this.zoomTarget ?? this.camera.zoom) / factor, 0.45, 12);
      this.lastMotion = now(); this._request(); return;
    }
    const current = this.zoomTarget ?? this.camera.position.distanceTo(this.controls.target);
    this.zoomTarget = THREE.MathUtils.clamp(current * factor, 4.5, 285);
    this.lastMotion = now(); this._request();
  }

  _resize() {
    if (!this.renderer || this.disposed || !this.active) return;
    const width = Math.max(1, this.host.clientWidth), height = Math.max(1, this.host.clientHeight || 560);
    const sizeKey = `${width}:${height}:${this.renderer.getPixelRatio()}`;
    // Assigning canvas.width/height discards its drawing buffer, even when the
    // dimensions did not change. ResizeObserver can repeat during font/layout
    // settlement, so an unchanged observer notification must not clear a frame.
    if (this.sizeKey === sizeKey) return;
    this.sizeKey = sizeKey; this.host.dataset.sceneReady = 'false';
    this.renderer.setSize(width, height, false);
    this.perspectiveCamera.aspect = width / height; this.perspectiveCamera.updateProjectionMatrix();
    const span = 64, aspect = width / height;
    Object.assign(this.orthographicCamera, { left: -span * aspect, right: span * aspect, top: span, bottom: -span });
    this.orthographicCamera.updateProjectionMatrix();
    this._request();
  }

  setActive(active) {
    this.active = Boolean(active);
    this.visible = this.active;
    if (!this.active) {
      cancelAnimationFrame(this.frameId); this.frameId = 0;
      this.navigation.clear(); this.pointerDown = null; this.touchPoints.clear();
      this.usedPinch = false; this.pinchDistance = null;
      this.hover && (this.hover.visible = false);
      this.clockAnchors = []; this.snapshotAnchor = null; this.previousSnapshotAnchor = null;
      this.lastSnapshotAt = 0; this.intervals = [];
      return;
    }
    this.lastFrameAt = 0; this.playbackAt = undefined; this.wasContinuous = false;
    this._resize(); this._request();
  }

  _request() {
    this.dirty = true;
    if (this.initialized && !this.frameId && !this.disposed && this.active && this.visible && !document.hidden) this.frameId = requestAnimationFrame(this._frame);
  }

  _frame() {
    this.frameId = 0;
    if (this.disposed || !this.active || !this.visible || document.hidden || this.contextLost) return;
    // Driver setup can spend part of the browser frame compiling shaders.
    // Measure both camera and simulation playback against the monotonic clock.
    const time = now();
    // Bound GPU duty on high-refresh/Retina displays; simulation time stays authoritative.
    if (this.lastFrameAt && time-this.lastFrameAt < 1000/60-1) { this._request(); return; }
    const rawDelta = Math.max(0.001, time - (this.lastFrameAt || time - 16.67));
    const dt = Math.min(0.08, Math.max(0.001, rawDelta / 1000));
    const hadRecentFrame = this.lastFrameAt && (this.wasContinuous || rawDelta < 250);
    this.lastFrameAt = time;
    let animate = false;
    if (this.flight) {
      const t = THREE.MathUtils.clamp((time - this.flight.at) / this.flight.duration, 0, 1), eased = smooth(t);
      this.camera.position.lerpVectors(this.flight.from, this.flight.to, eased);
      this.controls.target.lerpVectors(this.flight.fromTarget, this.flight.toTarget, eased);
      if (this.camera.isOrthographicCamera) {
        this.camera.zoom = THREE.MathUtils.lerp(this.flight.fromZoom, this.flight.toZoom, eased);
        this.camera.updateProjectionMatrix();
      }
      if (t >= 1) this.flight = null; else animate = true;
    }
    if (this.zoomTarget != null) {
      if (this.camera.isOrthographicCamera) {
        this.camera.zoom = THREE.MathUtils.lerp(this.camera.zoom, this.zoomTarget, 1 - Math.exp(-dt * 11));
        this.camera.updateProjectionMatrix();
        if (Math.abs(this.camera.zoom - this.zoomTarget) < 0.001) this.zoomTarget = null; else animate = true;
      } else {
        const direction = this.camera.position.clone().sub(this.controls.target);
        const distance = direction.length(), next = THREE.MathUtils.lerp(distance, this.zoomTarget, 1 - Math.exp(-dt * 11));
        this.camera.position.copy(this.controls.target).add(direction.normalize().multiplyScalar(next));
        if (Math.abs(next - this.zoomTarget) < 0.015) this.zoomTarget = null; else animate = true;
      }
    }
    if (this._stepNavigation(dt, time)) animate = true;
    let moved = false;
    this.playbackAt = playbackTime(this.playbackAt, time, rawDelta, this.renderDelay);
    this.visualAt = this.paused ? time : this.playbackAt;
    const simulatedAt = observedSimulationTime(this.clockAnchors, this.visualAt, this.paused);
    this.supportDelta = this.paused || this.previousPhysicsAt == null ? 0 : Math.max(0, Math.min(.25, simulatedAt - this.previousPhysicsAt));
    this.previousPhysicsAt = simulatedAt;
    const automatedMotion = this.automation.frame(simulatedAt);
    if (automatedMotion && !this.paused) animate = true;
    const observedMovers = [];
    for (const mover of this.movers.values()) {
      // Reduced-motion removes optional camera flights, not essential equipment
      // telemetry. Snapping equipment every poll would make it less accessible.
      const renderAt = this.paused ? time : this.playbackAt;
      const samples = mover.samples;
      let a = samples[0], b = samples[0];
      for (let i = 1; i < samples.length; i++) {
        if (samples[i].at >= renderAt) { a = samples[i - 1]; b = samples[i]; break; }
        a = b = samples[i];
      }
      const t = a.at === b.at ? 1 : THREE.MathUtils.clamp((renderAt - a.at) / (b.at - a.at), 0, 1);
      const pose = a === b ? { x: a.x, y: a.y, z: a.z, tangent: null } : sampleTravelPath(b.path, t);
      const headingDelta = Math.atan2(Math.sin(b.heading - a.heading), Math.cos(b.heading - a.heading));
      Object.assign(pose, { heading: a.heading + headingDelta * t, liftHeight: THREE.MathUtils.lerp(a.liftHeight, b.liftHeight, t),
        cargoHeight: THREE.MathUtils.lerp(a.cargoHeight, b.cargoHeight, t), doorProgress: THREE.MathUtils.lerp(a.doorProgress, b.doorProgress, t), carryingHuId: t < 1 ? a.carryingHuId : b.carryingHuId, orderId:t < 1 ? a.orderId : b.orderId, state: t < 1 ? a.state : b.state });
      const stationDoorProgress = this.automation.truckDoorProgress?.(mover.item.id);
      if (Number.isFinite(stationDoorProgress)) pose.doorProgress = stationDoorProgress;
      observedMovers.push({ id:mover.record.id,type:mover.record.type,item:mover.item,pose });
    }
    const physicalPoses = this.physics?.step(simulatedAt, observedMovers, { paused:this.paused });
    if (this.physics?.catchingUp) animate = true;
    for (const mover of this.movers.values()) {
      const samples = mover.samples, renderAt = this.paused ? time : this.playbackAt;
      const pose = physicalPoses?.get(String(mover.record.id)) || observedMovers.find(entry => entry.id === mover.record.id).pose;
      const previousPose = mover.pose;
      const travelled = Math.hypot(pose.x - previousPose.x, pose.z - previousPose.z);
      if (travelled > .00001 && travelled < 10) {
        const forward = (pose.x - previousPose.x) * Math.sin(pose.heading) + (pose.z - previousPose.z) * Math.cos(pose.heading);
        for (const { hub, radius } of mover.wheels || []) hub.rotation.x += Math.sign(forward || 1) * travelled / radius;
      }
      if (Math.hypot(pose.x - previousPose.x, pose.y - previousPose.y, pose.z - previousPose.z) > 0.00001 || Math.abs(pose.liftHeight - n(previousPose.liftHeight)) > 0.0001 || Math.abs(pose.cargoHeight - n(previousPose.cargoHeight, 0.95)) > 0.0001 || Math.abs(pose.doorProgress - n(previousPose.doorProgress)) > 0.0001 || pose.carryingHuId !== previousPose.carryingHuId) moved = true;
      mover.pose = pose;
      const stacker = /STACK/.test(String(mover.item.type));
      const railZ = mover.item.railZ ?? (mover.item.zoneId === 'COLD' ? -16 : -12);
      mover.group.position.set(pose.x, stacker ? 0 : pose.y, stacker ? railZ : pose.z);
      mover.angle = stacker ? 0 : pose.heading;
      mover.targetQuaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, mover.angle);
      // The observed heading is already interpolated and contact-tested.
      // An extra visual rotation lag would swing a trailer beyond its collider.
      if (mover.group.quaternion.angleTo(mover.targetQuaternion) > .00001) moved = true;
      mover.group.quaternion.copy(mover.targetQuaternion);
      if (mover.carriage) {
        mover.carriage.position.y = mover.carriage.userData.agv ? pose.cargoHeight : mover.carriage.userData.forklift ? pose.liftHeight : Math.max(0.8, pose.y);
        const extension = pose.z - railZ;
        for (const fork of mover.carriage.userData.forks || []) {
          fork.scale.z = Math.abs(extension) + 1.45; fork.position.z = extension / 2;
        }
      }
      for (const { guide, sign } of mover.group.userData.agvLift || []) {
        const rise = Math.max(0, pose.cargoHeight - 0.18);
        guide.position.y = 0.14 + rise / 2; guide.rotation.x = sign * Math.atan2(rise, 0.55); guide.scale.z = Math.hypot(rise, 0.55);
      }
      if (mover.doors) mover.doors.forEach((door, index) => { door.rotation.y = (index ? -1 : 1) * pose.doorProgress * Math.PI * 0.54; });
      if (mover.vehicleRoof) mover.vehicleRoof.visible = true;
      mover.record.position.set(mover.group.position.x, mover.record.size[1] / 2, mover.group.position.z);
      const pendingMovement = samples.some((sample, i) => i > 0 && sample.at >= renderAt && (Math.hypot(sample.x - samples[i - 1].x, sample.y - samples[i - 1].y, sample.z - samples[i - 1].z) > 0.0001 || Math.abs(sample.liftHeight - samples[i - 1].liftHeight) > 0.0001 || Math.abs(sample.cargoHeight - samples[i - 1].cargoHeight) > 0.0001 || Math.abs(sample.doorProgress - samples[i - 1].doorProgress) > 0.0001 || Math.abs(sample.heading - samples[i - 1].heading) > 0.0001 || sample.carryingHuId !== samples[i - 1].carryingHuId));
      if (pendingMovement && !this.paused) animate = true;
    }
    if (moved) this._updateMoverInstances();
    const allHus = asArray(this.snapshot?.inventory?.hus || this.snapshot?.hus);
    const huStateSignature = allHus.map((hu) => { const h = this._visualHu(hu); return [h.id, h.locationId, h.state, h.cases, h.truckSlotId, h.stagingSlotId].join(':'); }).join('|');
    if (huStateSignature !== this.visualHuStateSignature) {
      this.visualHuStateSignature = huStateSignature; this._syncHus(allHus, false);
    } else if (moved || automatedMotion) this._renderHus();
    if (!this.paused && [...this.huHistory?.values() || []].some((history) => history.length > 1 && history.at(-1).at > this.visualAt && ['locationId', 'state', 'cases', 'truckSlotId', 'stagingSlotId'].some((key) => history.at(-1).hu[key] !== this._visualHu(history.at(-1).hu)[key]))) animate = true;
    if (!this.paused && [...this.huBirthAt?.values() || []].some(at => at > this.visualAt)) animate = true;
    if (this.selected && this.entities.has(this.selected)) {
      const record = this.entities.get(this.selected); this.selection.position.copy(record.position); this.selection.position.y = Math.max(0.14, record.position.y - record.size[1] / 2);
      const selectedMover = this.movers.get(this.selected);
      this.selection.rotation.y = selectedMover?.angle || 0;
    } else this.selection.visible = false;
    this.camera.position.y = Math.max(0.65, this.camera.position.y);
    if (this._usesFixedLook()) this.camera.lookAt(this.controls.target);
    else {
      this.controls.dampingFactor = 1 - Math.exp(-dt * 6);
      this.controls.target.y = Math.max(0.08, Math.min(9.4, this.controls.target.y));
      this.controls.update(dt);
    }
    this.routePin?.quaternion.copy(this.camera.quaternion);
    // Moving equipment and its shadows share the same frame. Updating shadows
    // at 8 Hz made the surfaces beneath smooth vehicles visibly flash/jump.
    // Camera-only frames still reuse the static shadow map.
    if (moved || automatedMotion) { this.sun.shadow.needsUpdate = true; this.lastShadowAt = time; }
    if (this.atmosphereMesh) this.atmosphereMesh.position.copy(this.camera.position);
    this.renderer.info.reset();
    if (!this.startupTimings.firstDrawStart) this.startupTimings.firstDrawStart = Math.round(now() - this.startedAt);
    this.lighting.render(this.camera, this.scene);
    if (!this.startupTimings.firstDrawEnd) {
      this.startupTimings.firstDrawEnd = Math.round(now() - this.startedAt);
      this.lastSnapshotAt = 0;
    }
    this.lastDrawCalls = this.renderer.info.render.drawCalls;
    this.lastTriangles = this.renderer.info.render.triangles;
    this.annotations?.update(this);
    this.host.dataset.drawCalls = String(this.renderer.info.render.drawCalls);
    this.host.dataset.triangles = String(this.renderer.info.render.triangles);
    this.host.dataset.sampleDelay = String(Math.round(this.renderDelay));
    this.host.dataset.frameBudget = 'high-fidelity';
    if (hadRecentFrame) {
      this.frameTimes.push(Math.min(1000, rawDelta)); if (this.frameTimes.length > 90) this.frameTimes.shift();
      const average = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.host.dataset.frameMs = average.toFixed(1);
    }
    if (this.snapshot && this.renderer.info.render.drawCalls > 0 && !this.contextLost) {
      this.host.dataset.renderedFrames = String(Number(this.host.dataset.renderedFrames || 0) + 1);
      this.host.dataset.renderedView = this.view;
      if (this.host.dataset.sceneReady !== 'true') {
        this.host.dataset.sceneReady = 'true';
        this.firstReadyMs ||= Math.round(now() - this.startedAt);
        this.host.setAttribute('aria-busy','false');
        if (this.loading) { this.loading.remove(); this.loading = null; this.host.dispatchEvent(new CustomEvent('scene-ready')); }
        if (!this.interiorEnvironmentRequest) {
          const prepareInterior = () => { if (this.active && !document.hidden) this._prepareInteriorEnvironment(); };
          if (window.requestIdleCallback) window.requestIdleCallback(prepareInterior);
          else window.setTimeout(prepareInterior, 300);
        }
      }
    }
    this.dirty = false;
    this.wasContinuous = animate || Boolean(this.pointerDown) || time - this.lastMotion < 650;
    if (animate || this.pointerDown || time - this.lastMotion < 650) this._request();
  }

  setQuality() {
    if (this.failed || this.disposed || !this.initialized) return;
    // Art direction is fixed: older persisted preferences cannot silently
    // remove shadows or lower material quality on a small viewport.
    this.quality = 'high';
    this._applyQuality();
  }

  _applyQuality() {
    this.effectiveQuality = 'high'; this.qualityChangedAt = now(); this.frameTimes = [];
    const pixelRatio = Math.min(devicePixelRatio || 1, 1.5);
    // Three.setPixelRatio calls setSize even for an identical ratio, clearing
    // the drawing buffer. Do not clear a populated demand-rendered canvas just
    // because a persisted "auto" preference is applied a second time.
    if (Math.abs(this.renderer.getPixelRatio() - pixelRatio) > 0.001) this.renderer.setPixelRatio(pixelRatio);
    this.renderer.shadowMap.enabled = true;
    const size = 4096;
    if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; this.sun.shadow.mapSize.set(size, size); }
    this.sun.shadow.needsUpdate = true;
    this.host.dataset.quality = this.quality;
    this.host.dataset.effectiveQuality = 'high';
    this.host.dataset.sceneReady = 'false';
    this._resize();
    this._request();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.frameId);
    this.navigation.clear();
    this.host.dataset.sceneReady = 'false';
    this.resizeObserver?.disconnect(); this.intersectionObserver?.disconnect();
    this.listeners.forEach((remove) => remove()); this.controls?.dispose();
    this.automation?.dispose();
    this.physics?.dispose();
    this.world?.traverse((object) => {
      if (object.isInstancedMesh) object.dispose();
      if (object.userData.blender) return;
      if (object.geometry && ![...this.geometry.values()].includes(object.geometry)) object.geometry.dispose();
      if (object.material && ![...this.materials.values()].includes(object.material)) object.material.dispose();
    });
    this.geometry.forEach((g) => g.dispose()); this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose()); this.generatedMaterials?.forEach((m) => m.dispose());
    this.models?.dispose();
    this.lighting?.dispose();
    this.environmentTarget?.dispose(); this.labelRecords.clear();
    this.interiorEnvironmentTarget?.dispose();
    this.exteriorSky?.dispose();
    this.renderer?.dispose(); this.renderer?.domElement.remove();
    delete this.host.getSceneDiagnostics;
    delete this.host.getSceneProjection;
    this.loading?.remove();
    this.annotations?.dispose();
    this.entities.clear(); this.movers.clear(); this.hitTargets = [];
  }
}
