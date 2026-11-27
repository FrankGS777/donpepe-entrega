# Datos maestros, activos y mantenimiento

## Responsabilidades

| Recurso | Administración | Operaciones | Tienda |
| --- | --- | --- | --- |
| Productos, marcas, categorías y proveedores | Crear, editar, desactivar, activar y eliminar | Consultar para operar | Consultar artículos disponibles para solicitar |
| Sucursales y reglas del sistema | Configurar, desactivar y eliminar con comprobación de dependencias | Consultar destinos | Consultar su propia sucursal |
| Equipos registrados | Alta administrativa, ficha técnica y retirada segura | Consultar y comunicar incidencias | Sin acceso |
| Mantenimiento | Aprobar, programar, iniciar y cerrar con inspección documentada | Solicitar y seguir su resolución | Sin acceso |
| Solicitud de reabastecimiento | Sin suplantar a la tienda | Revisar, priorizar, preparar y despachar | Crear y editar su solicitud pendiente |
| Compra a proveedor | Configurar los datos del proveedor y catálogo | Emitir, cancelar antes de llegada y recibir | Sin acceso |

Los permisos configurables tienen un techo de responsabilidad. Marcar una casilla no convierte al administrador en operador ni permite a una tienda consultar otra sucursal.

## Catálogo ampliado

La migración conserva las identidades, las existencias, las reservas y los documentos anteriores. Añade 119 referencias públicas verificadas al catálogo original de 12 productos: 131 artículos en total. Los artículos adicionales se incorporan sin existencias; para disponer de ellos es necesario solicitar suministro y registrar su recepción.

Marca y categoría son registros propios, con descripción e imagen, y no simples textos sueltos. Una marca identifica sus proveedores; una categoría indica las condiciones de conservación compatibles. Al seleccionar un producto se comprueban ambas relaciones, el estado de los maestros y la zona del proveedor. No se desactiva una marca o categoría que utilice un producto activo. Eliminar requiere desactivación previa y ausencia de productos vinculados, incluso desactivados.

Las fotografías de los artículos ampliados proceden de sus fichas públicas. La imagen de una marca puede ser un producto representativo de esa marca; no se presenta como un logotipo oficial. Las cajas por embalaje y capacidades logísticas del escenario son parámetros didácticos, no certificaciones de embalaje comercial. Las fuentes se guardan en `expanded-catalog.json` y se documentan en el informe de catálogo.

Se valida el dígito de control de los GTIN y su unicidad canónica: un UPC de 12 dígitos y el mismo código completado hasta 14 dígitos identifican el mismo artículo. Un producto que ya participa en movimientos no puede cambiar su identidad comercial ni sus características físicas para representar otro artículo.

## Equipos y seguridad operativa

El registro inicial contiene 17 activos vinculados al circuito: seis AMR, dos transelevadores, una transferencia de congelados, dos montacargas de muelle, tres camiones y tres cargadores. Sus fichas incluyen clase, fabricante, modelo, serie única, capacidad, conservación, fecha de alta, garantía, imagen e intervalo de servicio.

Dar de alta otra ficha registra un equipo planificado. No crea silenciosamente un robot en el mapa: para integrarlo hacen falta una representación física compatible, recorridos y puntos de transferencia válidos. Las capacidades y la clase de un activo ya conectado no se cambian mediante la ficha administrativa.

Las imágenes de instalaciones y equipos generadas para DonPepe se identifican como representaciones. No implican que exista una instalación física, un modelo comercial específico, una conexión industrial o telemetría real.

## Ciclo del mantenimiento

1. Operaciones comunica una necesidad indicando equipo, tipo y motivo. Solo se admite un expediente abierto por activo.
2. Administración aprueba la solicitud, asigna un técnico o empresa y define entre dos y veinte comprobaciones. Los planes de cada clase incluyen controles de seguridad y funcionamiento apropiados.
3. Al solicitar el inicio se impiden nuevas asignaciones a ese activo. Si ya transporta mercancía, conserva su misión, la carga y las reservas hasta terminar.
4. Un AMR vuelve vacío a su plaza de estacionamiento con las reservas de circulación habituales. No queda inmovilizado en consolidación ni en un pasillo de trabajo. Un cargador ocupado espera a terminar la carga eléctrica; un camión espera a estar disponible y sin mercancía ni reserva de muelle.
5. Al alcanzar una condición segura, el activo pasa a servicio. No participa en nuevas misiones, cargas de camiones, transporte inverso ni asignaciones de recarga mientras esté retirado.
6. El cierre exige técnico, fecha real del servicio, coste con hasta dos decimales, informe y confirmación de todas las comprobaciones previstas. Solo entonces se libera el activo. El software registra el servicio declarado; no simula una reparación mecánica automática.

Estados admitidos:

`REQUESTED → APPROVED → WAITING_SAFE → IN_PROGRESS → COMPLETED`

Una solicitud pendiente se puede rechazar. Antes de comenzar el servicio se puede cancelar con motivo; un servicio ya iniciado requiere su cierre técnico. El historial se conserva y sobrevive al reinicio. Las horas de uso incluyen el trabajo que termina durante la espera de retirada y excluyen el tiempo inmovilizado en servicio.

## Validaciones y concurrencia

Los formularios de maestros y mantenimiento reúnen errores por campo para poder mostrarlos simultáneamente. Se comprueban textos, longitudes, tipos, fechas de calendario, orden de fechas, duplicados normalizados, referencias, imágenes locales, capacidades, listas de inspección y transiciones de estado. No se acepta un coste negativo, una fecha imposible ni un cierre sin revisión completa.

Cada modificación de configuración exige su revisión actual. Cada edición de una solicitud de tienda exige también la revisión de esa solicitud. Si otra sesión modificó los datos, se devuelve un conflicto en lugar de sobrescribirlos. Los comandos con identificador de operación son idempotentes; repetirlo con un contenido diferente se rechaza. Las validaciones y los cambios se ejecutan en transacciones: cualquier fallo conserva el estado anterior.

Las solicitudes de tienda pueden indicar una fecha deseada entre el día de la simulación y los siguientes 90 días; es una preferencia de entrega, no una promesa automática. Operaciones dispone de una previsualización de disponibilidad, faltantes, lotes FEFO y etapas antes de liberar. La consulta no reserva mercancía. Cancelar una solicitud exige un motivo documentado y respeta las restricciones de carga ya recogida; cancelar una compra se permite solamente antes de su llegada y recepción.


## Estados de los registros

Productos, proveedores, sucursales, marcas, categorías y activos utilizan las mismas acciones: desactivar, activar y eliminar. No existe la acción Archivar. Los registros desactivados conservan su ficha y pueden activarse después de validar sus referencias. Los eliminados se retiran de los catálogos y no pueden editarse ni reactivarse; se conserva una referencia interna para documentos, auditoría y trazabilidad, sin reutilizar sus identificadores.

No se retiran registros con existencias, documentos o maniobras pendientes. La eliminación comprueba también dependencias de registros desactivados. Las sucursales protegen sus cuentas vinculadas y equipos. Un activo integrado al circuito físico puede desactivarse cuando está seguro, pero su ficha no se elimina; los activos planificados sin integración sí pueden eliminarse. No se desactiva el último cargador disponible si quedan robots activos.
