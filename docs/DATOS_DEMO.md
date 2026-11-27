# Datos maestros de demostración

La carga inicial incluye SKU variados, categorías, marcas, proveedores corporativos, zonas WMS normalizadas, LOC activas, lotes, una orden de compra pendiente y una cola de tareas RF. Se ejecuta de forma idempotente: los registros de demostración no se duplican al volver a correr `npm run db:seed`.

Los SKU secos comparten `PCK-SECO-01` y `RSV-SECO-01`; los que necesitan frío usan `PCK-FRIO-01`/`RSV-FRIO-01`; los congelados usan `PCK-CONG-01`/`RSV-CONG-01`. La categoría comercial no crea una cara de picking propia.

## Usuarios de demostración

| Rol | Usuario | Contraseña | Uso esperado |
| --- | ------- | ---------- | ------------ |
| Administrador WMS | `frank@minimarket.com` | `admin123` | Gobierno general, catálogos, usuarios, reportes y control total. |
| Jefe de operaciones | `carlos@minimarket.com` | `operaciones123` | Torre WMS, planificación y asignación de tareas, ubicaciones, stock y auditorías operativas; sin acceso a compras ni reportes gerenciales. |
| Operador RF | `ana@minimarket.com` | `rf123456` | Menú móvil RF, receiving, check-in, picking, transfer, count y returns. |

## Alcance y veracidad

- Las razones sociales, marcas asociadas, canales públicos y sitios web se contrastaron con fuentes corporativas.
- Los 42 SKU incluyen imagen HTTPS de la presentación concreta y enlace a la ficha pública usada como referencia. No se usan fotos genéricas para representar un producto conocido.
- Los EAN se contrastaron cuando la ficha pública los expone; los costos, precios, cantidades, lotes, dimensiones y vencimientos son datos coherentes de demostración y no representan un acuerdo comercial.
- En producción, importa el maestro aprobado por compras, cambia credenciales y reemplaza los datos demo por acuerdos reales.
- La cola RF incluye ejemplos de reabastecimiento, picking, devolución de ruta y recepción pendiente para probar la interfaz móvil.

## Relación proveedor–portafolio usada

| Proveedor | Marcas o familias del escenario |
| --- | --- |
| Arca Continental Lindley S.A. | Coca-Cola, Inca Kola, Fanta, Sprite y San Luis |
| Leche Gloria S.A. | Gloria: leche evaporada, UHT, yogurt y mantequilla |
| Alicorp S.A.A. | Primor, Don Vittorio, Nicolini, AlaCena, Casino, Bolívar y Sapolio |
| Unión de Cervecerías Peruanas Backus y Johnston S.A.A. | Cristal, Pilsen Callao, Cusqueña y San Mateo |
| Molitalia S.A. | Molitalia, Costa, Ambrosoli, Pomarola, Fanny, Mimaskot y Nutrican |
| Nestlé Perú S.A. | Sublime, Morochas, Ideal, Nescafé, Milo, Zucosos y D'Onofrio |

La relación no se limita a la interfaz: `productos.proveedor_id` es el catálogo autorizado del SKU. Compras exige seleccionar primero el proveedor, filtra sus productos en el navegador y vuelve a comprobar la pertenencia en el servidor antes de crear la orden.

## Fuentes visuales

- Logos y relación corporativa: [Arca Continental Lindley](https://www.arcacontinentallindley.pe/), [Alicorp](https://www.alicorp.com.pe/pe/es), [Backus](https://www.backus.pe/), [Molitalia](https://www.molitalia.com.pe/), [Nestlé Perú](https://www.nestle.com.pe/) y [Leche Gloria](https://www.gloria.com.pe/).
- Presentaciones: fichas públicas de [Plaza Vea](https://www.plazavea.com.pe/) y [Vega Perú](https://www.vega.pe/) enlazadas individualmente en `productos.referencia_url`.
- Las URL se mantienen desde los formularios de proveedor y SKU. Si una imagen externa deja de estar disponible, se presenta `/images/resource-fallback.svg` y nunca se intenta adivinar otra fotografía.

## Cómo regenerar datos

Para actualizar una base existente sin borrar el volumen:

```bash
docker compose exec app npm run db:seed
```

Para reconstruir todo desde cero se puede eliminar el volumen de base de datos y levantar nuevamente el entorno. Esa acción borra los datos locales del contenedor.
