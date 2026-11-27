import * as THREE from 'three';

// Industrial PBR: photographic CC0 surfaces, calibrated roughness and shared
// mipmapped maps. Surface detail is static; machine articulation owns motion.
const SURFACES = Object.freeze({
  concrete: { size: 512, roughness: .86, metalness: 0, normal: .19 },
  'concrete-jointed': { size: 512, roughness: .86, metalness: 0, normal: .22 },
  epoxy: { size: 512, roughness: .46, metalness: 0, normal: .12 },
  carton: { size: 1024, roughness: .91, metalness: 0, normal: .14 },
  wood: { size: 512, roughness: .78, metalness: 0, normal: .21 },
  galvanized: { size: 512, roughness: .52, metalness: .56, normal: .1 },
  roof: { size: 512, roughness: .64, metalness: .42, normal: .22 },
  wall: { size: 512, roughness: .72, metalness: .025, normal: .17 },
  asphalt: { size: 512, roughness: .96, metalness: 0, normal: .18 },
  rubber: { size: 512, roughness: .88, metalness: 0, normal: .18 },
  tape: { size: 512, roughness: .46, metalness: 0, normal: .1 },
  barcode: { size: 512, roughness: .8, metalness: 0, normal: 0 },
});
const clamp = (v, min = 0, max = 1) => Math.max(min, Math.min(max, v));
const wrap = (v, period) => ((v % period) + period) % period;
const fade = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

function randomGenerator(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
}

function hash(x, y, seed = 41) {
  let h = Math.imul(x ^ seed, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Periodic value fields keep the UV seam invisible, even on large slab floors.
function field(u, v, cells, seed) {
  const x = u * cells, y = v * cells, ix = Math.floor(x), iy = Math.floor(y);
  const fx = fade(x - ix), fy = fade(y - iy);
  return lerp(
    lerp(hash(wrap(ix, cells), wrap(iy, cells), seed), hash(wrap(ix + 1, cells), wrap(iy, cells), seed), fx),
    lerp(hash(wrap(ix, cells), wrap(iy + 1, cells), seed), hash(wrap(ix + 1, cells), wrap(iy + 1, cells), seed), fx), fy,
  );
}

function makeSurface(kind, size) {
  const count = size * size, rgba = new Uint8Array(count * 4);
  const height = new Float32Array(count), roughness = new Float32Array(count);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = y * size + x;
    const broad = field(u, v, 2, 79), finish = field(u, v, 4, 197);
    // Neutral albedo preserves the selected paint exactly. Surface variation is
    // deliberately broad and low contrast, so distant tiles cannot sparkle.
    let light = .985, relief = .5, rough = .97;
    if (kind === 'concrete' || kind === 'concrete-jointed') {
      const trowel = Math.sin((u + v) * Math.PI * 4) * .025;
      light += (broad - .5) * .012;
      relief += trowel + (broad - .5) * .04;
      rough += (finish - .5) * .025;
      if (kind === 'concrete-jointed') {
        const distance = Math.min(u, v, 1 - u, 1 - v);
        const joint = 1 - fade(clamp(distance / .035));
        light -= joint * .035; relief -= joint * .09;
      }
    } else if (kind === 'epoxy') {
      light += (broad - .5) * .006;
      relief += Math.sin(u * Math.PI * 4) * Math.cos(v * Math.PI * 4) * .022;
      rough += (finish - .5) * .035;
    } else if (kind === 'carton') {
      const fibre = field(u,v,64,317), grain = hash(x,y,631);
      light += (broad - .5) * .045 + (fibre - .5) * .025 + (grain - .5) * .012;
      relief += (fibre - .5) * .025 + (grain - .5) * .006;
      relief += Math.sin(v * Math.PI * 4) * .026 + (finish - .5) * .025;
      rough += (finish - .5) * .03;
    } else if (kind === 'wood') {
      // Four smooth growth bands follow the actual modelled pallet slats.
      const warp = Math.sin(u * Math.PI * 2) * .022;
      const grain = .5 + .5 * Math.sin((v + warp) * Math.PI * 8);
      light -= grain * .045;
      relief -= grain * .075;
      rough += (broad - .5) * .035;
    } else if (kind === 'galvanized') {
      // Satin metal receives a broad environment highlight, never glitter.
      light += (broad - .5) * .008;
      relief += Math.sin(v * Math.PI * 4) * .022;
      rough += (finish - .5) * .04;
    } else if (kind === 'roof') {
      // Four broad, rounded folds with smooth shoulders. Hard 1-pixel creases
      // and high-power ribs cause shimmering when the camera moves.
      const rib = .5 + .5 * Math.cos(u * Math.PI * 8);
      light -= rib * .012;
      relief += rib * .12;
      rough += (broad - .5) * .025;
    } else if (kind === 'wall') {
      const distance = Math.min(u, 1 - u);
      const joint = 1 - fade(clamp(distance / .045));
      light += (broad - .5) * .006 - joint * .025;
      relief += Math.sin(v * Math.PI * 2) * .018 - joint * .065;
      rough += (finish - .5) * .025;
    } else if (kind === 'asphalt') {
      light += (broad - .5) * .018;
      relief += Math.sin(u * Math.PI * 4) * Math.cos(v * Math.PI * 4) * .027;
      rough += (finish - .5) * .02;
    } else if (kind === 'rubber') {
      const groove = .5 + .5 * Math.cos((u + v) * Math.PI * 8);
      light -= groove * .02;
      relief -= groove * .075;
      rough += (finish - .5) * .03;
    } else if (kind === 'tape') {
      const crease = Math.sin(v * Math.PI * 4 + Math.sin(u * Math.PI * 2) * .2);
      light += crease * .007;
      relief += crease * .022;
      rough += (finish - .5) * .04;
    }
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = Math.round(clamp(light) * 255);
    rgba[i * 4 + 3] = 255;
    height[i] = relief;
    roughness[i] = rough;
  }
  return { rgba, height, roughness };
}

function normalBytes(height, size) {
  const normal = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const index = (y * size + x) * 4;
    const slope = size / 48;
    const dx = (height[y * size + wrap(x + 1, size)] - height[y * size + wrap(x - 1, size)]) * slope;
    const dy = (height[wrap(y + 1, size) * size + x] - height[wrap(y - 1, size) * size + x]) * slope;
    const inv = 1 / Math.hypot(dx, dy, 1);
    normal[index] = Math.round((-dx * inv * .5 + .5) * 255);
    normal[index + 1] = Math.round((-dy * inv * .5 + .5) * 255);
    normal[index + 2] = Math.round((inv * .5 + .5) * 255);
    normal[index + 3] = 255;
  }
  return normal;
}

function roughnessBytes(values) {
  const bytes = new Uint8Array(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    const value = Math.round(clamp(values[i]) * 255);
    bytes[i * 4] = bytes[i * 4 + 1] = bytes[i * 4 + 2] = value;
    bytes[i * 4 + 3] = 255;
  }
  return bytes;
}

export default class IndustrialMaterials {
  constructor(renderer, { materialCache = new Map(), textureRegistry = new Set(), resolveColor = (color) => color } = {}) {
    this.materials = materialCache;
    this.textures = textureRegistry;
    this.resolveColor = resolveColor;
    this.anisotropy = Math.min(renderer?.getMaxAnisotropy?.() || renderer?.capabilities?.getMaxAnisotropy?.() || 1, 16);
    this.photographic = new Map();
    this.assetErrors = [];
    this.disposed = false;
    this.atlases = new Map();
    this.variants = new Map();
    this.ownedMaterials = new Set();
    this.ownedTextures = new Set();
  }

  async loadPhotographic(loader = new THREE.TextureLoader()) {
    const root = '/textures/industrial/';
    // Metal keeps the authored coating colour; scanned relief and roughness
    // describe its substrate. Wood, concrete and asphalt use the real albedo.
    const sources = { concrete:'concrete_floor_02', wood:'brown_planks_03',
      galvanized:'metal_plate', asphalt:'asphalt_03' };
    await Promise.all(Object.entries(sources).map(async ([kind, asset]) => {
      const channels = kind === 'galvanized' ? ['nor_gl', 'rough'] : ['diff', 'nor_gl', 'rough'];
      const entries = await Promise.all(channels.map(async channel => {
        try {
          const texture = await loader.loadAsync(`${root}${asset}_${channel}_2k.webp`);
          if (this.disposed) { texture.dispose(); return null; }
          return [channel, this._track(texture, channel === 'diff')];
        } catch (error) {
          this.assetErrors.push(`${asset}:${channel}`); return null;
        }
      }));
      if (this.disposed) return;
      const maps = Object.fromEntries(entries.filter(Boolean));
      if (entries.every(Boolean)) this.photographic.set(kind, {
        ...SURFACES[kind], kind, size:2048, photographic:true, source:asset,
        map:maps.diff || null, normalMap:maps.nor_gl, roughnessMap:maps.rough,
        roughness:1, normal:kind === 'wood' ? .35 : kind === 'asphalt' ? .28 : .22,
      });
    }));
  }

  recolor(material) {
    material.color.setHex(this.resolveColor(material.userData.baseColor));
    if (material.userData.naturalAlbedo) material.color.lerp(new THREE.Color(0xffffff), .85);
  }

  _track(texture, srgb = false) {
    texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = this.anisotropy;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    this.textures.add(texture); this.ownedTextures.add(texture);
    return texture;
  }

  _data(bytes, size, srgb) {
    return this._track(new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat, THREE.UnsignedByteType), srgb);
  }

  _atlas(requestedKind) {
    const kind = requestedKind === 'metal' ? 'galvanized' : SURFACES[requestedKind] ? requestedKind : 'concrete';
    if (this.atlases.has(kind)) return this.atlases.get(kind);
    if (this.photographic.has(kind)) {
      const atlas = this.photographic.get(kind);
      // Neutral albedo for bare metals; colour belongs to their coating.
      if (!atlas.map) atlas.map = this._data(new Uint8Array([255,255,255,255]), 1, true);
      this.atlases.set(kind, atlas); return atlas;
    }
    const profile = SURFACES[kind], { size } = profile;
    let atlas;
    if (kind === 'barcode') {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.scale(size / 256, size / 256);
      ctx.fillStyle = '#f8f7ef'; ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#24272a'; ctx.fillRect(14, 12, 228, 3);
      ctx.font = '700 24px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('DONPEPE', 16, 45);
      const random = randomGenerator(731);
      for (let x = 17; x < 239;) {
        const width = 1 + Math.floor(random() * 3);
        ctx.fillRect(x, 67, width, 118); x += width + 2 + Math.floor(random() * 3);
      }
      ctx.font = '16px monospace'; ctx.fillText('UNIDAD LOGÍSTICA', 17, 216);
      ctx.fillStyle = '#bba77d'; ctx.fillRect(16, 232, 224, 5);
      // The mesh label is decorative. Actual identification comes from the HU
      // detail panel and its genuine code, never this repeated visual atlas.
      atlas = { ...profile, kind, map: this._track(new THREE.CanvasTexture(canvas), true) };
    } else {
      const { rgba, height, roughness } = makeSurface(kind, size);
      atlas = { ...profile, kind, map: this._data(rgba, size, true),
        normalMap: this._data(normalBytes(height, size), size, false),
        roughnessMap: this._data(roughnessBytes(roughness), size, false) };
    }
    this.atlases.set(kind, atlas);
    return atlas;
  }

  maps(kind, repeat = [1, 1]) {
    const source = this._atlas(kind);
    const rx = clamp(Number(repeat?.[0]) || 1, .01, 256), ry = clamp(Number(repeat?.[1]) || 1, .01, 256);
    if (rx === 1 && ry === 1) return source;
    const key = `${source.kind}:${rx}:${ry}`;
    if (!this.variants.has(key)) {
      const variant = { ...source };
      for (const channel of ['map', 'normalMap', 'roughnessMap']) if (source[channel]) {
        // Texture clones share the same Source pixel buffer. Only their UV
        // transforms differ, so every patch does not allocate another atlas.
        const texture = source[channel].clone(); texture.repeat.set(rx, ry);
        variant[channel] = this._track(texture, channel === 'map');
      }
      this.variants.set(key, variant);
    }
    return this.variants.get(key);
  }

  texture(kind, { repeat = [1, 1] } = {}) { return this.maps(kind, repeat).map; }

  material(color, options = {}) {
    const { texture, repeat = [1, 1], roughness, metalness, normalScale, ...rest } = options;
    const key = `pbr:${color}:${texture || ''}:${repeat.join(',')}:${roughness ?? ''}:${metalness ?? ''}:${JSON.stringify(normalScale)}:${JSON.stringify(rest)}`;
    if (this.materials.has(key)) return this.materials.get(key);
    // UV tiling belongs to geometry. Texture clones with a shared Source still
    // allocate/upload separate GPU images in Three's WebGPU backend.
    const maps = texture ? this._atlas(texture) : null;
    const settings = { color: this.resolveColor(color), ...rest };
    let material;
    if (rest.visible === false) {
      // Invisible pick targets have no reason to compile a PBR shader.
      material = new THREE.MeshBasicMaterial(settings);
    } else {
      material = new THREE.MeshPhysicalMaterial({
        clearcoat: texture ? 0 : .18, clearcoatRoughness:.3,
        ...settings,
        roughness: roughness ?? maps?.roughness ?? .38,
        metalness: metalness ?? maps?.metalness ?? .2,
        ...(maps ? { map: maps.map, normalMap: maps.normalMap || null, roughnessMap: maps.roughnessMap || null } : {}),
        normalScale: normalScale?.isVector2 ? normalScale : new THREE.Vector2(
          normalScale?.[0] ?? maps?.normal ?? .15, normalScale?.[1] ?? maps?.normal ?? .15,
        ),
        envMapIntensity: rest.envMapIntensity ?? 1,
      });
      // The atlas stays close to 1; the authored scalar is the finish instead
      // of being multiplied by an unrelated second roughness value.
    }
    if (texture) material.userData.surfaceRepeat = [clamp(Number(repeat[0]) || 1, .01, 256), clamp(Number(repeat[1]) || 1, .01, 256)];
    material.userData.baseColor = color;
    material.userData.surface = maps?.kind || 'paint';
    material.userData.style = 'industrial-pbr';
    material.userData.naturalAlbedo = Boolean(maps?.photographic && maps.kind !== 'galvanized');
    this.recolor(material);
    this.materials.set(key, material); this.ownedMaterials.add(material);
    return material;
  }

  diagnostics() {
    const atlases = [...this.atlases.values()];
    return { atlases: atlases.map(({ kind, size, photographic, source }) => ({ kind, size, photographic:Boolean(photographic), source })), variants: this.variants.size,
      pixelBufferBytes: atlases.reduce((sum, atlas) => sum + atlas.size ** 2 * 4 * (atlas.normalMap ? 3 : 1), 0),
      materials: this.ownedMaterials.size, photographicSources: this.photographic.size, missingAssets:[...this.assetErrors] };
  }

  // Optional when the caller does not own the supplied registries. The main
  // renderer already disposes its shared material and texture registries.
  dispose() {
    this.disposed = true;
    for (const material of this.ownedMaterials) {
      material.dispose();
      for (const [key, cached] of this.materials) if (cached === material) this.materials.delete(key);
    }
    for (const texture of this.ownedTextures) { texture.dispose(); this.textures.delete(texture); }
    this.ownedMaterials.clear(); this.ownedTextures.clear(); this.atlases.clear(); this.variants.clear(); this.photographic.clear();
  }
}
