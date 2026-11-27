# Responsabilidades y accesos WMS

Las tres responsabilidades de sistema son plantillas protegidas, no una jerarquía
en la que el administrador herede la ejecución física. El administrador único
puede crear roles personalizados derivados del escritorio operativo o de la
terminal RF. No se crean cuentas de prueba ni se elimina inventario al migrar.

| Recurso / acción | Administrador WMS | Jefe de operaciones | Operador RF |
| --- | --- | --- | --- |
| Usuarios, recuperación de contraseñas | Gestionar | Sin acceso | Cambiar su propia clave |
| Roles y permisos | Crear y editar roles personalizados | Sin acceso | Sin acceso |
| Correo personal / contraseña propios | Mi cuenta / Mi clave | Mi cuenta / Mi clave | Mi cuenta / Mi clave |
| Categorías, marcas, proveedores, zonas, LOC, sucursales | Gestionar maestros | Consultar contexto operativo | Consultar por escaneo |
| SKU | Crear, editar maestro, desactivar conservando historial | Consultar y editar solo estrategia logística | Consultar por escaneo |
| Compras | Crear, consultar, cancelar según estado | Sin acceso al módulo comercial | Recibir órdenes pendientes desde RF |
| Traslados / reabastecimiento | Consultar trazabilidad | Crear, asignar RF, cancelar según estado | Ejecutar solo tareas asignadas |
| Picking / put-away / retorno | Consultar | Supervisar y delegar | Ejecutar tareas asignadas |
| Pedidos internos | Consultar; gestionar maestro de sucursales | Crear, planificar, registrar despacho y retorno | Ejecutar picking y traslado de retorno |
| Conteos | Consultar, aprobar o rechazar diferencias | Registrar y consultar, sin aprobar | Registrar desde RF, sin ajustar stock |
| Reportes de valoración / exportación | Acceso | Sin acceso | Sin acceso |
| Lotes / movimientos / mapa / stock LOC | Consultar | Consultar y planificar | Consulta RF contextual |

## Controles

- `config/permissions.js`: plantillas inmutables y comprobación por capacidades,
  denegación por defecto. `permisos` y `roles_permisos` contienen los permisos
  efectivos de cada rol; las rutas los comprueban antes de ejecutar controladores.
- El middleware refresca identidad, rol y estado desde la base de datos en cada
  acceso protegido. Desactivar o cambiar un rol afecta también sesiones abiertas.
- Los servicios transaccionales de recepción, tareas, conteos y distribución
  vuelven a consultar la autoridad persistida. Un parámetro `role` no otorga acceso.
- RF solo muestra tareas asignadas al operador. Iniciar/completar valida propietario;
  completar exige origen, SKU/lote/HU y destino. No hay confirmación física desde
  escritorio ni override administrativo que omita escaneos.
- Recepción y put-away automático conservan el flujo existente: admin emite OC,
  RF recibe, sistema propone tarea, jefe asigna, RF ejecuta. Picking nace del pedido
  interno; no de una tarea libre.
- El jefe registra diferencias; el administrador decide. Una persona no puede
  aprobar su propio conteo, incluso si su rol cambió posteriormente. El stock se
  revalida bajo bloqueo transaccional antes de aprobar.
- La gestión de SKU del jefe usa validadores y actualización con lista explícita de
  columnas logísticas. No acepta cambios comerciales ni de proveedor/precios.
- Desactivar maestros conserva la trazabilidad; esta reforma no borra datos.

## Roles personalizados

`/roles` es exclusivo del administrador. El formulario define nombre único,
responsabilidad (12–255 caracteres), interfaz, estado y permisos agrupados por
recurso. Buscar filtra al instante. Marcar una acción incluye sus dependencias de
consulta; retirar una dependencia retira las acciones relacionadas. El servidor
vuelve a validar esa coherencia y no confía en las casillas del navegador.

Los permisos de gobierno (usuarios, roles, compras, recuperación, aprobación de
ajustes y reportes financieros) no se delegan. Los roles operativos no ejecutan
RF; los RF no planifican ni administran. Ejecutar una tarea exige además la
capacidad del tipo concreto y que esté asignada al usuario. No hay borrado de
roles con trazabilidad: se desactivan cuando ya no tengan usuarios asignados.
Modificar interfaz o desactivar un rol exige reasignar primero sus cuentas. Las
plantillas de sistema sólo se consultan. Crear/editar deja un evento antes/después.

## Administrador único

La migración conserva a `frank@minimarket.com` si existe; en otro entorno conserva
al administrador activo más antiguo. Los administradores adicionales se reasignan
a jefe de operaciones y quedan registrados en `seguridad_eventos`, sin borrar
cuentas ni sus operaciones. En la base actual, Aaron fue reasignado; Frank sigue
siendo el único administrador.

La columna generada `usuarios.administrador_unico` utiliza el ID real del rol y un
índice UNIQUE impide una segunda cuenta administradora. Los servicios no permiten
desactivar ni cambiar el rol del administrador existente. Esto impide perder al
único administrador desde la aplicación. Un propietario que haya perdido su
acceso y no conserve otra sesión debe acudir a mantenimiento autorizado del
servidor con verificación de identidad: no se añade un acceso público que eluda la
aprobación ni se crea un segundo administrador para resolverlo.

## Correo personal de recuperación

Se eliminó el receptor global. La aprobación obtiene `correo_recuperacion` de la
cuenta vigente; los reinicios y la semilla no sobrescriben este campo. Crear/editar
otra cuenta permite al administrador registrar su correo individual, Gmail u otro
proveedor. Cada usuario dispone de `/mi-cuenta`, también en RF: confirma su clave,
recibe un enlace de 30 minutos en la nueva dirección y lo confirma autenticado.
Hasta esa confirmación conserva el correo anterior. El token está hasheado, ligado
al propietario y es de un uso. Se limita el envío a cinco solicitudes por hora y
cuenta. Cambiar el correo invalida enlaces de recuperación ya aprobados. SMTP
fallido no reemplaza la dirección anterior. Recuperar una clave no reactiva cuentas
bloqueadas. La aprobación o renovación siguen reservadas al administrador.

## Presentación

Administrador: centro de control oscuro, compras, seguridad, aprobaciones y
analítica. Jefe: centro operativo claro, delegación y seguimiento del turno.
Operador: interfaz RF autónoma móvil. Los enlaces y botones de escritura siguen
la misma matriz del servidor. Las etiquetas impresas mantienen blanco/negro para
legibilidad y lectura de QR, independientemente del tema.

Del prompt maestro se adoptan separación de responsabilidades, capabilities en
servidor, segregación de funciones y distinción visual. No se migra a API-first/JWT.
El módulo de roles personalizados y Mi cuenta responden a la petición posterior.

Referencias de seguridad: [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html),
[OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
y [verificación de correo](https://cheatsheetseries.owasp.org/cheatsheets/Email_Validation_and_Verification_Cheat_Sheet.html).
