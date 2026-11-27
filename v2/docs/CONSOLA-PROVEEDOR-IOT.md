# Consola del proveedor SaaS e integración de equipos autónomos

Fecha de análisis: 18 de octubre de 2026. Estado: diseño de la siguiente frontera de integración, contrastado con el código actual. Este documento no habilita una conexión física, no crea cuentas ni concede al administrador de DonPepe acceso de proveedor.

## 1. Decisión principal

DonPepe es el cliente que utiliza el almacén y sus tiendas. La empresa que desarrolla, integra y mantiene la plataforma es el proveedor tecnológico. Son dos responsabilidades diferentes y deben tener interfaces, identidades y autorizaciones separadas.

La aplicación actual ya coordina un ciclo normal autónomo en su motor de simulación. Genera avisos de proveedor, reserva equipos, identifica cargas, verifica condiciones, recibe existencias de forma idempotente, almacena, prepara, carga, entrega y devuelve el camión. Sus eventos se identifican expresamente como simulados. Las imágenes de maquinaria mejoran su comprensión, pero no convierten ese motor en un controlador industrial.

La siguiente interfaz propuesta es una **consola del proveedor**, no otro menú con poder ilimitado dentro de la sesión administrativa de DonPepe. Su primera entrega debería ser inventario técnico, diagnóstico y seguimiento de configuración. El control físico sólo podría añadirse tras construir y verificar los adaptadores y la instalación correspondiente.

## 2. Qué software tiene realmente un equipo

Un robot no recibe directamente una orden del tipo «descuenta diez cajas del inventario» desde una página web. La aplicación de negocio solicita una misión; las capas locales y el controlador del fabricante ejecutan sus movimientos y producen resultados verificables.

| Capa | Pregunta que resuelve | Ejemplo DonPepe | Responsable propuesto |
| --- | --- | --- | --- |
| WMS / SGA: gestión del almacén | Qué mercancía existe, quién la solicita y dónde debe quedar | Reservar cajas frescas del lote correcto y registrar un recibo | Aplicación DonPepe |
| WES: coordinación de ejecución | Qué trabajo conviene ejecutar y con qué recurso disponible | Esperar el buffer libre y asignar una célula compatible | Orquestador DonPepe |
| WCS: control del flujo de equipos | Cómo coordinar transferencias entre máquinas | No soltar una carga hasta que el transportador de destino pueda recibirla | Integración local del proveedor |
| Pasarela local / edge | Cómo traducir, conservar y reconciliar mensajes | Adaptar la interfaz del lector, guardar un resultado durante un corte de internet | Software del proveedor instalado en la sede |
| Controlador y software del fabricante | Cómo accionar el equipo y verificar sus sensores | Brazo, agarre, accionamientos, navegación del robot o secuencia del transportador | Fabricante e integrador autorizado |
| Funciones locales de seguridad | Si el movimiento está permitido de forma segura | Puerta protegida, zona despejada, remolque retenido | Diseño y validación de seguridad de la instalación |

Mecalux diferencia la priorización y distribución de trabajos del WES y la coordinación de equipos del WCS. Esta separación inspira la arquitectura propuesta; no implica que DonPepe incluya Easy WMS ni sus licencias. [Easy WES](https://www.mecalux.es/software/wes-sistema-ejecucion-almacenes), [Easy WCS](https://www.mecalux.es/software/wcs-sistema-control-almacenes).

La nube puede solicitar y observar una misión, pero una página web no debe sustituir una parada de emergencia ni una función de protección local. Es una decisión de diseño coherente con la distinción que hace NIST entre sistemas informáticos convencionales y tecnología operativa, donde importan especialmente seguridad, disponibilidad y comportamiento físico. No constituye una evaluación ni certificación de seguridad de esta instalación. [NIST SP 800-82 Rev. 3](https://csrc.nist.gov/pubs/sp/800/82/r3/final).

## 3. Arquitectura objetivo y frontera de confianza

```text
Usuarios de DonPepe                  Personal autorizado del proveedor
  Administración / Operaciones        Consola técnica separada
             |                                   |
     Aplicación del cliente               Plano de gestión SaaS
     WMS + coordinación WES               clientes, sedes, versiones,
     documentos, reservas, kardex          identidades y diagnóstico
             |                                   |
             +-------- integración autenticada --+
                              |
                     Pasarela local de sede
                     cola persistente + WCS
                              |
          +-------------------+-------------------+
          |                   |                   |
     Auto-ID / PIE      Robots / transportadores   Control de muelle
          |                   |                   |
          +------ controladores y seguridad local-+
```

El plano de gestión SaaS administra instalaciones y versiones. El plano de ejecución local conserva el control del flujo de materiales y el estado real de la maquinaria. Si la nube deja de responder, la pasarela aplica una política de continuidad previamente aprobada: concluir únicamente acciones locales seguras ya aceptadas o retener la carga en un punto seguro. No inventa nuevas autorizaciones comerciales ni confirma entregas sin evidencia.

El servidor actual de DonPepe contiene la simulación de todas estas responsabilidades. Todavía no están desplegadas como servicios distribuidos ni existe esa pasarela física.

## 4. Qué debe mostrar la futura consola

Todas las pantallas siguientes son una especificación propuesta. No se deben mostrar como funciones ya conectadas a maquinaria.

| Pantalla | Contenido principal | Acción permitida y límite |
| --- | --- | --- |
| Instalaciones | Cliente, almacén, sucursales, zona horaria y contrato de servicio | Registrar una sede y verificar su pertenencia; no leer stock de otros clientes |
| Inventario técnico | Foto completa, clase, serie, modelo, fabricante, sede, capacidades y ciclo de vida | Dar de alta un activo técnico con identidad única; no habilitarlo automáticamente para operar |
| Pasarelas | Versión del agente, último contacto, colas, conectores y almacenamiento local | Diagnosticar conexión y preparar un cambio; nunca presentar «online» como prueba de seguridad física |
| Ficha de dispositivo | Identidad, estado comunicado, última lectura, software, certificado y tareas asociadas | Consultar capacidad real y causa de indisponibilidad; sin edición arbitraria del estado físico |
| Configuración | Diferencia entre revisión solicitada y confirmada por el equipo | Validar límites, programar una aplicación segura y consultar el acuse; no fingir aplicación al guardar |
| Misiones e intercambios | Orden, comando, equipo, acuse, estado, evidencias y tiempos | Consultar la cadena completa; no forzar «completado» ni fabricar una recepción |
| Conectores | ASN del proveedor, Auto-ID, PIE, transporte y recepción de sucursal | Probar esquemas y compatibilidad en entorno aislado; sin botón para saltar controles |
| Alertas y servicio | Incidencias, bloqueo, carga retenida, responsable y actuaciones | Abrir intervención con permiso temporal y motivo; no borrar evidencias de un fallo |
| Versiones | Paquete firmado, compatibilidad, prueba, despliegue y resultado | Preparar actualización controlada de software del proveedor; el firmware del fabricante requiere su procedimiento |
| Seguridad y auditoría | Altas, revocaciones, acceso de soporte, cambios y consultas sensibles | Trazar antes/después y alcance; nunca mostrar claves privadas ni contraseñas almacenadas |

La ficha de equipo debe distinguir **conectado**, **salud del software**, **disponibilidad operativa**, **seguridad verificada**, **ocupado con una carga** y **datos actualizados**. Ninguno de estos estados se deduce automáticamente de los demás.

### Separación de permisos sin alterar el RBAC actual

- Administración DonPepe mantiene maestros, usuarios, parámetros autorizados y mantenimiento dentro del cliente. No controla otros clientes ni recibe credenciales técnicas de dispositivos.
- Operaciones DonPepe autoriza procesos y supervisa sus excepciones. No instala firmware, edita certificados ni modifica lógica de seguridad.
- Tienda conserva su ámbito de sucursal.
- La futura identidad del proveedor pertenece a otro dominio de acceso. Su alcance será cliente/sede/acción y tiempo autorizados. Una autorización de soporte será revocable, quedará auditada y no permitirá hacerse pasar por el usuario del cliente.

No se crean ahora usuarios, roles adicionales ni permisos permanentes de proveedor. El diseño de esa autenticación y la autorización del cliente son requisitos previos para implementar la consola de gestión real.

## 5. Entidades necesarias en una integración física

El nombre de un campo es una propuesta del proyecto, no un esquema oficial de un fabricante.

| Entidad propuesta | Datos mínimos y regla de integridad |
| --- | --- |
| Cliente tecnológico (`Tenant`) | Identidad inmutable, estado contractual, límites; se obtiene de la sesión o credencial, nunca se confía sólo en un identificador enviado por el navegador |
| Sede (`Site`) | Cliente, almacén/sucursal, zona horaria y red/entorno; un dispositivo no se traslada entre sedes mientras mantiene custodia o trabajo activo |
| Pasarela (`EdgeGateway`) | Identidad propia, sede, versión, estado, almacenamiento y último contacto; autorización explícita de sus dispositivos subordinados |
| Identidad de dispositivo | Dispositivo, activo, sede, estado de alta, huella de certificado, vigencia y revocación; serie y nombre comercial no son credenciales |
| Modelo de capacidades | Clase, revisión, trabajos admitidos, límites, unidades de medida e interfaz soportada; no activar tareas que el modelo no soporte |
| Configuración solicitada | Revisión, valores validados, autor, motivo, aplicación segura y caducidad; no es aún configuración efectiva |
| Configuración comunicada | Revisión realmente aplicada, valores, resultado y momento confirmados por el agente; se compara con la solicitada |
| Comando técnico | Identidad única, correlación con misión, destino, revisión, precondiciones y plazo; no puede afectar una carga fuera de su autorización |
| Acuse técnico | Comando, dispositivo, recepción/aceptación/inicio/resultado y evidencia; distinguir entrega del mensaje y finalización del trabajo |
| Evento de dispositivo | Identidad, sede, equipo, sesión de arranque, secuencia, fecha observada, fecha de recepción, esquema, carga y resultado |
| Bandejas de mensajes | Salida e ingreso persistentes, estado de entrega y duplicados; la transacción que solicita un cambio debe conservar lo pendiente de comunicar |
| Paquete de software | Componente, versión, firma, hash, compatibilidad, dependencias, resultado de prueba y procedimiento de recuperación |
| Expediente de servicio | Equipo, causa, diagnóstico, permiso de acceso, parada segura, actuaciones y comprobación de retorno |

AWS documenta el aprovisionamiento de dispositivos con identidades, certificados y políticas individualizadas. Es una referencia concreta de implementación, no una decisión de contratar AWS ni una función existente de DonPepe. La propuesta evita una contraseña compartida para toda la flota y evita almacenar claves privadas en formularios, fotografías o registros de auditoría. [Aprovisionamiento oficial AWS IoT](https://docs.aws.amazon.com/iot/latest/developerguide/iot-provision.html).

La separación entre configuración solicitada y comunicada tiene un antecedente público en los *device twins* de Azure IoT Hub. Un documento con el último estado no reemplaza el historial de eventos de una misión: Microsoft distingue ambas necesidades. DonPepe debe mantener su expediente histórico aunque la ficha del equipo muestre sólo la última revisión. [Modelo oficial de device twins](https://learn.microsoft.com/en-us/azure/iot-hub/iot-hub-devguide-device-twins).

## 6. Ciclo de alta de un equipo

1. Registrar el activo y su modelo compatible. La fotografía sólo identifica visualmente; no acredita capacidad ni seguridad.
2. Verificar cliente, sede y número de serie; detectar duplicados y asignaciones incompatibles.
3. Preparar una identidad única y un mecanismo seguro de instalación de credenciales. No colocar secretos permanentes en una URL o etiqueta visible.
4. Inscribir la pasarela y el dispositivo; autenticar ambos extremos y conceder sólo el alcance requerido.
5. Ejecutar una prueba de comunicación sin movimiento ni carga: versión, capacidades, reloj, esquema y diagnóstico.
6. Realizar la puesta en servicio y la validación local de la instalación por personal competente; registrar su alcance y evidencias. Un campo `commissioned` no sustituye esa actividad real.
7. Aprobar parámetros dentro de límites admitidos y comprobar su revisión comunicada.
8. Habilitar nuevas asignaciones sólo cuando identidad, salud, servicio, capacidad y precondiciones sean válidas.
9. Rotar o revocar credenciales cuando corresponda. Dar de baja sólo después de cerrar custodia, trabajos y relaciones técnicas; conservar la trazabilidad histórica.

OPC UA ofrece autenticación de aplicaciones, integridad, cifrado y controles de acceso según su configuración. Elegir un protocolo no elimina la necesidad de administrar confianza, permisos y certificados. Su adopción efectiva dependerá de la interfaz soportada por cada fabricante; no todos los dispositivos se deben tratar como si hablaran el mismo protocolo. [OPC Foundation, arquitectura y seguridad](https://opcfoundation.org/about/opc-technologies/opc-ua/).

## 7. Comandos, acuses y mensajes: evitar movimientos duplicados

Propuesta de estados de comando:

```text
CREADO → EN_COLA → ENTREGADO → ACEPTADO → EN_EJECUCIÓN → COMPLETADO
                        ↘ RECHAZADO                    ↘ FALLIDO
          Sin respuesta suficiente → RESULTADO_DESCONOCIDO → CONCILIACIÓN
```

**Entregado** significa que una capa recibió el mensaje. **Aceptado** significa que el ejecutor admite el trabajo. **Completado** requiere el resultado físico comprobado. Un vencimiento no prueba que el equipo no se movió: si se perdió la respuesta después de ejecutar, la misión queda en resultado desconocido y se consulta su estado antes de reenviarla.

El emisor y el ejecutor deben persistir la identidad del comando. Un reenvío conserva esa identidad. Si se repite con el mismo contenido, devuelve el estado conocido; si se reutiliza con otro contenido, se rechaza y audita. No se crea otra misión porque el usuario hizo doble clic o se cortó la conexión.

MQTT define niveles de entrega y admite duplicados en QoS 1. Las garantías de transporte no sustituyen las transacciones de inventario ni la conciliación del trabajo físico. Por eso DonPepe conservará idempotencia de negocio aunque se elija MQTT para parte del enlace. [Estándar MQTT 5.0 de OASIS](https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html).

Los eventos de una integración futura se validarán contra identidad autenticada, sede y capacidad. Además de `eventId`, necesitan sesión de arranque/secuencia y fechas observada/recibida para detectar repetición, desorden y relojes defectuosos. El hash actual protege coherencia interna, pero **no es una firma digital ni autentica un dispositivo externo**.

Un evento tardío puede conservarse para auditoría sin autorizar una recepción actual. La validez comercial se resuelve contra la revisión del documento y de la carga, no sólo contra «el último mensaje recibido».

## 8. Recepción autónoma: evidencia por cada etapa

Ejemplo propuesto: una compra contiene dos unidades logísticas de yogur. Cada una conserva identificador logístico, fabricante/lote, vencimiento y cajas anunciadas.

1. El proveedor envía el ASN. El anuncio no aumenta existencias.
2. La llegada solicita un muelle compatible; su reserva no constituye una descarga.
3. El control local confirma retención del vehículo, acople y zona despejada; el descargador acepta una misión correlacionada con la carga.
4. La descarga comunica su resultado; Auto-ID coteja la etiqueta con el ASN. Un SSCC no revela por sí mismo el contenido: lo relaciona con los datos suministrados.
5. PIE verifica el perfil y soporte dentro de sus capacidades; la conservación se evalúa con una fuente de temperatura válida. La inspección visual no se presenta como análisis sanitario del alimento.
6. El coordinador acepta o retiene la carga. Una aceptación válida produce un recibo único y las misiones de almacenamiento compatibles.
7. El inventario refleja las confirmaciones del motor, no los fotogramas de un mapa. Una confirmación duplicada no genera otro recibo.
8. Si falla una comprobación, permanece la identidad y custodia de la carga. La futura disposición terminal debe documentar retorno al proveedor, corrección legítima del aviso o tratamiento autorizado; nunca borrar la carga ni aprobarla por tiempo transcurrido.

GS1 EPCIS ofrece un marco de eventos de trazabilidad y contexto de sensores para compartir lo ocurrido y su ubicación, momento y finalidad. El expediente propio de DonPepe puede mapearse a ese estándar mediante un adaptador, pero todavía no implementa su modelo e interfaces completos. [GS1 EPCIS y CBV](https://www.gs1.org/standards/epcis).

## 9. Auditoría del estado actual: qué existe y qué falta

La clasificación se refiere al código, no a prestaciones certificadas de un equipo físico.

| Área | Situación comprobada | Brecha que no se debe ocultar |
| --- | --- | --- |
| Recepción normal | ASN, cargas, controles simulados, recibo único y almacenamiento coordinado | Sustituir el adaptador simulado por interfaces autenticadas y datos reales del proveedor |
| Preparación y expedición | Asignación, célula de cajas cerradas, genealogía, carga y despacho coordinados | Interfaces de fabricante y evidencia física externa de cada transferencia |
| Recepción de sucursal | Estación vinculada a tienda, cotejo y acuse simulado antes del retorno | Conexión y puesta en servicio de cada sede receptora |
| Configuración de activos | Esquemas por clase, límites, revisiones, espera de retirada segura y auditoría | Envío a una pasarela y acuse independiente de aplicación real |
| Retención de entradas fallidas | No crea existencias aceptadas; conserva proceso, evidencia y reserva | Disposición terminal de unidades aún no recibidas: rechazo/retorno al proveedor y conciliación comercial |
| Devoluciones de tienda | Solicitud, transporte inverso y cuarentena modelados | El circuito antiguo no tiene todavía un expediente autónomo de Auto-ID y custodia equivalente al nuevo flujo de entrada/salida |
| Evidencia | Correlación, contenido, tiempo, duplicidad y reglas de aceptación | Identidad criptográfica, secuencia por arranque y conciliación entre sistemas separados |
| Persistencia | Estado operativo y movimientos transaccionales en SQLite | Bandejas distribuidas de mensajes, recuperación del edge y pruebas de partición/red real |
| Seguridad de acceso | Ámbitos de administración, operaciones y sucursal | Autenticación del proveedor, separación multicliente y soporte temporal autorizado |
| Operación técnica | Registro de activos y mantenimiento seguro dentro del modelo | Software de pasarela, inventario de versiones, actualización firmada y revocación de certificados |
| Representación | Imágenes/fichas y contrato para consultar el estado | Los nuevos modelos/animaciones del mapa son una fase aparte; una fotografía no modifica la ejecución |

### Prioridades recomendadas

**P0 — completar los límites funcionales del escenario simulado:** definir disposición de entradas retenidas; extender el expediente de custodia a devoluciones; diseñar corrección versionada del aviso de proveedor sin reescribir lecturas; probar colas y retenciones acumuladas. Son extensiones de lógica, no nuevos adornos del mapa.

**P1 — construir la base de la consola sin privilegios cruzados:** registro técnico de sedes/pasarelas/dispositivos, contrato de capacidades y configuración solicitada/comunicada, acuses y diagnóstico. Comenzar con un adaptador de pruebas aislado y datos claramente identificados; no exponer una ruta pública que acepte cualquier JSON como lectura física.

**P2 — conexión a equipos e instalación real:** selección de fabricantes e interfaces, identidad/certificados, red local, puesta en servicio, pruebas de integración, seguridad y continuidad. No es una tarea que se complete generando imágenes o introduciendo direcciones IP en un formulario.

## 10. Casos de fallo que deben gobernar el diseño

| Caso | Respuesta esperada |
| --- | --- |
| El usuario guarda dos veces o la red reintenta | La misma identidad devuelve el mismo resultado; no duplica carga ni existencias |
| El equipo ejecutó, pero se perdió su acuse | Estado desconocido y conciliación por comando/carga; no reejecución ciega |
| Llega un evento de otra sede o dispositivo | Rechazo por identidad y ámbito; no basta con que el código de carga coincida |
| Se repite un evento con contenido diferente | Rechazo y alerta de integridad; conservar las versiones para investigación |
| El reloj del dispositivo está desajustado | Retener decisiones sensibles, comparar tiempos y diagnosticar; no alterar caducidad del producto |
| El dispositivo pierde conexión con carga | Conservar custodia/reservas; actuación local segura y no reasignar esa carga a otro equipo |
| El proveedor cambia el ASN tras una lectura | Nueva revisión y reevaluación explícita; las observaciones anteriores son inmutables |
| La etiqueta no puede leerse | Retención y causa; no inferir lote o caducidad a partir de la foto de un producto |
| Falla temperatura, perfil o soporte | Retención; ninguna regla de productividad ni reintento convierte el fallo en aprobación |
| El muelle o buffer está lleno | Espera antes de transferir, respetando las reservas y la capacidad de la instalación |
| Se archiva una tienda con entrega activa | No transferir custodia a una sede no disponible; conservar la carga y resolver el proceso |
| Se cambia una configuración durante trabajo | Cambio pendiente hasta condición segura; no modificar un controlador cargado a mitad de una misión |
| Caduca o se revoca un certificado | Rechazar nuevas sesiones según política y activar continuidad local segura; no tratarlo como avería mecánica ni borrar el activo |
| Falla una actualización de software | Mantener evidencia, aislar nuevas asignaciones y ejecutar recuperación compatible aprobada; no forzar una versión que no pueda arrancar |
| Soporte quiere cambiar datos del cliente | Permiso específico temporal, motivo y auditoría; no sesión universal de administrador |
| Se restaura una copia antigua del servidor | Conciliar último estado local, comandos ya aceptados y cargas reales antes de reanudar |

## 11. Actualización de software y ciberseguridad

No todo ajuste es firmware. Los límites operativos aprobados, el agente de pasarela, un conector y el firmware del robot tienen ciclos de cambio distintos. La consola deberá identificar qué componente se cambia y quién lo admite.

Para el software propio del proveedor se propone: paquete firmado y versionado, comprobación de compatibilidad, prueba aislada, despliegue escalonado, ventana autorizada, requisito de estado seguro, confirmación del arranque y procedimiento de recuperación. Para firmware de terceros rige el procedimiento compatible del fabricante; no se presupone que cualquier equipo permita OTA ni retroceso de versión.

La base de ciberseguridad debe cubrir identidad, configuración autorizada, protección de datos, acceso a interfaces, actualización y observación del estado de seguridad, además de documentación y soporte. Son áreas recogidas por NIST; su uso como lista de diseño no equivale a obtener una certificación. [Catálogo oficial de capacidades IoT de NIST](https://pages.nist.gov/IoT-Device-Cybersecurity-Requirement-Catalogs/).

Deben existir segmentación de red, límites de mensajes y tamaño, esquemas cerrados, listas de capacidades, almacenamiento protegido de secretos y registros de acceso. Un error de acceso del proveedor no debe permitir consultar otra empresa ni enviar comandos a otra sede. Los valores del cliente que se rendericen en la consola deben tratarse como datos no confiables.

## 12. Criterios de aceptación antes de decir «está conectado»

1. Un equipo se autentica con identidad individual; otro equipo no puede utilizarla ni publicar para su sede.
2. La consola identifica qué es comunicado por un dispositivo y qué es calculado por el software.
3. Un parámetro guardado se ve como pendiente hasta recibir confirmación independiente de la revisión aplicada.
4. Duplicados, mensajes fuera de orden, datos inválidos y caducados no producen entradas ni salidas adicionales.
5. Un corte antes y después de ejecutar una transferencia conserva exactamente una custodia y una decisión contabilizada.
6. Reiniciar servidor, pasarela y dispositivo por separado no repite una orden física ya completada.
7. Un comando vencido no arranca tardíamente al reconectar; se concilia o rechaza según estado y política.
8. Una avería, carga retenida o mantenimiento no libera indebidamente el recurso ni pierde su unidad logística.
9. Las rutas de entrada fallida y de devolución terminan en una disposición trazable, no sólo en un estado perpetuo sin responsable.
10. Un certificado revocado, una actualización fallida y un intento entre clientes quedan auditados y no eluden seguridad local.
11. La protección del equipo sigue funcionando sin navegador ni acceso a la nube; debe verificarse con el fabricante e integrador.
12. Sólo después de estas pruebas el mapa consume sus estados: no crea ni certifica resultados físicos.

## 13. Explicación corta para una sustentación

«DonPepe decide qué mercancía necesita cada tienda. Su coordinador organiza el orden de trabajo y reserva recursos. La capa local traduce esas misiones para los equipos y recoge sus resultados; el controlador del fabricante ejecuta el movimiento y sus protecciones. La futura consola de nuestra empresa administrará instalaciones, identidades, versiones y diagnóstico sin sustituir las decisiones comerciales del cliente ni la seguridad de las máquinas. Actualmente estos equipos se ejecutan mediante un adaptador de simulación: los expedientes y reglas existen, pero conectar hardware requiere construir y verificar ese enlace».

**Ejemplo:** cuando se solicitan diez cajas, Operaciones autoriza el proceso. El software no aumenta existencias porque vio llegar un camión ni porque una animación acabó. Coteja la carga, conserva su lote y vencimiento, verifica las condiciones, registra un recibo único y asigna almacenamiento. Si un lector falla, la carga permanece retenida; no aparece por arte de magia en una estantería.

## 14. Glosario

- **SaaS:** software prestado como servicio; no implica que todas las funciones de una máquina se ejecuten en internet.
- **IoT:** equipos que intercambian datos mediante una red; conectividad no garantiza autonomía ni seguridad.
- **OT:** tecnología operativa que observa o modifica procesos físicos.
- **Edge / pasarela local:** equipo y software instalados cerca de las máquinas para integrar sus interfaces y conservar el estado local.
- **PLC:** controlador industrial programable utilizado para controlar una máquina o proceso; su programa no es el formulario de configuración del WMS.
- **Firmware:** software integrado de un dispositivo, distinto de sus datos operativos o de una página web.
- **Telemetría:** información que un dispositivo comunica sobre observaciones o funcionamiento.
- **Acuse:** respuesta identificada que confirma una recepción o resultado. Debe indicar exactamente qué confirma.
- **Idempotencia:** repetir una solicitud identificada no repite su efecto comercial o físico.
- **Conciliación:** comparar lo registrado por ambos extremos para resolver qué ocurrió realmente tras una discrepancia o desconexión.
- **Certificado X.509:** credencial pública asociada a una identidad criptográfica; la clave privada correspondiente debe permanecer protegida.
- **mTLS:** autenticación mutua mediante TLS, donde ambos extremos presentan y validan sus identidades.
- **OTA:** distribución de una actualización por red; requiere soporte del equipo y un procedimiento compatible, no sólo un botón.
- **ASN:** aviso anticipado de expedición remitido por el proveedor.
- **SSCC:** identificador de una unidad logística; no es un lote de fabricación ni un detalle automático de su contenido.
- **EPCIS:** estándar GS1 para capturar y compartir eventos de trazabilidad; tener una tabla de eventos propia no equivale a implementarlo.

## 15. Evidencia de código utilizada para esta revisión

- [Modelo de autonomía y validación de evidencias](../core/autonomy-domain.js): estados, identificación, límites de aceptación, fuente simulada, reevaluación y recepción de tienda.
- [Configuración e infraestructura autónoma](../core/autonomy-config.js): clases, capacidades, dispositivos y condiciones de disponibilidad.
- [Configuración segura de equipos](../core/device-settings.js): límites por clase, aplicación pendiente y estado efectivo del simulador.
- [Motor operativo](../core/engine.js): almacenamiento, preparación, carga, transporte, devolución, permisos y transacciones de movimientos.
- [Política de autorización](../security/policy.js): separación entre administración, operaciones y tienda.
- [Integración del servidor](../server.js): lectura autenticada y auditoría; no existe un receptor público de telemetría física.
- [Arquitectura de autonomía actual](AUTONOMIA-INDUSTRIA-4.md): alcance, fuentes y límites del escenario.

Este documento deja preparado el contrato funcional de una consola del proveedor. No modifica el mapa, el esquema de usuarios, las credenciales ni los documentos operativos del cliente.

## 16. Verificación adicional reproducible del ciclo actual

Se ejecutó [el verificador integral](../scripts/verify-autonomy-integrated.cjs) exclusivamente sobre memoria y bases SQLite recién creadas en un directorio temporal. No abre las bases de `v2/data`, no invoca el servicio del usuario y no utiliza los modos de prueba de recepción manual. El [reporte generado](../../../DonPepe-Autonomia-2026-10-18/validacion-integral-recursos.json) contiene la secuencia observada y sus aserciones.

Resultados del recorrido desde un almacén vacío:

- Tres compras de productos de ambiente, refrigeración y congelado: 26 cajas aceptadas mediante tres recibos y almacenadas.
- Un pedido nuevo de tienda: preparación robotizada, carga verificada, transporte, recepción autónoma y retorno del vehículo; 13 cajas en tienda y 13 en el CD.
- Conservación de cantidades comprobada en cada avance; diez evidencias con origen `SIMULATED_DEVICE` y sin duplicación de recibos.
- Al terminar: ningún trabajo ni misión activa, ninguna carga retenida por robots/células y los tres camiones disponibles, sin asignaciones de pedido pendientes.
- Cinco recorridos diagnósticos aprobados: ciclo completo, portal desconectado sin autocuración por reloj, fallo de AMR conservando carga/misión, reinicio durante inspección y carga, y veinte llegadas limitadas a doce posiciones de buffer que se reanudan al volver la capacidad de transporte.
- Cuarenta pruebas existentes de autonomía, configuración, permisos, API y equipos aprobadas adicionalmente; cubren también lecturas inválidas, tiempo de espera, conservación, caducidad, rollback e incorporación explícita de procesos anteriores.

`WAITING_DISPATCH` puede ser un estado transitorio dentro de un mismo avance cuando ya hay recursos compatibles libres; se verificó también el evento de despacho. El historial visual de interpolación se reconstruye al reiniciar y no se confunde con custodia persistida, que sí se comparó.

Estos resultados acreditan el comportamiento del **modelo simulado bajo los escenarios probados**, no todas las averías posibles ni conexión, rendimiento, seguridad o certificación de hardware real. Las brechas descritas en la sección 9 siguen pendientes aunque el recorrido normal y la liberación de recursos hayan sido satisfactorios.
