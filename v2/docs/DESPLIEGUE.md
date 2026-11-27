# Despliegue de DonPepe V2

## Demostración en el equipo local

```bash
npm ci
npm run build:v2
npm start
```

Abre `http://127.0.0.1:3010`. La alternativa `docker compose -f compose.v2.yml up --build` deja la demostración disponible únicamente en el equipo local. Los datos personales permanecen fuera del contexto de construcción de Docker.

## Publicación en Railway

1. Crea un servicio para DonPepe en un proyecto separado de MoveGo. Revisa el plan y el consumo del espacio de trabajo antes de activar el servicio.
2. Selecciona `Dockerfile.v2` con `RAILWAY_DOCKERFILE_PATH=Dockerfile.v2`. Configura `/health` como comprobación de arranque, una sola instancia y desactiva la suspensión automática si la simulación debe seguir avanzando con el navegador cerrado.
3. Monta un volumen dedicado en `/data` y configura `DONPEPE_DATA_DIR=/data`. El proceso de aplicación corre como `node`. Si Railway fuerza el usuario del contenedor, `RAILWAY_RUN_UID=0` permite que el arranque prepare el volumen y baje privilegios antes de ejecutar el servidor.
4. Genera el dominio HTTPS y define las variables de la tabla antes de iniciar la primera instalación. El servidor usa el `PORT` de la plataforma o `3010` si no está definido.
5. Entra con la cuenta inicial y crea una cuenta de Operaciones y otra de Tienda desde Administración. Asigna la tienda a su sucursal. Usa contraseñas distintas y entrega cada una por un canal privado.

| Variable | Valor o propósito |
| --- | --- |
| `DONPEPE_MODE` | `cloud`. Es el modo predeterminado de la imagen V2. |
| `DONPEPE_PUBLIC_URL` | Origen HTTPS del servicio, sin rutas. |
| `DONPEPE_DATA_DIR` | `/data`, con volumen persistente y permisos de escritura. |
| `DONPEPE_ADMIN_EMAIL` | Correo de la cuenta inicial, en una instalación nueva. |
| `DONPEPE_ADMIN_PASSWORD` | Secreto único de la cuenta inicial. Puede retirarse tras comprobar el primer acceso. |
| `DONPEPE_TRUST_EDGE` | `true` si la app se alcanza exclusivamente por un proxy de confianza que sobrescribe cabeceras reenviadas. De lo contrario, omítela. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Datos del servicio SMTP, si el plan permite la conexión saliente. Valida la entrega con una cuenta propia. |

El modo nube crea solo la cuenta administradora inicial en una base nueva. El servicio exige un origen HTTPS, marca la sesión como `Secure` y rechaza solicitudes de escritura con un origen externo. Si se requiere inicializar nuevamente, provisiona un volumen nuevo y conserva la copia anterior para restauración.

## Copias y restauración

Las bases `identity.sqlite` y `simulation.sqlite` forman un par. Con el servicio detenido, copia las dos a una carpeta nueva que quede fuera del repositorio y del volumen de trabajo. El comando valida la integridad de cada archivo y evita sobrescribir un destino existente.

```bash
node v2/scripts/backup-data.cjs copy-offline /ruta/datos /ruta/copia-nueva
```

Para restaurar, repite el comando usando la copia como origen y un directorio vacío aún sin crear como destino. Configura ese destino como directorio de datos del nuevo despliegue. Comprueba acceso, inventario, movimientos y la factura de una orden conocida antes de habilitar el tráfico. Protege el acceso a las copias porque contienen información de cuentas.

## Pruebas de aceptación

1. Administración crea las cuentas con sus permisos y consulta una factura. La tienda recibe un rechazo si solicita el PDF interno del proveedor.
2. Operaciones crea una compra y revisa la factura generada. Inspecciona la recepción autónoma y confirma que los productos aptos se almacenan y los observados quedan en cuarentena.
3. Tienda crea un pedido de cajas. Operaciones lo autoriza. Comprueba preparación, carga, entrega y los movimientos del mismo lote.
4. Reinicia el servicio y verifica que el inventario, los pedidos y las facturas coinciden con el estado previo. Ejecuta `npm run test:v2` para las pruebas automatizadas y `npm audit --omit=dev` para las dependencias de producción.
5. Mide el tiempo de arranque, el tamaño de respuesta de `/api/state`, el consumo de memoria y el tráfico del mapa. En el navegador comprueba Chrome y Safari, con WebGPU o la alternativa WebGL según el equipo.

Referencias de Railway: [Dockerfiles](https://docs.railway.com/builds/dockerfiles), [volúmenes](https://docs.railway.com/volumes), [comprobación de salud](https://docs.railway.com/deployments/healthchecks) y [control de gasto](https://docs.railway.com/pricing/cost-control).
