# DonPepe · Diorama y expedición física

## Un plano, cuatro maneras de verlo

El exterior, el interior y los pasillos no son almacenes distintos. Comparten las zonas, racks, ubicaciones y puntos de transferencia de `core/blueprint.js`. La vista exterior muestra la nave completa con cubierta, fachada, patio y muelles. La vista interior retira la envolvente para inspeccionar el mismo almacenamiento. La vista de pasillo acerca la cámara; la de tiendas amplía el encuadre hacia los tres minimarkets del escenario.

El acabado actual es industrial estilizado de alta fidelidad: cubierta azul petróleo, estructura turquesa, señalización dorada DonPepe, concreto claro y cargas cálidas. Las formas principales tienen bordes biselados y los elementos de rack se engrosan donde mejora su lectura. Las proporciones de carga, huecos y vehículos conservan su escala en metros. La escena permanece luminosa en ambos temas; los instrumentos superpuestos siguen la preferencia clara u oscura.

## Dirección de arte y materiales limpios · 18 de octubre

El detalle se concentra en siluetas, bordes, uniones, apoyos y contraste de iluminación. Los modelos mantienen piezas funcionales reconocibles y emplean una malla biselada compartida para cajas, carcasas y otros volúmenes principales. Los tornillos y las láminas finas no se subdividen como un objeto principal.

El color base tiene variación amplia y tenue; no contiene granulado fotográfico, poros de un píxel ni fibras de alta frecuencia. La rugosidad define el acabado y el mapa de normales añade un relieve suave a las superficies. Los atlas compartidos de 256² evitan repetir una imagen grande por objeto; todos los atlas físicos juntos ocupan 8,25 MiB de buffers, además de etiquetas y recursos de iluminación.

| Superficie | Rugosidad base | Intensidad de normales | Metalicidad |
|---|---:|---:|---:|
| Concreto | 0,86 | 0,19 | 0 |
| Pintura epóxica | 0,64 | 0,12 | 0 |
| Cartón | 0,91 | 0,14 | 0 |
| Acero satinado | 0,52 | 0,10 | 0,56 |
| Cubierta pintada | 0,64 | 0,22 | 0,42 |

Son los valores predeterminados del material; una pieza puede especificar otro acabado deliberado. La rugosidad va de 0 (reflejo muy concentrado) a 1 (mate). Las normales afectan a la respuesta de la luz, no a la silueta ni a las colisiones; por eso los biseles y las estructuras de contacto son geometrías separadas. Se utiliza el flujo de materiales [Metallic-Roughness de Three.js](https://threejs.org/docs/pages/MeshStandardMaterial.html), con color en sRGB y mapas físicos lineales.

Las carreteras se construyen como una unión de superficies sin piezas coplanares superpuestas. La pintura se interrumpe en los cruces y los rótulos tienen profundidad y una separación respecto a sus soportes. Los logos de tienda se montan por encima de la cubierta, con 23 cm de separación y postes de apoyo. El texto del anexo y su logo ocupan franjas distintas.

La calidad es **alta fija**, con antialias y sombras de 2048². No existe selector ni reducción automática a calidad media o baja. La columna derecha contiene las cuatro perspectivas y un botón para mostrar u ocultar los instrumentos. Se mantienen ratón, gestos y teclado para navegar.

## Referencias visuales y selección de entidades

Las tarjetas de proveedores, marcas, categorías, tiendas y activos utilizan una imagen protagonista 3:2. Los logos conservan su proporción completa; las fotografías no se recortan para aparentar un encuadre diferente. Las miniaturas de productos en catálogo, líneas de pedido, selectores e inventario conservan sus dimensiones anteriores.

Cada tipo de elemento del inspector tiene una referencia vinculada: una carga muestra la foto de su SKU; un equipo móvil o fijo, la de su activo; una tienda, su local; y un rack, LOC o estación, el sistema de almacenamiento o equipo pertinente. Si no existe foto de una infraestructura concreta se muestra un esquema identificado como tal, no la fotografía de otro producto atribuida a esa infraestructura. El buscador incorpora almacén, racks, LOC y estaciones y prioriza los identificadores exactos antes de limitar los resultados.

La selección de vehículos utiliza sus mallas articuladas reales, conservadas para raycasting aunque sus dibujos se agrupen en instancias. No utiliza una caja invisible grande alrededor de cabina, remolque y horquillas. Las sombras de contacto de palés tampoco son superficies seleccionables. Los volúmenes semánticos de un rack permiten seleccionar sus cargas visibles, sin priorizar un palé ajeno situado detrás. Seleccionar un camión, robot o carga con pedido asociado sincroniza su seguimiento sin ejecutar comandos logísticos.

## Ajuste visual a la referencia audiovisual

Se revisaron las escenas de patio de 08–25 s, los acercamientos de 35–39 s, la órbita de 41–49 s y el enfoque de camión de 51–54 s. El exterior inicial adopta el encuadre oblicuo del patio: la fachada y el trabajo en los muelles reciben más espacio, y el techo puede quedar parcialmente fuera de cámara. La vista Tiendas conserva el encuadre general del escenario.

El mapa ocupa toda la superficie bajo una cabecera compacta. Indicadores arriba a la izquierda, inspección arriba a la derecha, seguimiento abajo a la izquierda y recursos abajo a la derecha reproducen la composición del video. El buscador está en la cabecera; las herramientas siguen accesibles mediante su menú. En móvil se redistribuyen para conservar controles utilizables.

La selección usa esquinas finas y etiquetas flotantes, no grandes círculos alrededor de los equipos. La ruta reportada del vehículo seleccionado se marca con puntos y un destino. La posición de las etiquetas sigue la misma interpolación que sus vehículos. Posición, objetivo y zoom de la cámara se animan juntos durante los acercamientos. Las ruedas giran según el desplazamiento observado, incluso al retroceder; las puertas, horquillas, plataformas y cargas siguen los estados del motor existente.

La referencia muestra varios almacenes y vehículos compactos. DonPepe mantiene su único centro, sus dos muelles de expedición y sus tres tiendas, y conserva los remolques con 24 plazas. Copiar las dimensiones compactas del video impediría colocar esas cargas. No se añaden palés o viajes inventados para llenar el patio: la actividad aparece al ejecutar tareas reales de la simulación. La ampliación autónoma descrita a continuación añade infraestructura al plano sin desplazar las ubicaciones existentes.

Los elementos seleccionables utilizan datos existentes: edificio, zonas, racks, ubicaciones, cargas, estaciones, equipos, camiones y tiendas. Un palé representa una unidad de carga identificada; no representa un lote nuevo. El lote sigue asociado a su SKU y fechas aunque cambie de ubicación, equipo o vehículo.

## Ampliación autónoma · 18 de octubre de 2026

La nueva nave de recepción ocupa **1.056 m² (33 × 32 m)** al oeste del edificio. Tiene patio de proveedores independiente, acceso de descarga y una abertura de transferencia hacia el almacén original. Sus equipos son seleccionables desde el mapa, el buscador y la lista de recursos; el inspector muestra su fotografía, función y estado observado. La ampliación es aditiva y no renumera LOC, racks ni cargas existentes.

El proceso visible sigue las fases confirmadas por el motor: descarga automática → identificación → inspección → transportador de entrada → posición de espera → recogida por AMR → almacenamiento. El muelle de proveedor admite un vehículo a la vez; una retención conserva su carga y bloquea al siguiente. El vehículo de proveedor se representa en el muelle ocupado: no se simula un viaje por carretera que el motor no reporte.

La mercancía anunciada no cuenta como inventario recibido. Al completarse la recepción se vincula con sus unidades de carga reales, y el reloj visual evita mostrar simultáneamente el anuncio y una copia del nuevo palé. Hay doce posiciones físicas de espera, con recorridos internos por los espacios entre filas.

### Soporte mecánico continuo de recepción y preparación

La carga no sale de la cinta deslizándose por el suelo. Un distribuidor sobre guías recibe el palé en su cubierta de rodillos, lo gira, lo traslada y lo asienta sobre los apoyos de su posición. Para entregarlo al AMR, el carro se detiene fuera de su huella, eleva su plataforma articulada y extiende las horquillas telescópicas hasta la cubierta del robot. Primero se asienta el palé; después las horquillas descienden ligeramente y se retiran. Preparación y recepción de tienda tienen sus interfaces de soporte correspondientes. Los componentes se seleccionan como partes de su activo controlador, no como máquinas desconectadas del registro.

La salida de la nueva línea termina tres metros antes del nodo de recogida del AMR. El distribuidor despeja lateralmente los rodillos antes de entrar a las posiciones de espera. No se trasladaron nodos, LOC o palés anteriores para conseguirlo; la nueva ruta mecánica se añade al plano y se aplica a autorizaciones nuevas. Los ciclos guardados con el trazado anterior conservan el camino y reloj ya observados.

Los nuevos ciclos de recepción tienen un mínimo de **75 s** para la distancia de rodillos y distribución de este plano. Las interfaces de recogida/depósito tienen **24 s en recepción** y **14 s en preparación**; los demás transbordos conservan sus duraciones específicas. No son cifras comerciales de un fabricante ni latencia artificial de la interfaz. Impiden representar decenas de metros, elevación y extensión en sólo dos o tres segundos. Una fase anterior en curso conserva su duración heredada y no se rebobina al desplegar.

La combinación es una interpretación del modelo DonPepe basada en funciones documentadas de [transportadores, lanzaderas y mesas elevadoras de Mecalux](https://www.mecalux.es/almacenes-automaticos/transportadores-de-rodillos-palets) y [AMR con plataformas de transferencia de palés](https://www.mecalux.es/almacenes-automaticos/amr-robots-moviles-autonomos). No se presenta como reproducción exacta, instalación validada ni especificación OEM de esos productos. El diagnóstico comprueba el punto de apoyo geométrico, la base de la carga y su separación durante cada fase.

La célula de preparación utiliza brazo articulado y pinza para trasladar las cajas reservadas, una por una, desde la carga de origen a un palé distinto. La etiqueta y la cinta acompañan a cada caja. El motor espera el tiempo de los ciclos de todas las cajas antes de crear la unidad de salida. Si se consume un palé completo y están ocupadas las cuatro posiciones, puede verificarse y reetiquetarse en su propia plaza; un pedido parcial sigue necesitando una plaza de salida separada.

Las tres tiendas tienen estación receptora detrás del remolque, puente retráctil, transferencia con cambio de dirección y posiciones de descarga separadas. Las unidades salen del camión siguiendo su identidad y custodia. No se crean existencias por el simple hecho de que la animación haya llegado al final.

Los materiales utilizan color, rugosidad y normales compartidos para concreto, juntas, asfalto, pintura epóxica, acero, cubierta, paneles de pared, madera, caucho y cartón. La iluminación ambiental precalculada, sombras y detalles de cerchas, rodillos, protecciones y señalización mejoran la lectura industrial. Son materiales y geometrías procedurales; no se presentan como fotografía ni como planos certificados de una instalación real.

## Qué ocurre al pulsar Despachar

El pedido debe estar consolidado y listo. El comando vuelve a comprobar sus cargas, conservación, capacidad y recursos. **Autorizar el despacho no pone inmediatamente el camión en carretera.**

| Fase | Operación del escenario | Estado visible |
|---|---|---|
| Reserva | Se asignan camión y muelle compatibles, sin doble ocupación | Pedido cargando |
| Acoplamiento | El camión se desplaza al muelle reservado | Acoplando al muelle |
| Acceso | Se prepara el acceso de carga | Abriendo acceso |
| Carga | El montacargas del muelle recoge y coloca cada palé en un espacio del vehículo | Cargando; contador de palés |
| Comprobación | Se comprueba que todas las cargas del pedido estén a bordo | Verificando carga |
| Cierre | Se cierra el acceso antes de abandonar el muelle | Cerrando acceso |
| Maniobra de salida | El vehículo libera el muelle | Saliendo del muelle |
| Transporte | Comienza el viaje a la tienda | Pedido en camino |
| Arribo | El vehículo llega; la tienda aún no ha recibido existencias | En destino |
| Recepción | La estación de tienda descarga y verifica las unidades; las excepciones se retienen para su resolución | Recepción autónoma, recibido o con diferencias |

Los dos montacargas son recursos de la simulación, no cuentas de usuario ni productos comerciales atribuidos a un fabricante. El recorrido visual de cada carga sigue su identidad: muelle → horquillas → espacio del camión → tránsito. No se duplica inventario para decorar el vehículo ni se elimina una carga cuando deja de estar en el almacén.

La entrega previa a expedición tampoco termina en un salto hacia una casilla: el transportador bajo de plataforma elevable entra a la plaza por tramos ortogonales, baja el palé sobre sus apoyos y se retira por debajo. Mantiene el bloqueo durante esa maniobra. El pedido no se declara listo mientras quede un transportador entrando, depositando o saliendo.

Durante una avería del montacargas, su carga y las reservas se conservan. Recuperar el equipo permite continuar. La pausa detiene el reloj del servidor. La interfaz no da por terminada una carga simplemente porque acabó una animación.

Si una modificación de la vida útil mínima deja la mercancía no apta durante la carga, la comprobación impide salir. Operaciones puede retener esa preparación con un motivo. El montacargas descarga las unidades ya subidas, devuelve cada una a una plaza reservada y libera el acceso; después los transportadores autónomos las llevan a cuarentena. No se considera una entrega cancelada recibida ni se reintegra automáticamente como stock utilizable.

## Lectura de la consola

- Los indicadores superiores muestran stock y trabajo registrado, sin porcentajes comerciales inventados.
- El seguimiento inferior distingue pedido, preparación, muelle, carga, ruta y recepción.
- Los recursos se consultan por muelles, equipos o camiones. Seleccionar una fila enfoca su representación y abre la inspección.
- Después de autorizar el despacho se abre su seguimiento en el mapa. No se reconstruye la escena por cada cambio de estado.
- Buscar un producto, carga o equipo evita tener que memorizar el código de una ubicación.
- Los modos de cámara, acercamiento y centrado cambian la vista, nunca las existencias.

Los expedientes de automatización se leen como una ficha operativa: situación actual, próxima acción, productos y cantidades, controles registrados y cronología. Las mediciones incluyen sus unidades y las incidencias explican qué ha ocurrido y qué se puede hacer. Los identificadores técnicos quedan en una sección secundaria desplegable, no en un bloque JSON o XML.

## Contactos y movimiento guiado · 18 de octubre

El servidor integra los desplazamientos en pasos de **1/60 s**, con límites de aceleración, frenado y giro. Los vehículos usan cuerpos compuestos por volúmenes orientados de sus piezas reales: cabina, remolque, chasis, espejos y ruedas; la plataforma y tijera del AMR siguen su altura observada. Se comprueban tanto los desplazamientos como el barrido al girar, sin tratar todo el aire alrededor de esas piezas como un bloque sólido. Racks, paredes, muelles, tiendas y otros vehículos participan como obstáculos. El camión se retira en reversa antes de girar frente a una tienda; no gira atravesando su fachada.

La vía compartida del patio admite un camión por ciclo. Los demás conservan su turno y esperan sin perder pedido, carga o muelle. La reserva se libera después de regresar vacío y aparcar físicamente. Los viajes guardados con el trazado anterior se replantean desde su pose real, conservando su identidad y custodia. Si dos viajes heredados ya se encuentran enfrentados, uno puede retroceder por motor hasta un refugio comprobado; no se teletransporta ni se desactiva su colisionador. Un vehículo detenido en tienda continúa siendo un obstáculo, pero no retiene indefinidamente una reserva que nunca tuvo.

Si una guía anterior intenta girar sin espacio al volver a aparcar, el planificador puede ejecutar una maniobra de despeje desde su orientación actual, alinear el vehículo en un bolsillo libre y entrar por una aproximación comprobada. La maniobra y su cursor se conservan al reiniciar. El operador no tiene que recolocar camiones. Si no existe un movimiento verificado sin contactos o el vehículo está averiado, se conserva la detención; no se anula un obstáculo para aparentar autonomía.

El navegador aplica una segunda protección de contactos sobre las poses interpoladas. Los palés libres resuelven su apoyo con gravedad de **9,81 m/s²** sobre su suelo o balda; una carga transportada permanece unida a su equipo. La exclusión de contacto entre montacargas y su propio remolque sólo se permite durante el transbordo correspondiente. Los transelevadores y carros sobre riel utilizan su envolvente mecánica: sus horquillas deben poder entrar al hueco abierto de una estantería.

Se trata de **física cinemática guiada con contactos**, apropiada para esta operación controlada. No es una simulación completa de neumáticos, suspensión, deformación del cartón o golpes destructivos, ni una certificación industrial. La física de presentación nunca modifica existencias o declara terminada una tarea.

## Fluidez y coste gráfico

El servidor calcula la operación. El navegador recibe instantáneas e historial autoritativo acotado y utiliza un reloj de reproducción e interpolación entre posiciones reportadas. Se conservan varias anclas temporales para que el retardo visual no reduzca el movimiento a la frecuencia de consultas. El historial de presentación vive en memoria: no se serializan cientos de fotogramas en SQLite por cada tick. El dibujo usa `requestAnimationFrame`, independiente de la frecuencia de consultas HTTP. Por eso no debe confundirse una consulta de datos con un fotograma. Una pausa o avería detiene la fase; sin telemetría nueva, el mapa llega sólo hasta el último instante observado, sin inventar movimientos ni terminaciones.

La geometría repetida se agrupa con instancias y materiales compartidos. La escena evita modelos externos pesados. La optimización conserva la calidad alta: reutiliza recursos, agrupa dibujos y evita sombras de piezas subpíxel. En reposo, fuera de pantalla o con la pestaña oculta no se mantiene un bucle de dibujo innecesario.

**60 FPS es el objetivo de presentación, no una garantía universal.** El presupuesto correspondiente es aproximadamente 16,7 ms por fotograma. Pantalla, navegador, GPU, resolución y carga del equipo influyen. Los verificadores registran el renderizador utilizado, fotogramas y complejidad; un resultado con SwiftShader es renderizado por software y no acredita la GPU del usuario. Tampoco debe multiplicarse artificialmente el contador para aparentar una frecuencia superior.

El movimiento esencial continúa con “reducir movimiento”; las transiciones decorativas se reducen. Cuando una instantánea omite una parte del trayecto a gran aceleración, el visualizador no inventa un paso diagonal a través de paredes para ocultarlo.

## Conservación y límites

La actualización es aditiva: conserva cuentas, permisos, pedidos, inventario e historial del escenario persistido. Los camiones que ya estaban en viaje pueden finalizarlo. El sistema anterior y sus bases no se borran para instalar la escena nueva.

No hay robots físicos, posicionamiento GPS, sensores, controlador PLC ni conexión a maquinaria real. La maniobra y la segregación térmica son un modelo educativo; no acreditan seguridad industrial, homologación de un sistema de carga o cumplimiento de cadena de frío. El despacho físico real requiere equipos, accesos, procedimientos y vehículos compatibles.

Resultados medidos y repetición de pruebas: [VERIFICACION.md](VERIFICACION.md).
