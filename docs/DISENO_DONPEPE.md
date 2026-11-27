# Diseño DonPepe y verificación

## Alcance

Adaptación visual del documento Lumen Ink a la marca DonPepe, sin incorporar el negocio del ejemplo. Se conservan las tablas de inventario y procedimientos WMS. La ampliación posterior incorpora roles personalizados y correo personal verificado, documentados en `RBAC.md`. No se borra ni se resiembra el inventario.

`public/css/tokens.css` concentra los colores, radios, sombras y tiempos. `public/css/lumen.css` adapta los componentes existentes y `public/css/role-access.css` cierra la compatibilidad con las vistas anteriores, después de todas las hojas de cada pantalla. Administrador: tinta violeta oscura; jefe de operaciones: superficies claras con acento violeta; operador RF: superficies claras de alto contraste. Cada estado comparte un par de color de texto y fondo, no un color aislado. La selección y el foco indican estado; las tarjetas de datos no utilizan vidrio. Las ventanas flotantes y el acceso sí.

Tipografías locales: Geist, Bricolage Grotesque y Geist Mono; licencias OFL en `public/fonts`. No se necesitan servidores de fuentes externos. El arte final elegido por el usuario el 17 de octubre de 2026 combina el retrato lineal a la izquierda y DONPEPE a la derecha, ambos dorados. `public/images/donpepe-logo-final-gold.png` conserva esa composición con transparencia y sin el margen blanco sobrante. `views/partials/brandLogo.ejs` y `public/css/brand.css` centralizan su presentación: una única imagen dorada, sin filtros de recoloración. En superficies claras del jefe y RF se utiliza soporte morado oscuro; en acceso y administración oscuros, fondo transparente. El sidebar aprovecha casi todo el ancho de su cabecera sin cambiar los enlaces ni la anchura del menú. Las etiquetas e iconos de pestaña usan el mismo arte final. Los archivos antiguos quedan sin consumidores activos como respaldo histórico.

## Marca final — 17 de octubre de 2026

El PNG final se aplica al acceso/recuperación, sidebar, cabecera móvil, RF, etiqueta de lote e iconos de pestaña. `tests/brand.test.js` verifica recurso, accesibilidad, composición compartida y soporte de contraste sin cargar la aplicación ni conectarse a la BD. `scripts/verify-brand.js` renderiza fixtures aislados con los componentes reales: 10 estados de escritorio/móvil, sin desbordes, filtros heredados ni recortes del logo; también comprueba un ancho visible mínimo de 240 px en el sidebar de escritorio. Para repetirlo se requiere Playwright; `PLAYWRIGHT_MODULE`, `CHROME_EXECUTABLE` y `VERIFY_OUTPUT` permiten usar un navegador local ya disponible. No inicia sesión ni envía formularios. Se compilaron las 62 plantillas EJS y pasaron las 12 pruebas de marca y sistema visual. Esto verifica la integración visual, no certifica todos los procesos WMS ni conexiones con las sucursales.

## Mapa

Se mantienen 15 zonas y 2412 direcciones CD1. Los módulos se alinean longitudinalmente en cada pasillo; los casilleros siguen el módulo y el doble fondo es transversal. Las posiciones planificadas se calculan en `config/warehouseBlueprint.js`; las coordenadas verificadas físicamente se respetan. No se sustituyen IDs, códigos ni relaciones con el inventario.

Racks: postes azules, travesaños naranja, bandejas metálicas, diagonales y protecciones amarillas. Palés: tablillas y apoyos. Las cajas solo aparecen en ubicaciones que contienen stock real. Varias cajas de una misma carga ilustran la HU y llevan al inspector de esa LOC; no constituyen nuevas HUs ni cantidades de stock. Cámaras frías: paredes, paso de acceso y unidades de refrigeración; techo oculto en planta y visible en modo pasillo.

Geometrías y materiales compartidos, estructuras/cajas instanciadas y renderizado bajo demanda. El zoom se interpola por tiempo; el raycasting de hover se suspende durante navegación y se limita a una consulta cada 90 ms en reposo. El acabado de alta calidad usa reflejos PMREM, sombras suaves de 4096 px que se recalculan al cambiar la escena/perspectiva y resolución hasta DPR 2. No mantiene una actualización de sombras constante. El encuadre se ajusta a las ocho esquinas proyectadas para mostrar toda la nave en planta. No hay modelos externos pesados. El plano es planificado y no certifica medidas ni tránsito físico del edificio.

Los acabados están en `frontend/warehouse-materials.js`: losas epóxicas con juntas y rugosidad; paneles con uniones/remaches; paredes térmicas; chapa corrugada; madera con vetas y cartón fibroso, cinta y señalética. Texturas originales de 1024 × 1024, normales derivadas de altura en espacio lineal y albedo sRGB. UV en metros evitan estirar una imagen sobre la pared. Los racks incluyen perforaciones, conectores, placas y anclajes; los palés tienen tablillas, bloques y patines; los muelles portones elevados, topes, defensas y señales de entrada/salida. Las cámaras tienen puertas térmicas deslizantes. La cubierta curva suma 128 triángulos; los LED no añaden una luz por objeto. La envolvente superior se oculta en planta y aparece en pasillo; rótulos con oclusión en perspectiva.

La nueva capa interactiva corrige el resumen de stock al seleccionar origen y el menú de perfil abierto. El sidebar guarda su scroll por cuenta durante la sesión de navegador, también al seguir enlaces y regresar. Los campos inválidos muestran feedback junto a ellos; las confirmaciones son diálogos accesibles con Cancelar, Escape, foco contenido y retorno de foco. Los envíos indican procesamiento y bloquean doble submit; avisos y navegación utilizan micro-interacciones con `prefers-reduced-motion`.

## Escaneo y etiquetas

`frontend/scanner.js` comparte el lector entre formularios y RF. Usa BarcodeDetector cuando incluye QR/EAN y ZXing en plataformas sin soporte suficiente. Permite elegir cámaras enumeradas por el navegador, incluida Cámara de Continuidad **si macOS la expone**. Detiene los tracks tras leer, al cambiar de cámara o al salir. Requiere HTTPS o localhost; una IP HTTP de la red local no habilita cámaras en iPhone.

El flujo es: leer → resolver LOC/SKU/lote/HU/tarea en el servidor → revisar resultado → confirmar → rellenar. Un código inexistente no rellena un campo; recepción permite confirmar un lote nuevo del fabricante dentro de su línea de producto. Se verifica que SKU/EAN de una etiqueta estructurada corresponda a la línea. JSON y etiquetas `SKU=...|LOT=...|EXP=...` comparten el parser de servidor y navegador.

Los QR se generan localmente con `qrcode`; se retiró el dibujo de imitación que no podía decodificarse. Se utiliza zona silenciosa de cuatro módulos y corrección M. No dependen de un CDN. Los códigos de barra de la textura de cajas 3D son referencias gráficas; no sustituyen las etiquetas reales imprimibles.

## Usuarios

La edición fallaba por cadenas JavaScript con saltos de línea dentro de comillas en EJS. Se corrigió la plantilla y se devuelve 404 para cuentas inexistentes y 422 para IDs inválidos. No se exponen contraseñas ni hashes; la sustitución segura y la política de historial siguen vigentes. La recuperación continúa bajo aprobación del administrador y entrega SMTP ya configurada. La verificación visual no envía correos ni cambia contraseñas.

## Compilación y pruebas

```sh
npm ci
npm run build
npm test
docker compose up -d --build
```

La compilación genera `public/js/warehouse-map.js` y `public/js/scanner.js`. Docker compila ambos también; no se requiere ejecutar compiladores en el navegador.

`scripts/smoke-ui.js` verifica con Playwright: acceso/recuperación móvil, edición de todos los usuarios del directorio, 404/422, mapa en ambas vistas, generación/decodificación QR, EAN-13 y confirmación antes de aplicar un registro. Variables opcionales: `VERIFY_URL`, `VERIFY_ADMIN_EMAIL`, `VERIFY_ADMIN_PASSWORD`, `PLAYWRIGHT_MODULE`, `CHROME_EXECUTABLE`, `VERIFY_OUTPUT`. Si las credenciales iniciales cambiaron, proporcionar las vigentes mediante variables de entorno. No realiza altas, cambios de claves ni movimientos de stock.

Las pruebas automatizadas de cámara usan streams simulados para validar detención y ausencia de duplicados; no prueban el hardware del usuario. La cámara física, Safari en iPhone y continuidad necesitan una prueba final en ese dispositivo con sus permisos.

## Auditoría visual de todas las pantallas

`scripts/audit-visual.js` recorre los tres roles y el acceso anónimo, incluyendo altas/edición, catálogos, compras, logística, inventario, reportes, seguridad, errores, RF y ventanas de selección, QR, ayuda y escáner. Renderiza estados posteriores a formularios con fixtures locales para no ejecutar operaciones reales. Las credenciales efímeras y las sesiones en memoria existen solo dentro del proceso de verificación; no se cambian las cuentas de MySQL.

Genera capturas y un reporte de contraste calculado, desbordes, errores JavaScript y tiempos entre cuadros durante zoom en Chromium. El cálculo automatizado de contraste es una comprobación orientativa de estilos, no una certificación de accesibilidad ni una garantía de rendimiento para todo dispositivo. La revisión manual de capturas complementa ese reporte. `tests/visual-system.test.js` protege la geometría ligera, escala física de texturas, iconos válidos, disponibilidad de imágenes y hojas de estilos compartidas. Una imagen de referencia ausente se identifica como no disponible; no se reemplaza por una fotografía genérica presentada como el producto o proveedor real.

Ejemplo de ejecución con MySQL publicado localmente y Playwright instalado:

```sh
DB_HOST=127.0.0.1 DB_PORT=3307 node scripts/audit-visual.js
```

También admite `PLAYWRIGHT_MODULE`, `CHROME_EXECUTABLE` y `VERIFY_OUTPUT`. No envía correos, crea registros ni mueve inventario.

## Resultado de verificación — 5 de octubre de 2026

- 89 pruebas automatizadas aprobadas, incluidas las barreras de permisos, el destinatario personal de recuperación, la verificación de correo y la protección de cuentas bloqueadas.
- 48 vistas renderizadas y 138 pantallas/estados revisados en Chromium: sin errores JavaScript, desbordes horizontales ni incidencias en la comprobación automatizada de contraste. Incluye menús de perfil abiertos, selección de origen/destino, roles, confirmaciones, errores, ayuda, QR y versiones móviles.
- En MySQL se comprobó el rechazo de un segundo administrador y la creación/edición/revocación de permisos de un rol personalizado. Las operaciones de prueba se revirtieron; no quedaron roles ni usuarios nuevos.
- La entrega SMTP se validó con simulaciones, sin enviar mensajes reales. La cámara física y Safari/iPhone no se certifican con esta auditoría de Chromium.
# Experiencia operativa · 17 de octubre de 2026

La torre del jefe de operaciones incorpora una red logística 3D: centro de distribución, muelles, calles, sucursales y vehículos vinculados a documentos existentes. Los paneles consultan `GET /wms/red/datos`, protegido por el permiso de consulta WMS. No se conecta a GPS ni infiere entregas, ubicaciones geográficas, velocidades o tiempos reales. La posición de una sucursal es esquemática. Solo los pedidos despachados pueden reproducir un recorrido; la reproducción nunca modifica inventario ni el estado del pedido. El mapa interior sigue disponible en una pestaña separada.

La planificación libre tiene tres pasos: intención, producto/posición y confirmación. Las direcciones exactas se mantienen en el detalle de trazabilidad; no se eliminan sus IDs ni validaciones. La capacidad de un casillero se interpreta en plazas logísticas, no como límite de una unidad comercial. Se puede seleccionar operador al crear el movimiento o al preparar un pedido de sucursal: creación y asignación comparten una transacción y vuelven a verificar los permisos de ambas personas.

Compras y pedidos de sucursal utilizan pasos progresivos con revisión previa. Los pedidos no arrancan con una nueva compra: solicitan mercancía del inventario existente. Las reservas abiertas se descuentan de la disponibilidad mostrada. El vencimiento se excluye de los cálculos de reposición para los productos sujetos a control.

La estación RF tiene bandejas y confirmación secuencial de ubicación origen, carga y destino. Los identificadores se rellenan con cámara tras revisar la lectura; no se ofrecen entradas manuales de códigos. Cantidades, fechas y observaciones siguen siendo datos de captura. Para un producto controlado por lote, el servidor exige identificar el lote o la HU asignada: su EAN aislado no acredita el lote. Los embalajes sin etiqueta legible por máquina necesitan etiquetado previo; esta implementación no incorpora OCR.

La verificación utiliza fixtures aislados sin cargar la aplicación ni escribir en la base operativa: `scripts/verify-control-center.js` revisa escritorio, tableta, móvil y envío de formularios; `scripts/verify-rf-experience.js` simula la cámara y errores de lectura/permisos. Los ensayos de navegador no prueban el hardware real, una ruta real ni integraciones comerciales. No se implementó recepción en tienda ni telemetría; el último estado operativo de salida continúa siendo `DESPACHADO`.

