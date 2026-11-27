# Optimización y revisión visual

## Perfil de consumo

El reloj y las operaciones siguen en el servidor. El observador visual interpola sus posiciones con un máximo de 30 FPS. No se ralentiza el proceso logístico para conseguir este límite.

- Densidad máxima: 1,25 en lugar de 2; un 61 % menos de píxeles en pantallas Retina que alcanzaban el límite anterior.
- Oclusión ambiental: 12 muestras a media resolución frente a 32 a resolución completa. Conserva el sombreado de contacto con bastante menos trabajo por fotograma.
- Sombras: 2048 en lugar de 4096. Mantienen actualización sincronizada con las máquinas; no se recortó su frecuencia por separado para evitar saltos.
- Superficies: WebP de las mismas dimensiones nativas 2K. Los 12 mapas pasan de 30.728.689 a 15.526.504 bytes (49,5 % menos). Los originales y su procedencia se conservan. Normales a calidad 95 y otros canales a 90.
- Caché HTTP de texturas durante siete días, con validación normal del servidor.
- Se conserva el renderizado bajo demanda y la suspensión al ocultar la página. La temperatura física depende también del dispositivo; estas cifras miden límites y recursos, no temperatura.

## Modelado

La célula robotizada utiliza cuerpos ahusados, servomotores y bridas separados, tapas metálicas, tornillería y conducciones. Los pivotes, longitudes funcionales y apoyos se conservan.

Descargadores y transportadores incorporan reductores con aletas, conexiones de servicio, canalizaciones y placas de fijación. Auto-ID, PIE y recepción de tienda reciben módulos de instrumentación y cajas de conexión. Los armarios incluyen juntas, bisagras, cerraduras y cableado protegido.

Montacargas, transelevadores, lanzaderas, AMR, cargadores y camiones tienen tratamientos específicos: guías, ventilación, contactos, apoyos, rodaduras, carrocerías redondeadas y pintura grafito con acentos de seguridad. Se redujo la escala de las etiquetas físicas que parecían carteles flotantes. Las fotografías del catálogo son referencias; los modelos son propios, no réplicas CAD certificadas.

## Pavimento y exterior

Las vías interiores ahora son gris industrial, con marcas claras y delimitación de seguridad. Los verdes de los indicadores de funcionamiento se conservan.

El perímetro incorpora dos filas de edificios con ventanas, remates, instalaciones de cubierta, calles laterales, aceras y vehículos estacionados. La decoración queda fuera de los caminos logísticos, ubicaciones y puntos de entrega, y no crea entidades de inventario ni nuevos destinos.

## Verificación

Pruebas de geometría, materiales, integridad de recursos, selección y movimiento; pruebas de navegador en WebGPU y WebGL 2 y recorrido autónomo completo en datos aislados. No se usaron las operaciones del servidor del usuario para verificar el flujo.
