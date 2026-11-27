# DonPepe · Gestión de almacenes

Sistema web para gestionar el inventario de un centro de distribución y abastecer sus sucursales. Simula la recepción de proveedores, la preparación de pedidos y el despacho. El mapa 3D permite seguir las cargas y consultar el estado de los equipos.

Proyecto de **Curso Integrador II**. Integrantes: Frank Ginocchio Saavedra, Aaron Yuri Gomez Chiro, Renzo Chavez Moya y Alvaro Serrano Reyes.

## Descargar y ejecutar

Necesitas **Node.js 24** y un navegador con aceleración gráfica para el mapa. Descarga el proyecto con **Code → Download ZIP**, descomprímelo y abre una terminal en la carpeta que contiene `package.json`.

```sh
npm ci
npm run build:v2
npm start
```

Abre [http://127.0.0.1:3010](http://127.0.0.1:3010). La primera ejecución prepara las bases SQLite y un escenario de demostración. Para apagar el servidor, pulsa **Ctrl+C** en la terminal.

### Accesos de demostración

La contraseña de las tres cuentas locales es `DonPepe2026!`. También puedes seleccionar cada perfil en **Accesos de demostración**.

| Perfil | Correo | Qué puedes probar |
| --- | --- | --- |
| Administración | `admin@donpepe.local` | Usuarios, permisos, catálogos, mantenimiento y auditoría |
| Operaciones | `operaciones@donpepe.local` | Recepción, pedidos, inventario, movimientos y mapa 3D |
| Tienda | `tienda@donpepe.local` | Reposición, seguimiento e inventario de San Miguel |

## Recorrido de prueba

1. Entra como **Operaciones**. En **Pedidos**, libera la preparación de un pedido pendiente con existencias suficientes.
2. Abre **Mapa → Abrir mapa 3D**. Cambia a **Interior** y observa la preparación. En **Exterior** puedes seguir el despacho.
3. Consulta **Movimientos** para ver el origen, destino, lote y cantidad de cajas. El código **HU** identifica la unidad logística que agrupa las cajas.
4. En **Recepción**, solicita mercancía a un proveedor. El escenario simula la descarga, la identificación y la inspección. Las cajas observadas quedan segregadas y las aceptadas pasan a almacenamiento.
5. Entra como **Tienda** y crea una solicitud de reposición. Luego abre **Pedidos** con Operaciones para autorizar su preparación.

Las bases guardan el avance local entre sesiones. El proyecto utiliza datos ficticios y simula los equipos, sensores y movimientos.

## Estructura y comprobaciones

- `v2/server.js` sirve la aplicación Express y coordina las operaciones.
- `v2/core/` contiene las reglas del almacén, el motor de simulación y el kardex.
- `v2/frontend/` contiene las interfaces y el mapa Three.js.
- `v2/public/` contiene los recursos que utiliza el navegador.
- `v2/tests/` contiene las pruebas. Ejecútalas con `npm run test:v2`.

La aplicación anterior con MySQL se conserva en la raíz. El recorrido anterior utiliza exclusivamente la versión actual con SQLite.
