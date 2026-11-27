# DonPepe V2: fundamento documental y diseño de la simulación

Consulta de fuentes oficiales: **17 de octubre de 2026**. Este documento distingue hechos publicados por Mecalux de decisiones propias del proyecto. Describe el diseño objetivo; por sí solo no acredita que cada capacidad ya esté implementada o probada.

## 1. Qué se toma como referencia y qué no se afirma

DonPepe es una instalación ficticia universitaria: un centro de distribución (CD) que recibe mercancía de proveedores y abastece tres minimarkets propios. Conserva su marca, pero reconstruye su operativa alrededor de pedidos, unidades de carga y ejecución automática simulada. Las cantidades de equipos, dimensiones, tiempos, productos y reglas de demostración son decisiones de DonPepe, no parámetros de una instalación suministrada por Mecalux.

La inspiración es integral, no una reproducción del catálogo entero en un mismo edificio. Los sistemas de almacenaje son alternativas que se seleccionan según las cargas y el flujo; no resulta coherente instalar todas las tecnologías para resolver el mismo recorrido. Tampoco las páginas comerciales publican sus algoritmos internos ni un esquema de base de datos que podamos copiar. Mecalux explica además que Easy WMS puede dirigir instalaciones manuales, híbridas y automáticas y desplegar las funcionalidades necesarias. [Easy WMS oficial](https://www.mecalux.es/software/sga-software-gestion-almacenes).

El caso oficial de Logiscor / Supermercados Piedra demuestra una combinación real de almacenamiento automático de cajas, Pallet Shuttle y gestión de almacén para distribución alimentaria. No demuestra que DonPepe necesite exactamente sus equipos ni que aquella instalación sea totalmente robotizada. La web y el PDF del caso incluso presentan cifras de tiendas distintas; no se trasladan esas cifras a nuestro proyecto. [Caso oficial](https://www.mecalux.es/casos-practicos/logiscor-almacen-automatico), [PDF del caso](https://mecaluxes.cdnwm.com/documents/20128/4455743/Logiscor_cp_ES.pdf/65ac1f6a-8b0d-520d-5d85-4a75afa80e3f?t=1766140795935).

No se afirma relación comercial, certificación, integración efectiva con Easy WMS, conexión con máquinas reales, cumplimiento de seguridad industrial ni reproducción de la ingeniería de Mecalux. El mapa debe identificarse como **simulación**, no como telemetría ni gemelo digital de un edificio real.

## 2. Función publicada, traducción a DonPepe y límite

La siguiente matriz es el contrato funcional del diseño. Las pantallas y pruebas deben precisar qué parte está terminada; una referencia oficial no constituye una función implementada.

| Referencia oficial y función publicada | Traducción propuesta para DonPepe V2 | Límite que debe quedar visible |
| --- | --- | --- |
| **WMS / SGA:** gestionar existencias, ubicaciones y procesos de recepción a expedición. [Fuente](https://www.mecalux.es/software/sga-software-gestion-almacenes) | Catálogos, entradas, inventario por carga/lote/posición, reservas y pedidos de tienda. | No incluye contabilidad, facturación fiscal ni un ERP real. |
| **WES:** sincronizar tareas y recursos; Mecalux lo presenta integrado nativamente en Easy WMS. [Página](https://www.mecalux.es/software/wes-sistema-ejecucion-almacenes), [PDF de 2 páginas](https://mecaluxes.cdnwm.com/pdf/catalogos/catalogo-wes-sistema-ejecucion-almacenes.1.3.pdf) | Un coordinador divide el pedido liberado en misiones dependientes y selecciona recursos compatibles. | Prioridad, disponibilidad y distancia son reglas didácticas, no el optimizador propietario de Easy WES. |
| **WCS:** coordinar equipos automáticos y ejecutar decisiones del SGA. [Página](https://www.mecalux.es/software/wcs-sistema-control-almacenes), [PDF de 2 páginas](https://mecaluxes.cdnwm.com/pdf/catalogos/catalogo-wcs-sistema-control-almacenes.1.7.pdf) | Máquina de estados para recogida, transferencia, depósito, bloqueo y recuperación; el servidor determina los eventos. | Sin PLC, protocolos de maquinaria ni evaluación funcional de seguridad. |
| **Miniload:** estanterías de cajas/bandejas, transelevador, cabeceras de transporte y control. [Página](https://www.mecalux.es/almacenes-automaticos/miniload), [PDF técnico](https://mecaluxes.cdnwm.com/pdf/catalogos/catalogo-miniload.3.7.pdf) | Racks por pasillo con niveles y posiciones; una máquina de pasillo accede a la altura y entrega en una cabecera. | Un AMR de transporte no extrae por sí mismo cargas de cualquier nivel. No se simula doble profundidad sin resolver primero la carga que bloquea el acceso. |
| **AMR:** transporte entre puntos y gestor de flotas que considera tráfico, disponibilidad y batería. [Página](https://www.mecalux.es/almacenes-automaticos/amr-robots-moviles-autonomos), [PDF técnico](https://mecaluxes.cdnwm.com/pdf/catalogos/catalogo-amr-robots-moviles-autonomos.7.4.pdf) | Seis recursos móviles iniciales, estaciones de transferencia, rutas por corredores, reserva de tramos y recarga. | Posiciones y batería virtuales. Un grafo de rutas no reproduce SLAM, sensores LiDAR ni evitación física certificada. |
| **Store Fulfillment:** coordinar inventario y flujos entre CD y tiendas, existencias en camino, reposición y devoluciones. [Fuente](https://www.mecalux.es/software/store-fulfillment) | Solicitud de tienda, preparación, salida, viaje virtual y recepción en el destino. El inventario de tienda es distinto del del CD. | La venta de tienda será una acción de escenario si no existe conexión con un TPV. Despacho no equivale a recepción. |
| **YMS:** controlar vehículos en accesos, patio, estacionamientos y muelles. [Fuente](https://www.mecalux.es/software/yms-yard-management-system) | Dos muelles y tres camiones iniciales; cola, asignación de muelle, carga y liberación. | No es un TMS completo ni optimización de rutas urbanas, documentación legal o GPS. |
| **Slotting:** recomendar posiciones según reglas, demanda, recorridos y equipos. [Fuente](https://www.mecalux.es/software/slotting-sga) | Reglas explicables para proponer una posición libre y compatible. Una futura reclasificación requerirá misiones de traslado. | Buscar el primer hueco libre es ubicación automática básica, no equivale al slotting predictivo comercial. |
| **Supply Chain Analytics:** paneles e indicadores de los procesos logísticos. [Fuente](https://www.mecalux.es/software/updates/supply-chain-analytics) | Métricas calculadas desde pedidos, cargas, misiones e incidencias del escenario. | No mostrar productividad, ahorro ni precisión inventados; evitar extrapolar tiempos acelerados a rendimiento industrial. |
| **Robot de picking:** brazo que transfiere productos desde un contenedor a otro con visión y agarre. [Página](https://www.mecalux.es/almacenes-automaticos/robot-picking), [PDF](https://mecaluxes.cdnwm.com/pdf/catalogos/catalogo-robot-picking.4.1.pdf) | Referencia para una ampliación futura de preparación de unidades. La base V2 consolida cajas cerradas. | No presentar la consolidación de cajas como si fuera el robot de picking de productos sueltos. La FAQ oficial consultada limita su agarre actual a 3 kg. |

**Fuera de la base inicial:** Easy DOM optimiza la elección del origen dentro de una red de centros; con un único CD, esa elección no tiene alternativas. No se inventa un optimizador multialmacén. [Easy DOM](https://www.mecalux.es/software/order-management-system-dom). Producción, facturación 3PL, marketplaces y gestión de trabajo humano no se añaden solo para aumentar el menú. Pallet Shuttle, 4-Way Shuttle, Movirack y otros sistemas podrán evaluarse como escenarios alternativos con ingeniería y reglas propias, no como decorado que mueve inventario sin un flujo definido.

## 3. Infraestructura y unidades que deben ser coherentes

### Diseño físico propio

El plano de referencia de DonPepe dispone una recepción con control, reserva seca automática, cámara refrigerada, cámara congelada, almacenamiento de limpieza separado, cuarentena, consolidación, expedición, cargadores y patio exterior. Debe haber corredores y puntos de transferencia explícitos, acceso a mantenimiento y cerramientos de las zonas automáticas. La geometría y el motor deben utilizar la misma distribución: un camino visible no puede atravesar una pared lógica ni un trayecto lógico cruzar una estantería.

El escenario inicial contempla dos transelevadores asociados a pasillos concretos, seis móviles, una estación de consolidación, dos muelles y tres camiones. Son valores didácticos editables. Los niveles y posiciones se generan desde el plano compartido, no desde códigos independientes del edificio. Una única plaza admite una HU compatible; la cantidad comercial permanece en la carga.

El catálogo Miniload incluye cámaras aisladas con transportadores de entrada/salida y estaciones anexas para temperaturas negativas (página impresa 39); también muestra que el cambio de pasillo requiere un puente de transbordo cuando se comparte máquina (página 23). Son fundamentos útiles para el diseño, no autorización para que un transelevador atraviese cualquier habitación. [PDF Miniload, edición identificada 09/22](https://mecaluxes.cdnwm.com/pdf/catalogos/catalogo-miniload.3.7.pdf).

### Límites térmicos y de carga que no se deben ignorar

El catálogo AMR consultado especifica **0 a 40 °C** y **70 % de humedad sin condensación** para sus modelos AMR 100 y AMR 1500 (páginas impresas 9, 11 y 13). La página 13 también indica 100 kg para AMR 100 Box. No es correcto afirmar que ese modelo puede circular sin más dentro de un congelador a -18 °C. [PDF AMR, edición identificada 01/26](https://mecaluxes.cdnwm.com/pdf/catalogos/catalogo-amr-robots-moviles-autonomos.7.4.pdf).

DonPepe debe mantener los móviles de referencia ambiente fuera de congelación y resolver la transferencia a un equipo fijo de cámara, o identificar expresamente cualquier robot frío como **recurso ficticio configurado del escenario**, sin asignarle una homologación comercial no verificada. Las temperaturas +2 a +6 °C y -18 °C del escenario son supuestos del producto, no recomendaciones universales de conservación de todos los alimentos. Una implementación real exigiría requisitos por producto y validación térmica y sanitaria.

Tampoco se deben sumar 24 cajas de 12 kg en una HU y llamarla carga de un AMR de 100 kg. Caja comercial, bandeja y palé no son intercambiables. Peso, formato de transferencia y capacidad del recurso deben concordar; si la demostración no modela alguno, debe declararse como simplificación y evitar atribuir una capacidad de fabricante.

### Diccionario mínimo de datos de DonPepe

Estas son decisiones del modelo del proyecto, no un esquema interno publicado por Mecalux:

| Concepto | Significado y regla |
| --- | --- |
| SKU | Referencia comercial específica. Por ejemplo, arroz extra en bolsa de 1 kg. |
| Presentación / caja | Agrupación comercial. Una caja puede contener 12 bolsas del SKU. Cantidad de cajas y cantidad de bolsas deben mostrarse con su unidad. |
| Lote | Grupo trazable de fabricación, proveedor, fecha de ingreso y caducidad cuando corresponda. Su identificador interno no elimina el lote del fabricante. |
| HU, unidad de manipulación | Carga física identificada que se transporta. Puede ser una caja o una agrupación admitida por el equipo. Muchas HUs pueden compartir lote; lote no es una sola caja. |
| LOC / ubicación | Dirección física estable. Código propio: `CD1-SEC-A01-R02-N03-P01`, CD, zona, pasillo, rack, nivel y posición. Es una convención DonPepe, no un código universal obligatorio. |
| Reserva | Compromiso de una cantidad para un pedido. Reduce disponibilidad, pero no demuestra recogida ni cambia por sí sola la posición física. |
| Misión | Paso ejecutable con origen, destino, carga, dependencias y equipo. No es una cuenta de usuario. |
| Expedición | Cargas vinculadas al viaje. Debe conservarse su trazabilidad mientras están en tránsito y hasta la recepción. |

## 4. Flujo objetivo y responsabilidades

**Entrada:** crear compra -> registrar llegada -> aceptar o retener -> identificar lotes y cargas -> seleccionar huecos compatibles -> liberar misiones -> transferir -> almacenar. Lo rechazado o retenido no se ofrece como disponible. El proveedor es externo; no se finge integración con su ERP.

**Salida:** la tienda solicita cajas -> operaciones revisa y libera -> el servidor comprueba y reserva existencias aptas -> recupera cargas -> consolida por destino -> asigna muelle y camión compatible -> carga -> despacha -> ejecuta viaje virtual -> tienda confirma recepción y diferencias. Caducidad, cuarentena, reservas previas, capacidad y temperatura pueden impedir la liberación. FEFO significa priorizar la caducidad más próxima entre existencias aptas, no enviar producto caducado.

**Excepción:** una avería o bloqueo detiene el paso afectado; conserva la identidad y custodia de la carga. Reanudar no repite una entrega ya registrada. Una devolución de tienda vuelve como mercancía pendiente de inspección, no automáticamente a disponible. Cancelar antes de reservar, durante preparación o después de despachar son situaciones distintas.

**Tres perfiles humanos:** administrador de gobierno, jefe de operaciones y responsable de tienda. El administrador principal es único; operaciones libera trabajo y resuelve incidencias; tienda solicita y recibe solo en su sucursal. No se conserva RF como protagonista ni se crean cuentas por robot. Los permisos se verifican en el servidor, no únicamente ocultando botones. La autenticación y autorización son controles del prototipo y no una certificación de seguridad empresarial.

## 5. Contrato de simulación, validación y honestidad

El servidor es la autoridad del escenario. La persistencia SQLite conserva reloj virtual, estado, revisión y recibos de comandos. El navegador representa los eventos; cerrar el mapa o bajar sus fotogramas no debe crear, perder ni duplicar mercancía. Pausa y velocidad afectan tiempo simulado, no inventan sensores. El reinicio exige confirmación y solo afecta datos V2 aislados, nunca la base anterior.

Criterios de aceptación del nuevo recorrido:

- La misma HU no ocupa dos sitios ni viaja en dos equipos a la vez. La plaza de destino y la carga se reservan antes del traslado.
- La reserva de un pedido no altera por sí misma el stock físico. Recogida, entrega, despacho y recepción son hechos separados y trazables.
- Las cantidades se conservan: entradas aceptadas más devoluciones aceptadas, menos salidas y bajas justificadas, explican existencias y tránsito. Ningún saldo disponible es negativo.
- El reinicio del proceso y la repetición de un comando no aplican dos veces una transición ya confirmada.
- Un equipo no se asigna si está averiado, sin capacidad, sin batería suficiente o sin acceso compatible. Un pasillo bloqueado genera espera o ruta alternativa explicable.
- Se demuestran entrada completa, pedido completo con recepción y una avería recuperable; las pruebas deben comprobar saldos y estados, no solo animación.
- El registro indica quién ordenó, qué ocurrió, qué HU/lote/SKU afectó y en qué tiempo virtual. Los indicadores proceden de ese registro.

No hay robots, PLC, cámaras industriales, sensores térmicos, TPV, transportistas, correo ni GPS conectados por el hecho de dibujarlos o mostrar un estado. El proyecto no valida seguridad de máquinas, cadena de frío, calidad alimentaria ni capacidad estructural de racks. Tampoco permite extrapolar sus segundos acelerados a cajas/hora de una instalación real.

## 6. Registro de fuentes oficiales consultadas

Todas las fuentes son del fabricante; sus casos y ventajas son información publicada por él, no auditorías independientes. Las fechas siguientes son de consulta. La fecha editorial solo se especifica cuando se identificó en el propio documento. No se reproducen algoritmos ni ilustraciones comerciales como si fueran propios.

| Fuente | Formato y sección utilizada | Consulta |
| --- | --- | --- |
| [Robots móviles autónomos](https://www.mecalux.es/almacenes-automaticos/amr-robots-moviles-autonomos) y [catálogo AMR](https://mecaluxes.cdnwm.com/pdf/catalogos/catalogo-amr-robots-moviles-autonomos.7.4.pdf) | Modelos, transferencia, gestor de flota; PDF edición 01/26, páginas 9, 11-13. Tabla e ilustraciones de página 13 revisadas visualmente. | 2026-10-17 |
| [Miniload](https://www.mecalux.es/almacenes-automaticos/miniload) y [catálogo técnico](https://mecaluxes.cdnwm.com/pdf/catalogos/catalogo-miniload.3.7.pdf) | PDF edición 09/22; componentes, unidades de carga, pasillos, profundidad, cámara frigorífica; páginas 4-10, 14-23 y 39. Plano de página 39 revisado visualmente. | 2026-10-17 |
| [Robot de picking](https://www.mecalux.es/almacenes-automaticos/robot-picking) y [catálogo](https://mecaluxes.cdnwm.com/pdf/catalogos/catalogo-robot-picking.4.1.pdf) | Secuencia de entrada, visión, recogida, depósito y salida. El límite de 3 kg procede de la FAQ web consultada, no de una inferencia desde la imagen. | 2026-10-17 |
| [Easy WMS](https://www.mecalux.es/software/sga-software-gestion-almacenes) | Función de SGA, alcance, automatización e integraciones. | 2026-10-17 |
| [Easy WES](https://www.mecalux.es/software/wes-sistema-ejecucion-almacenes) y [catálogo WES](https://mecaluxes.cdnwm.com/pdf/catalogos/catalogo-wes-sistema-ejecucion-almacenes.1.3.pdf) | Orquestación, secuenciación, recursos e integración nativa en WMS; PDF 2 páginas. | 2026-10-17 |
| [Easy WCS](https://www.mecalux.es/software/wcs-sistema-control-almacenes) y [catálogo WCS](https://mecaluxes.cdnwm.com/pdf/catalogos/catalogo-wcs-sistema-control-almacenes.1.7.pdf) | Sincronización de equipos y ejecución de movimientos; PDF 2 páginas. | 2026-10-17 |
| [Store Fulfillment](https://www.mecalux.es/software/store-fulfillment) | Tiendas independientes, reposición, tránsito, devoluciones e integración TPV. | 2026-10-17 |
| [Yard Management System](https://www.mecalux.es/software/yms-yard-management-system) | Vehículos, accesos, estacionamientos y muelles. | 2026-10-17 |
| [Slotting para SGA](https://www.mecalux.es/software/slotting-sga) | Demanda, reglas, recorridos y recomendación de ubicaciones. | 2026-10-17 |
| [Supply Chain Analytics](https://www.mecalux.es/software/updates/supply-chain-analytics) | Indicadores y cuadros de mando configurables. | 2026-10-17 |
| [Easy DOM](https://www.mecalux.es/software/order-management-system-dom) | Asignación a puntos de expedición en redes; motivo para no fingir esa decisión con un solo origen. | 2026-10-17 |
| [Logiscor / Supermercados Piedra](https://www.mecalux.es/casos-practicos/logiscor-almacen-automatico) y [PDF del caso](https://mecaluxes.cdnwm.com/documents/20128/4455743/Logiscor_cp_ES.pdf/65ac1f6a-8b0d-520d-5d85-4a75afa80e3f?t=1766140795935) | Ejemplo alimentario con tecnologías complementarias. La versión web y el PDF difieren en número de tiendas; no se usa ese dato para dimensionar DonPepe. | 2026-10-17 |
