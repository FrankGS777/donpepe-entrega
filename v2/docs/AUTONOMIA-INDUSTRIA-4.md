# DonPepe: autonomía logística e Industria 4.0

Investigación y decisión de arquitectura: 18 de octubre de 2026. Alcance de esta reforma: lógica, entidades, evidencias, configuración y estados; no rediseña ni certifica las animaciones del mapa.

## 1. Qué significa autonomía en este proyecto

Industria 4.0 no consiste sólo en dibujar robots: exige conectar información del negocio, identificación de cargas, disponibilidad de equipos, decisiones, ejecución y evidencia del resultado. DonPepe adopta una operación normal sin tareas físicas asignadas a personas: Operaciones autoriza/inicia procesos y supervisa excepciones; el coordinador ejecuta sus etapas. Administración configura capacidades, permisos, conservación y políticas, pero no mueve existencias ni suplanta controles.

La aplicación ejecuta dispositivos y socios simulados. No se conecta a camiones, PLC, balanzas o lectores reales. Una autorización humana no equivale a una lectura de sensor. La autonomía tampoco significa continuar ante cualquier avería: si falta identificación, capacidad, seguridad o evidencia, el proceso espera o queda retenido, conservando la carga y el motivo.

La circulación autónoma de camiones por calles públicas de Lima es una hipótesis del escenario académico, no una capacidad demostrada por este software ni una conclusión de las fuentes de intralogística. Tampoco se afirma que un almacén real pueda prescindir universalmente de mantenimiento, emergencias, inspecciones sanitarias o responsabilidades legales.

Como referencia de interoperabilidad industrial, **OPC UA** define intercambio de información modelada y comunicación segura entre sistemas y dispositivos; no es sinónimo de una animación o una etiqueta “IoT”. La ficha digital estandarizada de un activo puede representarse con una **Asset Administration Shell (AAS)**. Este proyecto no implementa esos protocolos/metamodelos: su inventario de equipos, capacidades y evidencias constituye un modelo propio preparado para una integración futura, no un producto certificado Industria 4.0. [OPC Foundation, arquitectura oficial](https://opcfoundation.org/about/opc-technologies/opc-ua/) y [especificación AAS de IDTA](https://industrialdigitaltwin.io/aas-specifications/IDTA-01001/v3.1/preamble.html).

## 2. Base oficial y diferencias con una copia literal

### Software: tres responsabilidades distintas

- **WMS / SGA**: sistema de gestión de almacenes. Mantiene productos, lotes, existencias, disponibilidad, ubicaciones y documentos.
- **WES**: sistema de ejecución. Prioriza trabajos y asigna recursos disponibles para cumplir las órdenes de negocio. Mecalux integra estas funciones en Easy WMS. [Fuente oficial Easy WES](https://www.mecalux.es/software/wes-sistema-ejecucion-almacenes).
- **WCS**: sistema de control. Coordina movimientos y equipos automáticos y comunica su ejecución. [Fuente oficial Easy WCS](https://www.mecalux.es/software/wcs-sistema-control-almacenes).

DonPepe implementa responsabilidades análogas dentro de un solo motor; no instala ni licencia software de Mecalux. El negocio autoriza una recepción o expedición; el coordinador decide cuándo puede avanzar; los dispositivos aportan observaciones; las misiones existentes realizan el movimiento físico modelado. El mapa será consumidor del estado, no la autoridad del inventario.

### Caso alimentario real utilizado como contraste

El caso de **Logiscor / Supermercados Piedra** describe un operador que abastece 60 tiendas, utiliza avisos ASN y Easy WMS y combina almacén automático de cajas, Pallet Shuttle semiautomático y puestos de picking. La propia publicación menciona operarios y tabletas: es referencia de integración, no prueba de que cualquier supermercado opere sin personas. DonPepe extiende su flujo normal a células robóticas simuladas, sin atribuir esa extensión a dicho cliente. [Caso oficial Mecalux](https://www.mecalux.es/casos-practicos/logiscor-almacen-automatico).

## 3. Identidades que no se deben confundir

| Identidad | Qué identifica | Ejemplo y regla |
| --- | --- | --- |
| SKU | Artículo del catálogo interno | Un yogur de una presentación concreta; no es una caja física |
| GTIN | Referencia comercial estándar | La lectura de un EAN/UPC identifica el producto, no revela por sí sola lote ni caducidad |
| Lote del fabricante | Agrupación de fabricación | Se conserva exactamente junto al producto y vencimiento; no se reemplaza por el código de recepción |
| HU / unidad de carga | Carga física manejable por un equipo | Una carga puede contener varias cajas; no se confunde con el lote ni con una ubicación |
| SSCC | Unidad logística identificada de forma única | Vincula una etiqueta logística con el contenido anunciado; no es el número de lote |
| ASN / aviso anticipado de expedición | Documento de lo que el proveedor anuncia enviar | Relaciona compra, unidades logísticas y contenido esperado; no aumenta existencias |
| LOC | Posición física del almacén | Almacén/zona/pasillo/rack/nivel/casillero/profundidad; puede estar libre u ocupada |
| Evento de evidencia | Observación o resultado de una etapa | Quién/dispositivo, qué carga, cuándo, dónde y qué se observó; no es una existencia nueva |

La [guía oficial de etiqueta logística GS1](https://www.gs1.org/standards/gs1-logistic-label-guideline/1-3) relaciona SSCC y contenido con el ASN. Los identificadores de aplicación permiten expresar lote `(10)` y caducidad `(17)` cuando la etiqueta y el emisor los suministran. Un SSCC requiere datos asociados; no permite adivinar el contenido. Los códigos EAN/UPC tradicionales no transportan esos atributos de lote. [Estándar de trazabilidad GS1](https://www.gs1.org/standards/gs1-global-traceability-standard/current-standard).

RFID es un medio de identificación por radio, no una inspección de calidad. Un arco no descubre cajas sin etiqueta ni deriva una caducidad inexistente. En el escenario, la información proviene de un aviso estructurado y de observaciones de dispositivos identificados. Los identificadores simulados no representan una asignación comercial oficial de GS1 a DonPepe.

## 4. Infraestructura lógica para la recepción automática

El flujo normal necesita una célula completa, no sólo más AMR:

1. **Intercambio con el proveedor**: aviso anticipado de cargas, referencias, lotes, vencimientos y cantidades.
2. **Control del muelle**: reserva exclusiva, compatibilidad del vehículo, acople, alineación y zona segura.
3. **Descarga automática**: equipo compatible con la carga y la interfaz del remolque. Lleva las cargas al punto de entrada; no las hace aparecer directamente en el rack.
4. **Auto-ID**: lector de etiqueta logística o identificador que coteja la unidad con lo anunciado.
5. **Puesto de inspección de entrada (PIE)**: control de dimensiones, peso y aptitud del soporte para circular por la instalación; puede incorporar cámaras y sensores.
6. **Control de conservación**: observación de temperatura, validación del rango configurado y vida útil mínima del producto.
7. **Retención y almacenamiento**: carga aceptada hacia almacenamiento; discrepancias retenidas en la célula antes de su aceptación. La cuarentena de existencias ya recibidas sigue utilizando sus ubicaciones y misiones compatibles, sin afirmar un traslado nuevo que todavía no se ha realizado.

Mecalux describe el PIE como control de gálibo y estado del palé, ligado a etiqueta y SGA. No demuestra inocuidad microbiológica del alimento ni detecta cualquier defecto oculto. DonPepe registra una **decisión logística de aceptación**, no un certificado sanitario. [PIE de Mecalux](https://www.mecalux.es/manual-almacen/palets/pie-sistemas-galibo-palets).

Joloda distingue sistemas automáticos para circuitos con remolques dedicados y alternativas para remolques no modificados; por ello no se debe aceptar cualquier camión sin perfil compatible. [Soluciones oficiales de carga y descarga](https://www.joloda.com/automation/solutions/). Sus mecanismos de seguridad incluyen retención del remolque, comprobación de alineación y sensores. La fuente también describe variantes con intervención del conductor: no es una certificación de una célula desatendida DonPepe. [Seguridad de muelles, fabricante](https://www.joloda.com/en/news/four-ways-to-improve-safety-in-the-loading-bay-with-automation-transforming-working-practices-to-protect-your-staff-and-business/).

## 5. Flujo de proveedor: autorización, evidencia y existencias

1. Operaciones solicita un surtido a un proveedor elegible. Quedan fijadas las líneas, las cantidades y la compra.
2. El socio simulado prepara su aviso de expedición y unidades logísticas. Conserva lote y vencimiento declarados por el fabricante; no los inventa una cámara.
3. La llegada no crea stock disponible. El proceso espera una célula activa, compatible y libre.
4. La descarga sólo avanza con sus precondiciones de seguridad. Un bloqueo conserva proceso, reservas y carga.
5. Las observaciones comparan identidad y contenido con la compra/aviso. El control posterior evalúa embalaje, identificación, vida útil, conservación y tolerancias configuradas.
6. Se crea una recepción única a partir del expediente vigente. Una carga que falla los controles permanece identificada en el aviso y retenida por una excepción, sin recibo de aceptación ni existencias disponibles. No se dice que un robot la trasladó a cuarentena si no existe una misión de ese traslado. Las cuarentenas físicas previamente contabilizadas conservan su flujo y posiciones.
7. El WMS asigna una ubicación compatible; el WES espera o asigna equipos; las misiones de transporte/almacenamiento existentes completan el recorrido.
8. El kardex registra sólo los cambios físicos realmente confirmados en el estado. El proceso termina cuando todas sus cargas alcanzan un destino terminal válido, no cuando se dispara una animación.

No se añade un operario RF ni un rol de recepcionista. Operaciones no transcribe en el flujo normal lotes, caducidades o conteos para simular la salida de sensores; consulta el expediente y resuelve excepciones dentro de sus permisos.

## 6. Flujo de tiendas y camiones

La infraestructura añadida comprende ocho activos: descargador del CD, portal Auto-ID, PIE, transportador de entrada, célula robótica de cajas cerradas y una estación receptora en cada una de las tres sucursales actuales. Se conservan los diecisiete equipos anteriores: el catálogo pasa a veinticinco activos. La preparación de cajas ya no depende de una estación abstracta sin equipo: la célula reserva la carga, selecciona las cajas cerradas solicitadas, aplica su etiqueta interna y conserva la relación con la carga y lote de origen. No abre alimentos ni realiza un reenvasado sanitario.

Mecalux publica una solución de [picking robotizado](https://www.mecalux.es/almacenes-automaticos/robot-picking) basada en visión, brazo y agarre para trasladar artículos entre cajas. Es una referencia de coordinación, no la especificación literal de la célula de cajas cerradas de DonPepe; su carga, dimensiones, cadencia y compatibilidad son parámetros del modelo propio, no prestaciones atribuidas al fabricante.

Las duraciones globales de descarga, inspección y transferencia son ciclos mínimos de coordinación. Se respeta el mayor entre ese mínimo y el ciclo efectivo del equipo; una política no fuerza a una máquina a funcionar más rápido que su configuración. Cada autorización conserva su política. Los reintentos máximos limitan reevaluaciones expresamente autorizadas, no ciclos infinitos de aceptación. Los lectores validan su plazo de adquisición y se eliminan ajustes decorativos que todavía no tengan una función implementada.

La tienda origina la necesidad de reposición. Operaciones autoriza su preparación; la asignación, recogida, consolidación, disponibilidad de vehículo, carga y transporte son coordinadas por el motor. Un vehículo no se asigna simultáneamente a dos expediciones y no sale con cargas aún no verificadas.

Para eliminar la confirmación manual del flujo normal en destino se requiere una **célula receptora de tienda** y un **acuse electrónico de recepción**. En este proyecto se modelan como dispositivos y evidencias simuladas asociados a la sucursal. La llegada por sí sola no cierra la entrega: se cotejan el manifiesto y las cajas efectivamente recibidas. Sólo el acuse positivo y la descarga completada permiten el retorno. Una diferencia conserva trazabilidad y no convierte el faltante en existencias.

No se toma como prueba de entrega la posición GPS, la orden de despachar ni el fin de una animación. Tampoco se liberan camiones históricos ocupados de forma silenciosa: los documentos anteriores a esta reforma requieren adopción explícita por Operaciones. Los nuevos procesos usan la política autónoma desde su inicio.

## 7. Entidades de coordinación y contrato de lectura

El estado operativo expone `autonomy` con versión, modo y configuración. El modo `SIMULATED` describe el origen real de la ejecución, no un adaptador IoT físico.

| Entidad | Responsabilidad y datos relevantes |
| --- | --- |
| Configuración de autonomía | Políticas, capacidades habilitadas y revisión; edición administrativa con control de concurrencia |
| Trabajo de coordinación | `kind`, documento, estado/etapa, revisión, progreso, autorización, carga/evidencia y motivo de espera |
| Aviso de expedición | Compra/proveedor y lista de cargas: SSCC, línea, producto, código, lote, vencimiento, cajas |
| Evidencia de dispositivo | Trabajo/documento/carga, dispositivo, punto de control, fecha, contenido, decisión y origen |
| Excepción | Código, explicación, estado, fechas y resolución razonada; no equivale a una aprobación de stock |
| Candidato heredado | Documento anterior que aún no está gobernado por un trabajo autónomo; requiere adopción explícita |
| Equipo y capacidad | Activo, condición operativa, compatibilidad, configuración y mantenimiento; su nombre no sustituye una capacidad efectiva |
| Acuse de tienda | Evidencia asociada a la sucursal y entrega que habilita cierre y retorno, no un clic de Operaciones en nombre de la tienda |

Los controles de negocio son `autonomy.authorize` y `autonomy.retry` para Operaciones, y `config.autonomy.update` para Administración. Autorizar adopta/inicia un proceso; reintentar comprueba otra vez sus condiciones, no permite alterar arbitrariamente una decisión, inventar lecturas o saltar una retención. Los dispositivos se ejecutan dentro del motor: no se expone una ruta pública sin autenticación para registrar telemetría ficticia.

## 8. Invariantes y tratamiento de excepciones

- Una compra o pedido tiene como máximo un trabajo activo por proceso; una repetición idempotente no duplica ni trabajos ni existencias.
- Autorizar, anunciar, reservar o escanear no son entradas físicas al inventario.
- El mismo lote puede ocupar varias unidades y posiciones. Una separación de carga conserva su genealogía.
- Una identidad duplicada, desconocida o de otra compra no se acepta por aproximación textual.
- La revisión del documento se vuelve a comprobar; una inspección antigua no confirma un pendiente modificado.
- Falta de capacidad, equipo deshabilitado, avería, mantenimiento o incompatibilidad producen espera con motivo; no teleportan cargas ni borran reservas de trabajo activo.
- Daño, falta de identificación, vencimiento o conservación incompatible producen retención, no una aprobación automática por tiempo transcurrido.
- Un reintento exige motivo y revisión vigente. Se conserva la evidencia anterior y el nuevo resultado; no se borra el incidente para aparentar éxito.
- Reiniciar la aplicación conserva etapa y evidencias. Retomar no repite una recepción ya contabilizada.
- Una compra cancelada no puede empezar una descarga posterior. Un proceso iniciado no se cancela borrando carga en tránsito.
- Administración configura y consulta; no ejecuta movimientos. Tienda sólo consulta/actúa en su sucursal. No se añaden usuarios ni nuevos roles operativos.
- Las condiciones de parada segura no se desactivan para cumplir un plazo. No hay interruptor de “liberar camión” que abandone una carga.

Para una futura conexión física se necesitarán además identidad y credenciales por dispositivo, autenticación mutua, secuencias/eventos únicos, tiempos de observación y caducidad de lecturas, persistencia de mensajes, reconciliación tras desconexión y evaluación de seguridad industrial. No basta con añadir un campo MQTT o un número de serie al formulario.

## 9. Trazabilidad y relación con EPCIS

GS1 EPCIS define eventos interoperables para describir qué ocurrió, cuándo, dónde, por qué y cómo, y admite contexto de sensores y agregación de unidades. Sirve como referencia para separar evidencia, documento e inventario. [EPCIS y CBV, GS1](https://www.gs1.org/standards/epcis).

DonPepe conserva identificadores, tiempos, relación con documento/carga/dispositivo, resultado y motivo, vinculados al kardex físico. Eso no significa que implemente íntegramente el esquema, vocabularios, API de captura/consulta o certificación EPCIS. La capa actual es un contrato propio y una base para un adaptador futuro; no se declara conformidad por tener un registro de eventos.

## 10. Qué sustituye esta reforma y qué se mantiene

| Antes | Modelo de esta reforma |
| --- | --- |
| Compra llegada que espera escritura manual de inspección | Expediente generado por la célula de entrada y coordinador |
| Confirmación humana de recepción de proveedor | Validación automática de la evidencia vigente y creación idempotente del recibo |
| Pedido preparado que necesita otra acción de despacho | Coordinador que busca capacidad compatible y ejecuta expedición |
| Camión en tienda hasta que una persona confirma | Célula de tienda y acuse electrónico como condición de retorno |
| Fallo poco visible o intervención para forzar estado | Espera/excepción explícita, persistente, consultable y reintentable de forma segura |
| Acciones históricas adoptadas implícitamente | Adopción explícita para no inventar recepciones de documentos anteriores |

Se mantienen catálogo y proveedores, unidades y lotes originales, posiciones precisas, conservación, reservas, misiones de transporte existentes, mantenimiento seguro, permisos y kardex append-only. No se hace borrado en cascada ni se reconstruye un historial inventado.

Los modos `academicLegacyFixture` y `controlledReceivingFixture` son exclusivamente facilidades de pruebas temporales para regresiones de pasos manuales. No son opciones del usuario, no se exponen en la API y no deben usarse al arrancar el servidor. Las pruebas de autonomía usan el constructor normal y validan el flujo de producción, no esos fixtures.

## 11. Alcance de la siguiente fase visual

La animación deberá leer las etapas, carga y equipo reales del proceso: llegada, acople, descarga, lectura, inspección, desvío, almacenamiento, preparación, carga, viaje, recepción y retorno. No deberá recrear los estados por temporizadores independientes ni modificar cantidades en el navegador. Si un proceso espera, la imagen debe mostrar esa espera; si existe una excepción, debe conservarse la carga representada.

Por ahora las nuevas capacidades lógicas no equivalen a modelos 3D nuevos ni a animaciones de sensores, remolques o células de tienda. Es deliberado: primero se verifica el contrato de negocio y después se vincula su representación.

## 12. Recursos visuales y revisión de preparación

Se incorporaron seis fotografías generadas para las ocho incorporaciones autónomas: descargador, portal Auto-ID, PIE, transportador, célula de cajas cerradas y estación de tienda. Las tres estaciones comparten la representación de su clase, sin fingir tres instalaciones fotografiadas diferentes. Las imágenes se integran en activos, fichas, edición, configuración, mantenimiento, selectores, Equipos de Operaciones y Centro de autonomía. No se sustituyen fotos propias cargadas por el usuario.

El [manifiesto](../core/autonomy-visual-assets.json) registra los archivos y su resolución. Los originales seleccionados se conservan en `v2/assets/autonomy-visuals-2026-10-18`; los WebP optimizados se sirven localmente. Una fotografía describe una clase, no certifica la capacidad o puesta en servicio de un equipo.

La [consola del proveedor y revisión de brechas](CONSOLA-PROVEEDOR-IOT.md) separa el software cliente, el coordinador, la pasarela local y los controladores del fabricante. Define diez pantallas propuestas, entidades, permisos, mensajes, acuses, configuración y mantenimiento. Es una especificación, no una interfaz de proveedor implementada ni conectada.

El recorrido normal nuevo se verificó desde inventario cero hasta recepción de tienda y retorno con recursos libres. También se comprobaron desconexión, avería con carga, reinicio y saturación de buffers. Antes de considerar cerrados todos los recorridos del modelo faltan dos extensiones de excepciones: disposición final de cargas de proveedor no aceptadas y expediente autónomo equivalente para logística inversa. Para operar hardware real faltan además adaptadores, pasarela, identidades individuales, autenticación, puesta en servicio y validación de seguridad local. No se declaran resueltas por añadir imágenes.
