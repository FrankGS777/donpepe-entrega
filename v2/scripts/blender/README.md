# Modelos 3D de DonPepe

El archivo `v2/assets/donpepe-industrial.blend` contiene las piezas organizadas por colección. El generador reproduce ese archivo, el atlas de luz y el GLB. Los pivotes y las dimensiones locales corresponden a metros del plano del almacén.

Regeneración desde la raíz del proyecto

```sh
blender -b -t 4 --factory-startup --python-exit-code 1 --python v2/scripts/blender/build_scene.py
model_dir=$(mktemp -d)
npx --yes --package=gltfpack@1.3.0 gltfpack \
  -i v2/public/models/donpepe-industrial-v1.glb \
  -o "$model_dir/donpepe-industrial-v1.glb" -kn -km -ke -vpf -vtf -vn 12
mv "$model_dir/donpepe-industrial-v1.glb" v2/public/models/
rmdir "$model_dir"
npm run build:v2
```

El cargador agrupa las piezas repetidas e incorpora los modelos móviles a los pivotes y mecanismos que usa la simulación. Comprueba ambos renderizadores con `v2/scripts/verify-map-startup.cjs`. Para probar WebGL 2, establece `QA_FORCE_WEBGL=1`.

`high_fidelity.py` contiene las carcasas de radio continuo, piezas mecanizadas,
herrajes, sensores y acabados PBR. Los mapas de color se interpretan en sRGB;
normales, rugosidad y oclusión usan datos lineales. El esmalte es dieléctrico y
el acero descubierto es metálico. Los UV se exportan y se mantienen sin
cuantizar para evitar distorsión de texturas pequeñas.
Las cavidades locales se calculan sobre la geometría de cada máquina y se
guardan como color de vértice: viajan con el equipo sin texturas adicionales.
El GLB se sustituye después de terminar la exportación, evitando descargas de
un archivo incompleto durante la regeneración.

`bake_floor.py` calcula con Cycles la oclusión estática de los apoyos de racks.
Usa `v2/assets/warehouse-layout-lighting.json`, una copia del plano de la
simulación. Para un plano diferente hay que regenerar ese JSON y volver a
ejecutar el horneado. El navegador compara las posiciones antes de aplicarlo;
si cambia un rack o el tamaño de la nave, descarta el atlas obsoleto. Las cajas,
vehículos y mecanismos siguen recibiendo sombras dinámicas; no se dibujan en
la textura. El horneado funciona con CPU; Metal es opcional mediante
`DONPEPE_BAKE_METAL=1`.

La calidad alta utiliza sombras de 4096 píxeles, MSAA de cuatro muestras y
oclusión GTAO de 16 muestras al 75 % de resolución. El límite de dibujo es
60 FPS; el motor de inventario y las trayectorias conservan su reloj propio.
La tasa real depende del equipo, tamaño de ventana y carga de trabajo.

`portal_assemblies.py` construye los pórticos Auto-ID y PIE con canales,
platabandas, anclajes, cubiertas desmontables, conducciones y soportes ópticos.
Sus huecos conservan la trayectoria de la cinta y de la carga. La articulación
del cabezal sigue perteneciendo a la simulación.

`trace-brand.py` obtiene contornos cerrados de la marca y conserva los huecos
de las letras. `scene-brand.js` los extruye para las fachadas. El SVG claro
sin fondo se utiliza únicamente como vinilo sobre las carrocerías; no hay
placa rectangular detrás de los emblemas. El generador usa Pillow y NumPy.
