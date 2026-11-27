# Mapa industrial: WebGPU, materiales y selección

Actualizado el 29 de octubre de 2026, hora de Lima.

## Cambios implementados

El motor visible usa `WebGPURenderer` de Three.js r180. Inicializa el dispositivo antes de construir y dibujar el centro. Las instantáneas que llegan mientras carga se consolidan: al terminar se aplica la última, sin avanzar el reloj ni repetir operaciones. Three.js emplea WebGPU cuando está disponible y WebGL 2 como alternativa compatible.

El perfil visual conserva los materiales detallados y limita el trabajo de GPU a 30 FPS y densidad máxima de 1,25 píxeles por píxel CSS. El renderizado utiliza MSAA de cuatro muestras, buffers de color de media precisión, transformación de color AgX, sombras direccionales de 2048 × 2048, iluminación de entorno HDR y oclusión ambiental GTAO de 12 muestras a media resolución. Cada cámara mantiene su propia proyección para evitar errores al alternar perspectiva interior e isométrica exterior. No se acumulan imágenes de fotogramas anteriores: las cargas y máquinas no dejan estelas temporales.

Se incorporaron superficies fotográficas locales de 2048 × 2048 para concreto, madera, metal y asfalto. Los datos de normales y rugosidad son lineales; el color utiliza sRGB. El metal conserva su color industrial y toma relieve y rugosidad del material de referencia. Cartón, revestimientos, cubierta, caucho y precintos mantienen mapas procedurales de mayor resolución; las cajas llegan a 1024 × 1024. Los mipmaps y el filtrado anisotrópico evitan muaré y destellos en superficies oblicuas.

El entorno HDR es de 1024 × 512 nativos. No se presenta como una imagen de 4K ni como iluminación trazada con rayos. Se mantiene una iluminación de estudio de respaldo si ese recurso no está disponible.

Los activos CC0 están incluidos en `public/textures/industrial/`, con origen, licencia, tamaño y SHA-256 en su manifiesto. La aplicación no consulta servicios externos para cargar estas superficies.

## Modelado y mecanismos

- Los racks tienen montantes de perfil abierto, placas, anclajes, conectores, diagonales y apoyos de acero separados. La etiqueta superior se redujo a una escala más plausible para que no domine la vista frontal de un palé.
- El pavimento fotográfico queda visible también dentro de las zonas. La vegetación utiliza ramas y hojas con relieve visual, transparencia recortada y nervaduras, en lugar de copas formadas por esferas.
- Los bordes usan biseles más finos; cilindros, ruedas y remates tienen una silueta más suave. Se añadieron llantas, tornillería, ejes, largueros, depósitos, peldaños, pilotos, rejillas y herrajes en vehículos, manteniendo su huella operativa.
- Los transelevadores incorporan guías, cadena y rodillos unidos a su carro. Las horquillas y plataformas siguen la altura y extensión reportadas por el motor.
- Los rodillos del transportador se dibujan en grupos de instancias y giran durante las fases de transporte observadas. La pausa congela su movimiento. No generan recepciones ni trasladan inventario por sí mismos.
- Los transportadores incluyen motorreductor, resguardos, patas y uniones. Las transferencias siguen sus apoyos existentes: elevador, horquillas, asiento y retracción.
- El techo del camión permanece físicamente presente al abrir las puertas; abrirlo ya no hace desaparecer su cubierta.
- Las grandes superficies del terreno no proyectan sombra sobre sí mismas. Se conservan las sombras de edificios, racks, cargas y equipos para evitar bandas y parpadeos por auto sombreado.

Las imágenes del catálogo de equipos siguen siendo referencias de diseño, no planos CAD del fabricante. Los modelos de maquinaria son geométricos y articulados, construidos para los volúmenes y apoyos del sistema. Esta entrega no convierte todas las máquinas en escaneos industriales ni garantiza un resultado indistinguible de una fotografía.

## Selección sin ocultación

Se eliminó el sistema de corte visual, incluyendo sus máscaras de instancias y las comprobaciones que excluían objetos ocultos del puntero. Seleccionar, girar o cambiar de selección no retira piezas que se interpongan.

Se conserva la cámara frontal a la altura del objeto y desde el pasillo que sirve a su rack. No se abre un selector emergente. La ficha lateral muestra los datos e imagen del elemento. En móvil puede resumirse y desplegarse para dejar espacio al mapa.

La apertura normal de la nave al cambiar a la perspectiva interior es independiente de la selección. La estructura no se altera en el inventario, en las colisiones ni en el cálculo de rutas.

## Compatibilidad y recursos

WebGL 2 admite adaptadores con bloques de uniformes de sólo 16 KiB. Three r180 elige uniformes para algunos tamaños de lote que pueden superar ese límite. El constructor de instancias utiliza atributos en esos lotes, manteniendo la cantidad dibujada y seleccionable exacta. No se crean piezas adicionales visibles ni se modifican archivos de la dependencia.

Los mapas fotográficos consumen más memoria que los anteriores. La estimación de píxeles del diagnóstico describe los atlas únicos; no debe interpretarse como una medición exacta de memoria total de la GPU. Los límites son constantes, sin saltos de resolución durante el movimiento. La frecuencia real depende del dispositivo, la resolución, la vista y las cargas visibles.

## Verificación

- Pruebas de cámara, materiales, procedencia e integridad de recursos, selección, interpolación, apoyos físicos, infraestructura ampliada y autonomía.
- Pruebas de navegador con WebGPU nativo y WebGL 2 forzado: las cuatro perspectivas, giro, selección sin ocultación, temas claro/oscuro y tamaño móvil. Se inspeccionan píxeles del lienzo y errores de compilación, no sólo la existencia de un canvas.
- Recorrido autónomo en bases aisladas: compra, descarga, Auto-ID, inspección, transferencia con apoyo, almacenaje, preparación, montacargas, carga, recepción de tienda y liberación final de equipos. Caso: 12 cajas recibidas, 6 entregadas y 6 almacenadas.
- El caso de movimiento nativo inicial registró aproximadamente 51–60 FPS en fases activas. Es una medición de ese escenario y equipo, no una garantía universal ni una prueba de ocupación máxima.

Los informes de navegador se guardan junto a este proyecto, en `outputs/mapa-webgpu-20261029/`, `outputs/mapa-webgpu-20261029-webgl2/` y `outputs/mapa-webgpu-autonomia-20261029/`. No se modificó la base de datos en uso para hacer esas pruebas.

## Fuentes de los recursos y tecnología

- [WebGPURenderer, documentación de Three.js](https://threejs.org/docs/pages/WebGPURenderer.html).
- [MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html).
- [Licencia de Poly Haven](https://polyhaven.com/license).
- [Concreto](https://polyhaven.com/a/concrete_floor_02), [madera](https://polyhaven.com/a/brown_planks_03), [metal](https://polyhaven.com/a/metal_plate), [asfalto](https://polyhaven.com/a/asphalt_03) y [entorno HDR](https://polyhaven.com/a/industrial_sunset_02).
