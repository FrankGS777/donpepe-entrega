# DonPepe 3.1 · Responsabilidades y controles

Fecha: 17 de octubre de 2026. Este documento describe lo implementado en esta versión, no capacidades propietarias de Mecalux ni una certificación industrial.

## 1. Separación de responsabilidades

| Área | Administrador del sistema | Jefe de operaciones | Responsable de tienda |
|---|---|---|---|
| Cuentas y estados | Crear, editar, desactivar y eliminar; administrador único protegido | Sin acceso | Sin acceso |
| Permisos | Restringir capacidades dentro del techo fijo de cada perfil | Sin acceso | Sin acceso |
| Productos, proveedores y sucursales | Crear, editar, desactivar y eliminar con referencias protegidas | Consulta para operar | Catálogo permitido para solicitar |
| Resumen de existencias | Consulta agregada por producto y sucursal, sin controles de movimiento | Inventario operativo y trazabilidad | Existencias de su sucursal |
| Reglas | Configurar límite de pedido, vida útil y pedidos abiertos | Aplicarlas, no modificarlas | Aplicarlas, no modificarlas |
| Recuperación | Aprobar, rechazar y reintentar entrega; nunca leer contraseñas o tokens | Solicitar recuperación de su cuenta | Solicitar recuperación de su cuenta |
| Mapa y equipos | Sin plano ni telemetría; sin controles operativos | Mapa ampliado, selección, misiones e incidencias | Sin mapa del centro |
| Recepción de proveedor | No | Compra, llegada, aceptación, cuarentena y liberación | No |
| Preparación y despacho | No | Reservar, priorizar, liberar, despachar y retener preparaciones | Solicitar su pedido; cancelar sólo si sigue pendiente |
| Solicitud de reposición | No crea pedidos | Atiende solicitudes; puede generar una solicitud identificada como simulación | Crea solicitudes de su propia sucursal |
| Recepción en sucursal | No | No confirmar en nombre de la tienda | Confirmar lo realmente recibido en su sucursal |
| Venta y devolución | No | Sin registrar ventas o devoluciones ajenas | Sólo mercancía de su propia tienda y pedido de origen |
| Auditoría | Consultar decisiones de gobierno y accesos | Eventos logísticos de su ámbito | Eventos y documentos propios |
| Mi cuenta | Nombre, contraseña y Gmail propio verificado | Igual | Igual |

El techo de cada perfil forma parte del código y no puede ampliarse marcando casillas. Administración no puede darse `equipment.fault`, `order.release`, `simulation.pause` o `map.view`. Operaciones y tienda no pueden recibir funciones de gobierno. Los permisos esenciales no se retiran para evitar bloquear el acceso del propietario o del único administrador.

Las sesiones guardan una identidad, no una copia confiable de los privilegios. Cada petición vuelve a leer cuenta, estado, perfil y permisos. El servidor deniega operaciones aunque alguien modifique botones o envíe una petición manual. Retirar acceso a inventario o mapa también retira sus datos de la respuesta HTTP; no se limita a ocultarlos visualmente.

### Solicitud, compra y preparación tienen responsables distintos

La tienda solicita los productos que necesita desde su propio portal. La solicitud queda pendiente y no reserva existencias. Operaciones revisa y libera la preparación; esa liberación comprueba disponibilidad y programa los equipos del flujo existente. Al consolidar la mercancía, Operaciones autoriza la carga y el despacho. La tienda confirma después las cantidades realmente recibidas y puede registrar consumo o devolución de su propia mercancía.

Las solicitudes nuevas se crean únicamente desde la interfaz de tienda mediante `order.create`, con la sucursal vinculada a la cuenta. Operaciones recibe las solicitudes y autoriza su preparación; no puede crear pedidos de tienda ni simular demanda. El antiguo comando `simulation.request` está retirado y se rechaza también por API, aunque se intente reutilizar un permiso antiguo. Los registros iniciales o de pruebas anteriores se conservan identificados en el historial. La idempotencia evita duplicados y se mantienen las validaciones de cantidades y de pedidos abiertos.

La compra a proveedor sigue bajo Operaciones: es una solicitud de entrada de mercancía, seguida por llegada, revisión y almacenamiento. Administración configura qué proveedor suministra qué productos y sus condiciones; no registra una recepción física. El resumen de existencias del administrador muestra disponible, reservado, retenido, tránsito, tiendas, compras esperadas y reposición, sin exponer controles del mapa.

### Quince mejoras de experiencia incorporadas

1. Portal de tienda con fotografías, existencias propias y accesos a solicitudes, recepción y devolución.
2. Catálogo visual con fotografías reales, marcas, categorías, presentaciones y códigos comerciales; selección de archivos con vista previa, normalización sin recortar el envase y subida validada.
3. Fichas de proveedor con logotipo, contacto, canales y plazo de suministro configurables.
4. Resumen administrativo de existencias y cobertura con nombres de producto y sucursal.
5. Exportación CSV del catálogo y del resumen de existencias respetando los filtros activos.
6. Búsqueda y filtros conservados en catálogos y resumen para continuar la revisión sin perder el contexto.
7. Solicitudes filtrables por tienda, producto y estado, con su origen visible.
8. Aviso de nuevas solicitudes al sincronizar la consola de Operaciones.
9. Borrador de pedido o compra guardado por usuario en esta pestaña, recuperable al volver al formulario.
10. Vista previa de producto y conversión visible de cajas a unidades durante la solicitud.
11. Errores destacados junto al campo, resumen de problemas y foco en el primer valor que requiere corrección.
12. Estado de guardado y protección contra doble envío; el reintento incierto conserva el identificador del comando.
13. Mapa despejado con recursos a petición, inspector contextual y botón para ocultar paneles.
14. Desplazamiento WASD/flechas, giro Q/E, controles de desplazamiento y ayuda de navegación; escribir en un campo no mueve la cámara.
15. Transiciones de ventanas, tarjetas, borradores y confirmaciones; se respeta la preferencia de reducir movimiento.

Las fotografías y nombres comerciales consultados están documentados en [CATALOGO-FUENTES.md](CATALOGO-FUENTES.md). Las cantidades por caja, existencias y asignaciones de suministro pertenecen al escenario educativo DonPepe; no se presentan como acuerdos comerciales reales.

## 2. Crear, editar, desactivar y eliminar sin romper historia

- Correo de acceso e identificadores únicos; las cuentas eliminadas siguen reservando su identidad histórica.
- No se crea otro administrador, no se degrada al principal, no se desactiva ni elimina su cuenta.
- Cambiar perfil, sucursal, correo o contraseña invalida sesiones afectadas. Archivar invalida también enlaces pendientes.
- Desactivar es reversible y bloquea nuevas operaciones. Eliminar exige desactivación previa, retira el registro del catálogo y no admite recuperación. Se conservan su identidad y referencias históricas; las dependencias y las operaciones pendientes bloquean la retirada.
- Las reglas y permisos usan revisiones optimistas: dos pestañas no pueden sobrescribirse silenciosamente; la segunda debe recargar.
- Un producto conserva unidad por caja, conservación, proveedor compatible y carga máxima. No se cambia su significado físico cuando ya tiene dependencias incompatibles.
- Una sucursal no se sitúa dentro del almacén ni encima de otra. No se mueve con stock o entregas pendientes. La API impide desactivarla o eliminarla si aún tiene usuarios activos asignados.
- Administración configura datos maestros; no tiene un botón de reinicio destructivo ni edita posiciones de robots o mercancía.

## 3. Recuperación y propiedad del correo

El Gmail pertenece a la cuenta, no al remitente SMTP ni a una dirección de prueba común. Para vincularlo se exige contraseña actual y confirmación desde el nuevo buzón. Mientras esa confirmación no se realiza, el Gmail anterior sigue siendo el receptor válido. Un Gmail verificado no se comparte entre identidades y el administrador no puede redirigir el de otro propietario.

La solicitud pública responde de forma genérica y limita intentos. Administración ve una solicitud, su destino y estado de entrega; no un enlace para copiar ni una contraseña. El enlace aleatorio se guarda como hash, caduca a los treinta minutos y se consume una sola vez. El formulario pide repetir la nueva contraseña. La misma política se aplica al cambio propio y a la sustitución administrativa: mínimo de doce caracteres, clases indicadas, máximo real de bcrypt y rechazo de la actual y cinco anteriores. No se almacenan contraseñas recuperables.

Si el envío falla, se conserva una incidencia de entrega y se permite reintento; no se afirma que el usuario recibió un correo. Completar recuperación revoca sesiones y enlaces anteriores. Una cuenta desactivada o eliminada no se reactiva por recuperar una contraseña.

El administrador único tiene una excepción explícita: recuperación directa a su Gmail previamente verificado, auditada, sin una aprobación imposible por otro administrador. Si nunca vinculó un buzón, no se inventa un canal alternativo ni se publica una clave maestra. El propietario del entorno debe resolver esa situación fuera de la interfaz con acceso local autorizado.

El SMTP existente se carga sólo en servidor. La configuración pública está enmascarada y no contiene credenciales. `DONPEPE_PUBLIC_URL` fija el origen de los enlaces al desplegar fuera de localhost. Las pruebas automatizadas usan un buzón ficticio; no acreditan que Google acepte las credenciales reales guardadas en `.env`.

## 4. Casos logísticos cubiertos

| Caso | Respuesta implementada |
|---|---|
| Cantidad negativa, fraccionaria, booleana, excesiva o JSON inválido | Rechazo antes de confirmar cambios. |
| Doble clic o reintento del mismo comando | Recibo idempotente; no duplica stock ni tareas. |
| Reusar el mismo identificador con datos distintos | Conflicto, no se acepta la operación nueva. |
| Solicitar mercancía de proveedor incompatible o desactivado | Rechazo de la línea y reversión de todo el documento. |
| Entrega incompleta o dañada | Recepción parcial y cuarentena; el faltante permanece pendiente. |
| Inventar lote o caducidad para completar el formulario | La interfaz exige los datos de las etiquetas; no los genera automáticamente. |
| Recepción o cuarentena llenas | Error de capacidad antes de recibir; se permite recibir menos. |
| Pedido sin stock suficiente en alguna línea | No se reserva ninguna línea. |
| Dos pedidos compiten por las mismas existencias | Las reservas excluyen cantidades comprometidas. |
| Mercancía retenida, caducada o con vida útil insuficiente | No se ofrece como disponible ni se libera para despacho. |
| El producto vence después de preparar | Despacho bloqueado; se puede retener el pedido y mover las cargas realmente a cuarentena. |
| Equipo averiado con carga | Conserva custodia, posición, misión y reservas hasta recuperación. |
| Destino o estación sin espacio | Reserva anticipada; espera sin descargar encima de otras cargas. |
| Batería insuficiente | Recarga en un cargador reservado antes de una nueva asignación. |
| Conflicto de circulación | Reserva exclusiva de recorrido y espera; no atraviesa otro equipo para completar antes. |
| Cancelar después de recoger o con avería | Rechazo o recuperación segura; cancelar no repara el equipo ni borra la carga. |
| Cambiar prioridad | Sólo trabajo pendiente; no arrebata una carga ya manipulada. |
| Confirmar recepción antes de llegar | Rechazo. La salida no crea inventario de tienda. |
| Llegan menos cajas que las enviadas | Diferencia identificada, separada del stock disponible. |
| Resolver una diferencia o una carga retenida | Baja documentada con motivo, autorización y ajuste del balance. |
| Devolver más de lo recibido, ya vendido o de otro pedido del mismo lote | Rechazo por cantidad y procedencia. |
| Reiniciar el proceso durante una misión | Recupera estado y recibos persistidos; no vuelve a entregar dos veces. |

No se afirma que estos casos agoten todas las situaciones posibles. Las pruebas establecen una cobertura concreta; la validación industrial, las averías físicas y las normas sanitarias requieren ingeniería y evidencias adicionales.

## 5. Representación y rendimiento

La escena sigue los datos del servidor. Interpola poses por tiempo, conserva los puntos del recorrido y amortigua giros y cámara sin decidir tareas. Cajas y palés caben en sus plataformas; las estaciones disponen de plazas separadas; el mástil del transelevador permanece en su raíl y extiende las horquillas.

Normal y rugosidad procedurales añaden relieve a concreto, metal, madera y cartón sin descargar texturas externas. Geometrías y materiales se comparten. La calidad automática reduce el coste si detecta tiempos altos; se puede elegir detalle alto, equilibrado o ahorro. En reposo se deja de dibujar. Una GPU simulada o una computadora distinta no permite prometer sesenta fotogramas por segundo.

## 6. Referencias primarias consultadas

- [Mecalux: Easy WES](https://www.mecalux.es/software/wes-sistema-ejecucion-almacenes): coordinación, prioridad y disponibilidad de recursos. Se utiliza como inspiración del flujo, no como matriz RBAC oficial del fabricante.
- [Mecalux: Easy WCS](https://www.mecalux.es/software/wcs-sistema-control-almacenes): ejecución y visibilidad de equipos e incidencias. DonPepe no se conecta a su producto.
- [OWASP: autorización](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html): mínimo privilegio, comprobación por petición y denegación por defecto.
- [OWASP: recuperación de contraseña](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html): mensajes uniformes, token aleatorio temporal de un uso y revocación de sesiones.
- [Google: contraseñas de aplicación](https://support.google.com/accounts/answer/185833?hl=es): configuración del acceso SMTP de Gmail; no demuestra la vigencia de una clave particular.

Consulta: 17 de octubre de 2026. La separación concreta de DonPepe es una decisión propia del proyecto, no un estándar obligatorio impuesto por Mecalux.
