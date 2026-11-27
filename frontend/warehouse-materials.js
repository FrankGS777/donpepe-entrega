import * as THREE from "three";

// Acabados PBR originales: albedo sRGB, relieve y rugosidad lineales.
// Texturas compartidas de 1024px; sin descargar modelos ni materiales externos.
export function createWarehouseMaterials(renderer) {
  const size = 1024;
  const textures = new Set();
  function random(seed) {
    return () => {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }
  function surface(draw, color = true) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    draw(canvas.getContext("2d"), random(7319));
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    textures.add(texture);
    return texture;
  }
  function grain(ctx, rng, count, amplitude = 0.08) {
    for (let i = 0; i < count; i++) {
      ctx.fillStyle =
        rng() > 0.5
          ? `rgba(255,255,255,${rng() * amplitude})`
          : `rgba(24,29,32,${rng() * amplitude})`;
      ctx.fillRect(rng() * size, rng() * size, 1 + rng() * 2, 1 + rng() * 2);
    }
  }
  // Relieve tangente derivado de altura, separado del albedo: se aprecia
  // especialmente al acercarse a cartón, hormigón y chapa corrugada.
  function normalFromHeight(height, strength = 1) {
    const data = height.image
      .getContext("2d")
      .getImageData(0, 0, size, size).data;
    const pixels = new Uint8Array(size * size * 4);
    const sample = (x, y) =>
      data[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const dx = (sample(x - 1, y) - sample(x + 1, y)) * strength;
        const dy = (sample(x, y - 1) - sample(x, y + 1)) * strength;
        const length = Math.hypot(dx, dy, 1),
          index = (y * size + x) * 4;
        pixels[index] = Math.round(((dx / length) * 0.5 + 0.5) * 255);
        pixels[index + 1] = Math.round(((dy / length) * 0.5 + 0.5) * 255);
        pixels[index + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255);
        pixels[index + 3] = 255;
      }
    const normal = new THREE.DataTexture(pixels, size, size);
    normal.flipY = true;
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
    normal.generateMipmaps = true;
    normal.minFilter = THREE.LinearMipmapLinearFilter;
    normal.magFilter = THREE.LinearFilter;
    normal.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    normal.needsUpdate = true;
    textures.add(normal);
    return normal;
  }
  const floorMap = surface((ctx, rng) => {
    ctx.fillStyle = "#bcc5c5";
    ctx.fillRect(0, 0, size, size);
    // Variación de pulido amplia; el grano fino no reemplaza al acabado epóxico.
    for (let i = 0; i < 48; i++) {
      const x = rng() * size,
        y = rng() * size,
        radius = 40 + rng() * 130;
      const cloud = ctx.createRadialGradient(x, y, 0, x, y, radius);
      cloud.addColorStop(0, i % 2 ? "#e3e8e813" : "#67787d09");
      cloud.addColorStop(1, "#ffffff00");
      ctx.fillStyle = cloud;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    grain(ctx, rng, 65000, 0.1);
    ctx.strokeStyle = "#4859580b";
    ctx.lineWidth = 10;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(rng() * size, 0);
      ctx.bezierCurveTo(
        rng() * size,
        size * 0.3,
        rng() * size,
        size * 0.7,
        rng() * size,
        size,
      );
      ctx.stroke();
    }
    ctx.strokeStyle = "#74858a55";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, size - 2, size - 2);
    ctx.strokeStyle = "#eef1ed55";
    ctx.lineWidth = 1;
    ctx.strokeRect(3, 3, size - 6, size - 6);
  });
  const floorBump = surface((ctx, rng) => {
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, size, size);
    grain(ctx, rng, 40000, 0.16);
    ctx.strokeStyle = "#4f4f4f";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, size - 2, size - 2);
  }, false);
  const floorRoughness = surface((ctx, rng) => {
    ctx.fillStyle = "#b3b3b3";
    ctx.fillRect(0, 0, size, size);
    grain(ctx, rng, 6000, 0.1);
  }, false);
  const wallMap = surface((ctx, rng) => {
    ctx.fillStyle = "#e7e9e5";
    ctx.fillRect(0, 0, size, size);
    grain(ctx, rng, 25000, 0.025);
    // Uniones de panel sándwich y remaches: ritmo de la envolvente industrial.
    ctx.fillStyle = "#a7b3b9";
    ctx.fillRect(0, 0, 3, size);
    ctx.fillStyle = "#f9faf6";
    ctx.fillRect(4, 0, 2, size);
    for (let y = 32; y < size; y += 128) {
      ctx.fillStyle = "#9eaab0";
      ctx.fillRect(9, y, 3, 3);
    }
  });
  const wallBump = surface((ctx) => {
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#4c4c4c";
    ctx.fillRect(0, 0, 4, size);
  }, false);
  const roofMap = surface((ctx, rng) => {
    ctx.fillStyle = "#a8b4bb";
    ctx.fillRect(0, 0, size, size);
    for (let x = 0; x < size; x += 32) {
      const rib = ctx.createLinearGradient(x, 0, x + 32, 0);
      rib.addColorStop(0, "#82949f");
      rib.addColorStop(0.2, "#c2cbd0");
      rib.addColorStop(0.55, "#bdc6cc");
      rib.addColorStop(0.8, "#8d9da6");
      rib.addColorStop(1, "#82949f");
      ctx.fillStyle = rib;
      ctx.fillRect(x, 0, 32, size);
      ctx.fillStyle = "#566975";
      ctx.fillRect(x + 7, 14, 2, 3);
      ctx.fillRect(x + 7, size - 18, 2, 3);
    }
    grain(ctx, rng, 7000, 0.045);
    ctx.fillStyle = "#526a7655";
    ctx.fillRect(0, size - 2, size, 2);
  });
  const roofBump = surface((ctx) => {
    for (let x = 0; x < size; x += 32) {
      const rib = ctx.createLinearGradient(x, 0, x + 32, 0);
      rib.addColorStop(0, "#555555");
      rib.addColorStop(0.25, "#dddddd");
      rib.addColorStop(0.65, "#bbbbbb");
      rib.addColorStop(1, "#555555");
      ctx.fillStyle = rib;
      ctx.fillRect(x, 0, 32, size);
    }
  }, false);
  const woodMap = surface((ctx, rng) => {
    ctx.fillStyle = "#b69469";
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 3) {
      ctx.strokeStyle = `rgba(77,46,24,${0.025 + rng() * 0.13})`;
      ctx.lineWidth = 0.5 + rng();
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(150, y + rng() * 8, 360, y - rng() * 8, size, y);
      ctx.stroke();
    }
    for (const [x, y] of [
      [103, 123],
      [338, 382],
    ]) {
      ctx.strokeStyle = "#795d3c66";
      ctx.lineWidth = 1;
      for (let r = 3; r < 21; r += 3) {
        ctx.beginPath();
        ctx.ellipse(x, y, r * 2, r / 3, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    grain(ctx, rng, 5000, 0.1);
  });
  const cartonMap = surface((ctx, rng) => {
    ctx.fillStyle = "#c1a077";
    ctx.fillRect(0, 0, size, size);
    grain(ctx, rng, 65000, 0.13);
    ctx.fillStyle = "#d6bc8a";
    ctx.fillRect(size / 2 - 24, 0, 48, size);
    ctx.strokeStyle = "#9c783fb0";
    ctx.lineWidth = 2;
    ctx.strokeRect(size / 2 - 24, 0, 48, size);
    ctx.strokeStyle = "#70543466";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, size - 2, size - 2);
    ctx.strokeStyle = "#826d4c55";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, size / 2);
    ctx.lineTo(size, size / 2);
    ctx.stroke();
    ctx.fillStyle = "#6b542c";
    ctx.font = "bold 25px monospace";
    ctx.fillText("DONPEPE · WMS", 48, size - 74);
    ctx.font = "18px monospace";
    ctx.fillText("MANIPULAR CON CUIDADO", 48, size - 44);
    ctx.strokeStyle = "#69532f";
    ctx.lineWidth = 4;
    for (const x of [size - 100, size - 67]) {
      ctx.beginPath();
      ctx.moveTo(x, size - 130);
      ctx.lineTo(x, size - 70);
      ctx.moveTo(x - 10, size - 116);
      ctx.lineTo(x, size - 130);
      ctx.lineTo(x + 10, size - 116);
      ctx.stroke();
    }
  });
  const woodBump = surface((ctx, rng) => {
    ctx.fillStyle = "#858585";
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 3) {
      ctx.fillStyle = `rgba(0,0,0,${rng() * 0.18})`;
      ctx.fillRect(0, y, size, 1);
    }
  }, false);
  const cartonBump = surface((ctx, rng) => {
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, size, size);
    grain(ctx, rng, 50000, 0.1);
    ctx.fillStyle = "#aaa";
    ctx.fillRect(size / 2 - 24, 0, 48, size);
    ctx.strokeStyle = "#5c5c5c";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, size - 2, size - 2);
  }, false);
  const coatingBump = surface((ctx, rng) => {
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, size, size);
    grain(ctx, rng, 40000, 0.12);
  }, false);
  const galvanizedMap = surface((ctx, rng) => {
    ctx.fillStyle = "#b0b9be";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 7000; i++) {
      ctx.fillStyle = `rgba(${rng() > 0.5 ? "242,247,248" : "91,110,121"},.13)`;
      ctx.beginPath();
      const x = rng() * size,
        y = rng() * size;
      ctx.moveTo(x, y);
      ctx.lineTo(x + 8 + rng() * 12, y + 3);
      ctx.lineTo(x + 10, y + 10 + rng() * 10);
      ctx.closePath();
      ctx.fill();
    }
  });
  function mat(params, tileSize) {
    const m = new THREE.MeshStandardMaterial(params);
    if (tileSize) m.userData.tileSize = tileSize;
    return m;
  }
  const materials = {
    lane: mat(
      {
        color: 0x187848,
        bumpMap: floorBump,
        bumpScale: 0.015,
        roughnessMap: floorRoughness,
        roughness: 0.73,
        metalness: 0.04,
      },
      5,
    ),
    floor: mat(
      {
        color: 0xffffff,
        map: floorMap,
        bumpMap: floorBump,
        bumpScale: 0.024,
        roughnessMap: floorRoughness,
        roughness: 0.65,
        metalness: 0.04,
      },
      5,
    ),
    wall: mat(
      {
        color: 0xffffff,
        map: wallMap,
        bumpMap: wallBump,
        bumpScale: 0.015,
        roughness: 0.67,
        metalness: 0.12,
      },
      1.5,
    ),
    coldWall: mat(
      {
        color: 0xdbeaf0,
        map: wallMap,
        bumpMap: wallBump,
        bumpScale: 0.013,
        roughness: 0.53,
        metalness: 0.2,
      },
      1.5,
    ),
    roof: mat(
      {
        color: 0xffffff,
        map: roofMap,
        bumpMap: roofBump,
        bumpScale: 0.045,
        roughness: 0.42,
        metalness: 0.65,
        side: THREE.DoubleSide,
      },
      3,
    ),
    rack: mat({
      color: 0x1267a5,
      roughness: 0.38,
      metalness: 0.52,
      bumpMap: coatingBump,
      bumpScale: 0.001,
    }),
    beam: mat({
      color: 0xe15c24,
      roughness: 0.39,
      metalness: 0.48,
      bumpMap: coatingBump,
      bumpScale: 0.001,
    }),
    galvanized: mat({
      color: 0xffffff,
      map: galvanizedMap,
      roughness: 0.42,
      metalness: 0.78,
    }),
    structure: mat({ color: 0x657781, roughness: 0.38, metalness: 0.72 }),
    skirting: mat({ color: 0x697c85, roughness: 0.65, metalness: 0.28 }),
    wood: mat({
      color: 0xffffff,
      map: woodMap,
      bumpMap: woodBump,
      bumpScale: 0.009,
      roughness: 0.88,
    }),
    carton: mat({
      color: 0xffffff,
      map: cartonMap,
      bumpMap: cartonBump,
      bumpScale: 0.007,
      roughness: 0.95,
    }),
    led: mat({
      color: 0xf6f2dd,
      emissive: 0xffefcc,
      emissiveIntensity: 0.35,
      roughness: 0.35,
    }),
  };
  for (const [key, height, strength] of [
    ["floor", floorBump, 0.45],
    ["wall", wallBump, 1.7],
    ["coldWall", wallBump, 1.7],
    ["roof", roofBump, 2.2],
    ["wood", woodBump, 0.6],
    ["carton", cartonBump, 0.7],
    ["rack", coatingBump, 0.3],
    ["beam", coatingBump, 0.3],
  ]) {
    materials[key].normalMap = normalFromHeight(height, strength);
    materials[key].normalScale.set(0.55, 0.55);
    materials[key].bumpMap = null;
  }
  return {
    materials,
    textures,
    dispose() {
      textures.forEach((t) => t.dispose());
      Object.values(materials).forEach((m) => m.dispose());
    },
  };
}

// UV en metros: el panel no se estira hasta convertirse en una mancha al
// cambiar el ancho de una pared o de la losa. Se cachea con la geometría.
export function worldBoxUV(geometry, tileSize) {
  const p = geometry.attributes.position,
    n = geometry.attributes.normal,
    uv = geometry.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(n.getX(i)) > 0.5)
      uv.setXY(i, p.getZ(i) / tileSize, p.getY(i) / tileSize);
    else if (Math.abs(n.getY(i)) > 0.5)
      uv.setXY(i, p.getX(i) / tileSize, p.getZ(i) / tileSize);
    else uv.setXY(i, p.getX(i) / tileSize, p.getY(i) / tileSize);
  }
  return geometry;
}

export function industrialRoofGeometry(width, depth) {
  const segments = 64,
    bays = 4,
    positions = [],
    uvs = [],
    indices = [];
  for (let i = 0; i <= segments; i++) {
    const x = (width * i) / segments;
    const local = ((i / segments) * bays) % 1;
    const y = 9 + 1.25 * Math.sin(local * Math.PI);
    for (const z of [0, depth]) {
      positions.push(x, y, z);
      uvs.push(x / 3, z / 3);
    }
    if (i < segments) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
