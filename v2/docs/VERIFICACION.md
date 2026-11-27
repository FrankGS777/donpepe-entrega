# Verificación DonPepe 3.1 · Diorama y expedición física

Fecha: 17 de octubre de 2026. Entorno local: macOS, Node 24 y Google Chrome. Datos ficticios aislados; no se iniciaron migraciones ni se modificó la base MySQL anterior.

## Estilizado de alta fidelidad, contactos y lectura operativa · 18 de octubre

Esta revisión sustituye el acabado gráfico y el control de movimiento guiado, sin sustituir inventario ni documentos. Los resultados siguientes corresponden al cliente SHA-256 `7146f0a1e8c02ca345d14e2349e007e52c7ee506af5b2f4452538caddc38ade9` y al nuevo motor de contactos.

- Suite completa final: **400/400 pruebas aprobadas**, cero fallos, omisiones o cancelaciones; compilación y comprobaciones de sintaxis correctas. Incluye el rechazo de acceso a las reservas físicas desde Administración y Tienda, una vez realmente iniciado el acoplamiento.
- Verificación integrada en navegador: **13 comprobaciones agrupadas, 29 capturas y cero errores JavaScript**, con datos temporales aislados y sin correo saliente.
- Cuatro perspectivas, cinco controles en la columna derecha, ocultación de instrumentos reversible y calidad alta fija incluso al recargar una antigua preferencia baja. Antialias, sombras 2048² y móvil con DPR 2 comprobados.
- Acabado limpio de color, rugosidad y normales; siluetas principales biseladas. Uniones de carreteras sin superficies coplanares duplicadas y letreros de tienda con separación física de 23 cm sobre su techo.
- Expedientes con situación, próxima acción, cantidades, controles registrados y mediciones con unidades; sin bloques de JSON. Temas claro/oscuro y móvil sin desbordamiento horizontal.
- Flujo completo: 12 cajas recibidas, 6 entregadas y 6 almacenadas, sin duplicación y con recursos liberados. La pausa conserva reloj, posición e inventario.
- Motor a 1/60 s con aceleración, frenado, giro acotado, contactos continuos y apoyos con gravedad. Se probaron entregas concurrentes, reserva del acceso, retorno, maniobras heredadas y retirada física para ceder paso. No se desactiva el contacto para atravesar otro camión.

Muestras nativas de esta revisión en **Apple M4 / ANGLE Metal**, calidad alta y sin suite pesada en paralelo:

| Fase | FPS dibujados | Respuestas de datos | Poses distintas relevantes |
|---|---:|---:|---:|
| Descarga | 52,57 | 11 | 105 de automatización |
| Identificación | 51,87 | 11 | 127 de automatización |
| Inspección | 52,22 | 11 | 145 de automatización |
| Transferencia a recepción | 56,39 | 23 | 155 de automatización |
| Entrega de buffer a AMR | 55,66 | 11 | 131 de carga |
| Preparación de cajas | 60,00 | 19 | 313 de automatización |
| Carga de camión | 55,01 | 12 | 172 de carga |
| Recepción de tienda | 60,00 | 15 | 253 de carga |

Preparación y tienda incluyen 1,5 y 1,2 s de sincronización inicial; las demás muestras incluyen su arranque. Mediana RAF de 16,7 ms y percentil 95 entre 17,1 y 18,0 ms. La pausa registró cero nuevos dibujos deliberadamente. Estas muestras **no acreditan 60 FPS constantes** ni rendimiento equivalente en todas las GPU. Los nueve atlas realmente instanciados en este recorrido ocuparon 6,25 MiB de buffers de píxeles, sin contar etiquetas, mipmaps ni memoria interna del controlador.

La prueba sobre una copia privada de la base existente verificó inicialización y tablas idénticas y, tras 300 s simulados, conservó 5 pedidos, 5 compras, 41 unidades de carga y 413 cajas totales. La entrega heredada de TRUCK-3 permaneció con sus 10 cajas y sin una recepción inventada. La copia temporal se cerró y eliminó; el original se abrió sólo en lectura.

Evidencias: `outputs/DonPepe-Mapa-Estilizado-2026-10-18/verificacion-mapa-estilizado.json`, `flujo/verificacion-mapa-autonomo.json` y `preservacion-fisica-existente.json`. Repetir la revisión con `node v2/scripts/verify-stylized-map.cjs`, `PLAYWRIGHT_MODULE`, `CHROME_EXECUTABLE` y `DONPEPE_NATIVE_GPU=1`. El verificador cierra el primer navegador antes de iniciar el recorrido completo para no compartir la GPU entre dos pruebas.

Alcance físico: cinemática guiada y contactos, no suspensión/neumáticos deformables ni certificación de seguridad industrial. Las animaciones no crean recepciones ni alteran saldos.

Activación local: servicio anterior detenido de forma ordenada, respaldo nuevo `DonPepe-Respaldo-Refinamiento-2026-10-18-29fhKD` con integridad SQLite correcta y comparación íntegra de las 10 tablas de identidad y 4 tablas de simulación antes de reiniciar. No se borraron tablas ni se recreó el escenario. El servicio actualizado en `http://127.0.0.1:3010` sirve exactamente el cliente verificado y responde correctamente a su comprobación de salud.

## Mapa del flujo autónomo y ampliación física · 18 de octubre

Nueva verificación en SQLite en memoria, servidor temporal y Chrome con GPU **Apple M4 / ANGLE Metal**. No se enviaron correos ni se ejecutaron compras o entregas sobre los datos del usuario.

- Suite completa final: **367 pruebas aprobadas**, cero fallos, omisiones o cancelaciones. Compilación del cliente correcta.
- **7 comprobaciones agrupadas, 15 capturas y cero errores JavaScript.** Cuatro cámaras, temas claro/oscuro, escritorio de 1440 × 1000 y móvil de 390 × 844 sin desbordamiento.
- Ocho activos automáticos con representación, selección, enfoque e inspector; anexo de recepción de 1.056 m².
- Proceso completo: 12 cajas recibidas, 6 entregadas en tienda y 6 restantes en el centro. Todos los recursos quedan liberados al terminar.
- No aparece simultáneamente la carga anunciada y su nueva HU. La transición de reconocimiento conserva posición; el desplazamiento máximo observado entre cuadros fue 0,269 m. La entrega del buffer al AMR registró un máximo de 0,188 m. Estos valores son de la prueba concreta, no tolerancias industriales certificadas.
- Pausa durante inspección: sin avance del reloj, sin desplazamiento de carga ni reconocimiento de inventario. Movimiento de brazo, cajas, montacargas y estación receptora observado independientemente de la frecuencia HTTP.
- Materiales compartidos con color, rugosidad y normales: 19,75 MiB de buffers de textura. No se regeneran texturas por cuadro.

Muestras de dibujo real en calidad alta, sin otras pruebas gráficas simultáneas:

| Fase | FPS medidos | Poses de automatización distintas | Respuestas de datos |
|---|---:|---:|---:|
| Descarga | 52,59 | 104 | 11 |
| Identificación | 52,71 | 128 | 11 |
| Inspección | 52,46 | 145 | 11 |
| Transferencia a recepción | 56,16 | 154 | 22 |
| Preparación de cajas | 60,00 | 313 | 19 |
| Recepción en tienda | 60,00 | 253 | 16 |

La carga del camión registró 55,32 FPS y 172 posiciones distintas de la carga, frente a 11 respuestas de datos. Las muestras de preparación y tienda incluyen 1,5 y 1,2 segundos de sincronización previa; las otras incluyen su arranque. La mediana RAF fue aproximadamente 16,7 ms y el percentil 95, 17,4–17,6 ms. No se afirma una tasa constante de 60 FPS en toda fase o equipo.

Evidencia: `outputs/DonPepe-Mapa-Autonomo-2026-10-18/verificacion-mapa-autonomo.json`, con huellas del cliente y motor comprobados. Repetir con `node v2/scripts/verify-autonomy-map.cjs`, `PLAYWRIGHT_MODULE` y `CHROME_EXECUTABLE`; el verificador crea su propio escenario aislado.

La instalación local utiliza `backup-data.cjs` y `apply-automation-map.cjs` con el servicio detenido. La segunda herramienta exige que el respaldo coincida con las bases actuales, ensaya primero sobre una copia privada y compara íntegramente los estados. Sólo permite el cambio aditivo `layout.automation`, sin alterar cuentas, reloj, productos, pedidos, existencias ni tablas transaccionales.

Instalación aplicada el 18 de octubre a las 08:27 PET: comparación íntegra aprobada antes y después; conservados 131 productos, 12 proveedores, 25 activos, 5 pedidos, 5 compras, 40 unidades de carga y 2 procesos autónomos. Las cuentas y las tablas transaccionales permanecieron idénticas. Evidencia: `preservacion-datos-reales.json` en la misma carpeta de resultados. Se creó un respaldo privado nuevo de ambas bases antes de aplicar el cambio.

## Datos maestros, solicitudes de tienda y experiencia de uso · 17 de octubre

La revisión amplía el catálogo y la consulta administrativa, reserva la creación de pedidos reales al perfil de tienda e incorpora solicitudes de simulación identificadas para Operaciones. Administración conserva el CRUD; Operaciones conserva compras y ejecución física. La migración del escenario enriquece únicamente las semillas antiguas sin personalización y conserva identificadores, cantidades, ubicaciones y registros modificados por el usuario.

- Suite completa integrada repetida: **213 pruebas aprobadas**, cero fallos. Incluye catálogo, migración, permisos por servidor, devolución en custodia, imágenes reales verificadas, carga de archivos, persistencia y movimiento del mapa.
- Verificación de interfaz: **13 comprobaciones agrupadas y 37 capturas**. Tres perfiles, temas claro y oscuro, 1440 y 390 píxeles, sin desbordamiento horizontal ni errores JavaScript. Doce fotografías y tres logotipos cargados desde recursos locales.
- CRUD de maestros: crear, editar, archivar y consultar archivados; rechazo de código comercial inválido y corrección del campo; filtros, búsqueda, estado vacío y exportación conservan contexto. Se corrigió un solapamiento del texto del producto con las columnas numéricas del resumen administrativo.
- Carga de imágenes: archivo inválido rechazado; vista previa que no publica todavía la foto; guardado bloqueado mientras queda una imagen pendiente; fallo HTTP 503 controlado conserva la foto vinculada; reintento y subida real a SQLite temporal con formato PNG de 768 píxeles comprobados.
- Tienda: portal y catálogo propios, cantidad incorrecta resaltada, recuperación de borrador, solicitud real pendiente y rechazo de sucursal ajena. Operaciones recibe esa solicitud, puede iniciar preparación y crea demanda ficticia únicamente mediante el comando de simulación; `order.create` desde Operaciones devuelve 403.
- Abastecimiento: el selector del proveedor ofrece sólo productos compatibles de su catálogo. La compra no crea existencias antes de recibir.
- Mapa: recursos e inspector recogidos al iniciar, desplazamiento WASD y detención al escribir, panel de recursos reversible y cámaras existentes conservadas.
- Revisión final dirigida de Administración: **6 comprobaciones y 2 capturas** adicionales. El error del código comercial aparece en el resumen de su formulario, no en el cuadro de subida de fotografías; hay una sola indicación por campo y el valor enfocado queda completamente visible debajo de la cabecera fija del diálogo.
- Flujo completo repetido con GPU Apple M4 / ANGLE Metal: **36 comprobaciones y 21 capturas**, cero errores JavaScript. La solicitud se crea con actor de tienda; Operaciones prepara y despacha. Se verificaron depósito del AGV, carga, avería, recuperación, plazas del remolque, cierre, viaje y recepción. Muestras sostenidas de montacargas y camión: 60,00 y 60,01 FPS; desde arranque, 58,00 y 55,31 FPS. Son muestras acotadas de este equipo, sin garantía universal.

Evidencia de interfaz: `outputs/DonPepe-Maestros-2026-10-17/verificacion-catalogo.json`; corrección dirigida: subcarpeta `targeted-admin/`; flujo físico: `flujo/verificacion-mapa-flujo.json`. Repetir con `node v2/scripts/verify-catalog.cjs`, usando las variables de Playwright/Chrome descritas abajo. Los datos y el buzón de estas pruebas son temporales; no se envían correos ni se utilizan cuentas personales.

La versión local se activó mediante reinicio ordenado del servidor del propio proyecto en localhost:3010. Antes se creó un respaldo consistente de ambas bases con la API de copia de SQLite. Después del arranque se comprobaron en lectura los tres usuarios, tres pedidos, una compra y 29 unidades de carga existentes: todos conservaron su identidad y el libro de balance no cambió. Las fotografías responden correctamente desde el servidor local. No se reinició el escenario ni se eliminaron datos.

Las quince mejoras de experiencia y la nueva separación del proceso están descritas en [RBAC-Y-MADUREZ.md](RBAC-Y-MADUREZ.md). La identidad y procedencia de los productos se documenta en [CATALOGO-FUENTES.md](CATALOGO-FUENTES.md).

## Revisión visual de la referencia audiovisual · 17 de octubre, 19:40 PET

Esta revisión reconstruye la arquitectura, encuadre, instrumentos superpuestos y animaciones de presentación de la referencia. No sustituye el flujo logístico. Se compararon las huellas SHA-256 de `core/engine.js` y `core/blueprint.js` con la verificación anterior: ambos archivos permanecen idénticos. No se modificaron datos personales ni se enviaron correos reales.

- Compilación y sintaxis correctas; suite completa repetida: **193/193 pruebas aprobadas**.
- Nuevo verificador de referencia: **12 comprobaciones y 16 capturas**, a 1250 × 720, 1440 × 1000 y 390 × 844, en temas claro y oscuro. Navegación conservada, buscador e inspector sincronizados con la selección, cuatro cámaras, etiquetas y controles utilizables, sin desbordamiento horizontal ni errores JavaScript.
- Corregidos durante la revisión: el menú móvil tapaba el buscador y una posición heredada del botón de acción ocultaba el título del seguimiento. Se comprobaron el título descubierto, su contraste mínimo de 4,5:1 y el menú debajo de la cabecera móvil.
- Acercamiento al camión medido: zoom 1,6 → 1,8728 a los 246 ms → 3,0999 a los 898 ms → 3,1. Se observaron 56 valores distintos de zoom y 56 fotogramas renderizados, manteniendo el encuadre oblicuo. En reposo no continúa el dibujo.
- Verificador completo de carga ejecutado nuevamente: **36 comprobaciones y 21 capturas**, sin errores JavaScript; depósito del AGV, puertas, montacargas con carga, pausa, avería, recuperación, plazas únicas del remolque, salida y recepción mantienen el balance de existencias.

Medición de esta revisión con calidad alta, Chrome y GPU **Apple M4 / ANGLE Metal**, sin otra prueba gráfica ejecutándose en paralelo:

| Tramo | Desde arranque | Sostenido tras 1 s de sincronización |
|---|---:|---:|
| Montacargas con carga a 5× | 57,84 FPS | 59,99 FPS |
| Camión en carretera | 55,63 FPS | 60,00 FPS |

La muestra sostenida del montacargas contiene 476 poses distintas y 479 fotogramas renderizados frente a 31 respuestas HTTP en aproximadamente ocho segundos. Mediana de intervalos RAF: 16,7 ms; percentil 95: 18,1 ms. El exterior inicial registra 123 llamadas de dibujo y 55.880 triángulos. Estas cifras corresponden al nuevo modelado y no deben confundirse con las de la revisión anterior, conservadas abajo. Son muestras acotadas, no una garantía universal de 60 FPS.

Evidencias: `outputs/DonPepe-Referencia-2026-10-17/verificacion-referencia.json` y `outputs/DonPepe-Referencia-2026-10-17/flujo/verificacion-mapa-flujo.json`. Ambos informes identifican el mismo cliente compilado. Las 48 comprobaciones de navegador y 37 capturas de esta revisión no sustituyen ni implican una nueva ejecución de los verificadores premium y de madurez anteriores.

Para repetir la revisión visual: `node v2/scripts/verify-reference.cjs`. Acepta `DONPEPE_NATIVE_GPU=1`, `PLAYWRIGHT_MODULE`, `CHROME_EXECUTABLE` y `DONPEPE_REFERENCE_QA_OUTPUT`. Para separar las capturas de flujo se utiliza `DONPEPE_MAP_QA_OUTPUT`. Los dos verificadores crean bases y servidores temporales aislados; deben ejecutarse por separado al medir rendimiento.

## Resultado de la revisión anterior de expedición física

- Compilación del cliente nueva: correcta.
- Suite completa final: **193 pruebas aprobadas**, cero fallos: 38 del motor, 8 de carga física y maniobra final, 27 de seguridad/API, 14 de geometría/interpolación/calidad, 7 de temas y 99 de regresión de la versión conservada.
- Navegador funcional: **51 comprobaciones aprobadas**, cero errores JavaScript capturados.
- 36 vistas de los tres perfiles revisadas a 1440 y 390 píxeles, sin desbordamiento horizontal. Además: formularios, cuatro cámaras, inspección y recorridos de recuperación. Se generaron 41 capturas.
- Revisión premium adicional: **109 comprobaciones aprobadas y 103 capturas**, con 72 combinaciones de vista/perfil/tema/tamaño a 1440 y 390 píxeles. Sin errores JavaScript, desbordamiento, mapas vacíos ni fallos en los muestreos de contraste de formularios críticos. Incluye 18 contextos de contraste calculado, fotos y controles de tema.
- Flujo gráfico final con GPU nativa: **36 comprobaciones y 21 capturas**. Incluye descenso del AGV alineado con su HU, acoplamiento, apertura/cierre gradual, avería con carga, horquillas, plazas del remolque, viaje y recepción. Total de los tres verificadores: **196 comprobaciones de integración y 165 capturas**, cero errores JavaScript capturados.
- Reloj real del servidor comprobado separadamente, sin navegador y con almacenamiento en memoria.
- Comprobaciones de sintaxis y diferencias de archivos: correctas.

## Recorridos comprobados

1. Compra de seis cajas, llegada, aceptación de cuatro, retención de dos y almacenamiento. Crear la compra no genera existencias antes de recibir.
2. Pedido seco/refrigerado: creación, reserva, misiones, avería, recuperación, consolidación, despacho y llegada. Autorizar inicia acoplamiento, apertura, carga física por montacargas, comprobación, cierre y retirada del muelle. La salida del camión no incrementa todavía las existencias de tienda.
3. Recepción en tienda, consumo explícito y devolución con regreso a cuarentena. Los saldos se conservan.
4. Límite visible y validación previa de 120 cajas por pedido.
5. Persistencia, repetición idempotente de operaciones y recuperación de una misión con carga después de reiniciar el proceso.
6. Cancelaciones, bloqueos, carga de batería, compatibilidad térmica y pedido mixto de doce productos.
7. Muestreo de separación entre centros de AMR durante la ejecución del pedido mixto; grafo sin tramos colineales superpuestos. No constituye validación industrial de seguridad.
8. Autenticación, protección CSRF, administrador único, correo duplicado, revocación de sesiones y denegación de acciones entre perfiles. Una tienda no recibe los datos de otras sucursales.
9. Cuatro cámaras del mapa, zoom, selección e inspector. Primer dibujo visible sin interacción con movimiento reducido; no mantiene un bucle continuo de dibujo en reposo.
10. Administración sin mapa ni acciones físicas; operaciones sin sidebar, mapa superior al 90 % del ancho; tienda sin acceso a otras sucursales.
11. CRUD por interfaz de cuentas, catálogos, permisos y configuración; revisión obsoleta rechazada con conflicto.
12. Gmail individual: verificación de propiedad, solicitud pública genérica, aprobación, entrega al buzón ficticio, cambio de contraseña, segundo uso del enlace rechazado y sesiones revocadas.
13. Límites inmutables por perfil, permisos aplicados inmediatamente, historial de cinco contraseñas, administrador único y recuperación excepcional a su Gmail ya verificado.
14. Retención de una preparación que perdió vida útil, retorno físico a cuarentena, baja documentada y buffers de estaciones sin exceso de capacidad.
15. Interpolación que sigue esquinas y cambios de misión sin inventar diagonales; palés ajustados a plataformas, posiciones de buffer sin solaparse y muelles fuera de carriles de AMR.
16. Tema inicial oscuro aplicado antes del primer pintado; preferencia persistida y sincronizada entre pestañas, estados accesibles de los botones y funcionamiento aun sin almacenamiento permitido.
17. Foto propia: archivo falso rechazado, decodificación real de píxeles, recorte acotado, subida, sustitución, eliminación, persistencia y lectura privada. Una imagen inválida no sustituye la anterior. CSRF y permisos se aplican también a estas rutas.
18. Movimiento esencial suavizado aun con “reducir movimiento”; reloj de reproducción que no retrocede al ajustar latencia y corrección independiente de la tasa de cuadros.
19. Cada HU de expedición conserva su portador: plaza de espera, montacargas, plaza única del camión y tránsito. Puertas cerradas y carga íntegra antes de salir. Dos pedidos no pueden ocupar el mismo muelle o vehículo.
20. Avería, batería insuficiente, compatibilidad térmica, capacidad y doble despacho se rechazan sin reservas parciales. Una retención de calidad durante la carga permite descargar físicamente antes de ir a cuarentena.
21. El AGV entra a su plaza de expedición mediante tramos ortogonales, baja gradualmente la plataforma y se retira antes de liberar la maniobra. Avería y reinicio durante el depósito conservan carga y bloqueos.
22. Historial de poses acotado en memoria, exclusivo del permiso de mapa y ausente del agregado SQLite. El cliente descarta respuestas de revisiones anteriores para no rebobinar vehículos cuando se cruzan una consulta y un comando.
23. Copia temporal de la simulación existente: se verificaron 2 pedidos, 28 unidades de carga, 360 cajas y 92 ubicaciones conservados tras migrar y comprobar invariantes. El original se abrió sólo en lectura; no se probó sobre una base personal en escritura. Evidencia: `migracion-existente.json`.

## Comprobación del renderizado

Se comprobó la aplicación integrada, no sólo la escena aislada: primer montaje sin interacción, escena no vacía y sin cuadros adicionales en reposo. Reaplicar tres veces la misma calidad no borraba el mapa y producía sólo los dos pintados acotados de preparación. El cambio de tema modifica los instrumentos y conserva el diorama luminoso y sus geometrías.

La comprobación detectó y corrigió dos causas concretas: `setPixelRatio` de Three.js borraba el lienzo aun con el mismo valor, y la mezcla del primer render síncrono con timestamps de RAF podía dar intervalos negativos. Se eliminó el reajuste redundante, se pide un pintado al cambiar calidad/tema y se utiliza un reloj monotónico. No se activó `preserveDrawingBuffer` ni un bucle permanente para ocultar el fallo.

La revisión de vistas y contraste emplea SwiftShader, una GPU de software. Además se habilitó una ejecución separada sin forzar ese renderizador y se confirmó mediante WebGL que Chrome usa **ANGLE Metal / Apple M4**. Los reportes separan intervalos de callbacks RAF, fotogramas realmente renderizados, poses distintas y cantidad de respuestas HTTP: tener 60 callbacks no prueba por sí solo que el equipo se haya movido 60 veces.

El exterior completo pasó de 195 a **114 llamadas de dibujo**, manteniendo **42.634 triángulos** y sin eliminar su detalle visible. En la medición nativa de zoom se registró una mediana de **16,7 ms** y percentil 95 de **17,7 ms**. Los períodos de zoom incluyen el reposo posterior al acercamiento: al terminar de moverse la cámara no se siguen dibujando cuadros para inflar un contador.

Medición final separada del flujo activo, con calidad alta, Chrome y Apple M4/Metal:

| Tramo medido | Desde arranque | Con sincronización inicial completada |
|---|---:|---:|
| Montacargas con carga a 5× | 58,11 FPS | 60,01 FPS |
| Camión en carretera | 55,96 FPS | 59,97 FPS |

La segunda muestra se mide después de un segundo de precarga, no reemplaza ni oculta la primera. En la carga sostenida se observaron **477 poses distintas frente a 31 respuestas HTTP**: el movimiento no avanza una imagen por consulta. La mediana RAF fue de 16,7 ms y el percentil 95, aproximadamente 18 ms. Son muestras acotadas, no una prueba prolongada bajo toda combinación de carga, resolución o equipo. Ninguna medición acredita 60 FPS constantes en todos los equipos o condiciones.

## Repetir

Desde la carpeta principal del proyecto:

```sh
npm run build:v2
npm test
```

Los verificadores actuales son `v2/scripts/verify-maturity.cjs` (recorridos funcionales), `v2/scripts/verify-premium.cjs` (temas, tamaños, contraste, mapa y foto) y `v2/scripts/verify-map-flow.cjs` (carga física, poses visuales, cámaras y rendimiento). Requieren Playwright y Chrome. Aceptan `PLAYWRIGHT_MODULE` y `CHROME_EXECUTABLE`. Para medir el motor nativo, el último acepta `DONPEPE_NATIVE_GPU=1`; sin ello fuerza SwiftShader. Crean bases temporales, usan un servidor local aislado y un buzón ficticio y cierran sus propios recursos al terminar. Las pruebas de seguridad también requieren permitir servidores locales temporales.

Las capturas e informes de esta actualización están en `outputs/DonPepe-Mapa-2026-10-17/`, junto a la carpeta del proyecto. Incluyen `ui/report.json`, `madurez/report.json` y `verificacion-mapa-flujo.json`. Se conservan las entregas históricas, incluida `DonPepe-Premium-2026-10-17`. Son capturas de la aplicación ejecutada, no propuestas gráficas. La foto de ejemplo de las pruebas es un patrón de color, no la imagen de una persona ficticia atribuida al usuario.

## Lo que estas pruebas no acreditan

No se verificó un despliegue público ni una compilación Docker. La recuperación fue probada con correo simulado, no con envío SMTP real. No se probaron robots físicos, TPV, ERP, PLC, sensores o servicios de Mecalux porque no están conectados. No hay prueba de carga multiusuario industrial, certificación de cadena de frío o seguridad de maquinaria. La persistencia logística es un agregado SQLite para un único proceso de simulación, no una base empresarial normalizada. La calidad alta fija no garantiza una tasa constante de fotogramas en todos los equipos.

Los accesos iniciales son públicos de demostración y el servidor escucha en localhost. Esta entrega no debe publicarse sin reemplazar esas credenciales y revisar su seguridad y operación.
