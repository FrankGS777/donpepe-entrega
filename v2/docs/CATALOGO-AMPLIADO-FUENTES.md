# Catálogo ampliado: procedencia y controles

Fecha de consulta y comprobación: **17 de octubre de 2026**.

Se incorporan **119 productos reales adicionales**, con **83 marcas de referencia** y **12 familias comerciales**. Se conservan las doce identidades originales. Los registros ampliados son datos maestros: no crean existencias, lotes, ubicaciones ocupadas ni compras recibidas. Su inventario comienza al confirmar una recepción dentro del flujo normal.

## Proveedor comprobado

La ampliación utiliza **Corporación Vega**, identidad `PROV-1`, como proveedor de estos 119 productos. La asociación se apoya en dos comprobaciones:

1. Cada ficha pública tiene el vendedor **CORPORACIÓN VEGA**, el producto, su código comercial, su marca y una fotografía.
2. La [página oficial de ventas corporativas](https://www.vega.pe/ventas-corporativas) ofrece abastecimiento empresarial por volumen y enumera fabricantes de su portafolio, entre ellos Nestlé, Alicorp, Gloria, Molitalia y Coca-Cola. El correo de ventas y teléfono del registro proceden de ese canal público.

Una publicación en el catálogo acredita que Vega comercializa esa referencia al momento de la consulta. No acredita distribución exclusiva, propiedad de la marca, disponibilidad futura ni un contrato comercial con DonPepe. La relación concreta de compra y el plazo de entrega de DonPepe pertenecen a la simulación académica.

Los otros proveedores del sistema se conservan. Esta ampliación no atribuye marcas ajenas a Alicorp ni convierte a un fabricante en distribuidor universal.

## Surtido y condiciones de almacenamiento

| Familia                    | Productos | Condición del catálogo                             |
| -------------------------- | --------: | -------------------------------------------------- |
| Aceites                    |        10 | Envases comerciales cerrados                       |
| Arroces                    |        10 | Bolsas de peso fijo                                |
| Azúcar y endulzantes       |         9 | Bolsas y frascos cerrados                          |
| Pastas y fideos            |        10 | Pastas secas envasadas                             |
| Conservas                  |        10 | Latas, bolsas y recipientes sellados               |
| Salsas de mesa             |        10 | Envases sin abrir                                  |
| Condimentos y sazonadores  |        10 | Sobres, bolsas y botellas selladas                 |
| Galletas y golosinas       |        10 | Envases comerciales de peso fijo                   |
| Bebidas sin alcohol        |        10 | Botellas y multipacks comerciales cerrados         |
| Snacks                     |        10 | Bolsas y recipientes cerrados                      |
| Desayuno y despensa láctea |        10 | Café, infusiones, cereales y productos de despensa |
| Harinas y repostería       |        10 | Productos secos y recipientes de larga duración    |
| **Total adicional**        |   **119** | **Sin inventario inicial**                         |

Todas estas nuevas referencias corresponden a la reserva seca `DRY`, temperatura `AMBIENT`. Se excluyeron productos de cadena fría, productos frescos, venta por peso variable, tabaco, alcohol, electrónica y artículos de hogar ajenos al surtido seleccionado. La condición de despensa se aplica a envases originales sin abrir; después de abrirlos rigen las indicaciones del fabricante, fuera del movimiento de cajas cerradas que representa este WMS.

La categoría agrupa productos comerciales; la zona indica dónde se almacenan. No son el mismo dato. Por ejemplo, café y arroz pertenecen a categorías distintas y comparten la reserva seca.

## Evidencia por producto

El archivo [`expanded-catalog.json`](../core/expanded-catalog.json) registra individualmente:

- Nombre y marca tal como los publica el proveedor.
- Presentación y GTIN del artículo exacto. El **GTIN** es el identificador comercial que suele imprimirse como código de barras; no es el código interno del sistema.
- Identificador del producto y del artículo en el catálogo original.
- Enlace a la ficha comercial y consulta pública que permite reproducir la comprobación.
- Vendedor que ofrece el artículo y clasificación publicada.
- URL original de la fotografía, copia local WebP, tamaño y resumen SHA-256 para detectar sustituciones o archivos dañados.
- Fecha de comprobación, categoría, marca y proveedor relacionados por identidad estable.

Ejemplos comprobables:

| Producto                                     | Ficha del proveedor                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Aceite de oliva Timonel extra virgen, 500 ml | [Vega](https://www.vega.pe/aceite-de-oliva-timonel-extra-virgen-botella-500ml-20251/p)   |
| Arroz superior Faraón, 5 kg                  | [Vega](https://www.vega.pe/arroz-superior-faraon-bolsa-5kg-570365/p)                     |
| Spaghetti Molitalia, 950 g                   | [Vega](https://www.vega.pe/fideos-spaghetti-molitalia-950g-320523/p)                     |
| Trozos de atún Florida, 140 g                | [Vega](https://www.vega.pe/trozos-de-atun-florida-en-aceite-vegetal-lata-140gr-190470/p) |
| Mayonesa Alacena, 850 g                      | [Vega](https://www.vega.pe/mayonesa-alacena-doypack-850g-670232/p)                       |
| Galletas Morochas, seis paquetes de 30 g     | [Vega](https://www.vega.pe/galletas-morochas-pack-6u-paquete-30g-149603/p)               |
| Café Altomayo Gourmet, 170 g                 | [Vega](https://www.vega.pe/cafe-instantaneo-altomayo-gourmet-frasco-170g-230040/p)       |

## Tratamiento de las fotografías

Las **119 fotografías de producto son fotografías reales del catálogo del proveedor**. Se guardan localmente para que la interfaz no dependa de conexiones a terceros al abrir una ficha. Se redujeron a un máximo de 600 × 600 píxeles en WebP; las 119 imágenes principales suman aproximadamente **3,13 MB** y la mayor ocupa menos de 60 KB.

Cada marca y categoría dispone de su propio recurso local de imagen, tomando una fotografía real de un producto de esa marca o familia. Es una **imagen representativa del surtido**, no un logotipo corporativo aislado. Las marcas llevan `imageKind: REAL_PRODUCT_REFERENCE` para que la interfaz pueda comunicar esa diferencia. El logotipo corporativo de Vega conserva el recurso oficial ya existente.

## Datos reales y parámetros de simulación

| Dato                                                    | Procedencia                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Nombre, marca, GTIN, presentación, vendedor, fotografía | Ficha pública del proveedor                                                   |
| Categoría comercial del proveedor                       | Catálogo público y revisión de coherencia                                     |
| Agrupación en doce categorías DonPepe                   | Organización de datos maestros para la aplicación                             |
| Zona de reserva seca y condición ambiente               | Modelo logístico de DonPepe para artículos de despensa cerrados               |
| Caja logística de 12 envases                            | Parámetro editable del escenario DonPepe                                      |
| Máximo de 24 cajas por unidad de carga                  | Parámetro editable del escenario DonPepe                                      |
| Punto de reposición                                     | Configuración de planificación de DonPepe                                     |
| Existencias, lotes y fechas de recepción                | Se producen con las operaciones del sistema; no proceden del comercio externo |

La **unidad de carga** es el conjunto que transporta un equipo, por ejemplo una paleta con cajas. No debe confundirse un multipack comercial de seis unidades con seis cajas logísticas. El sistema conserva la presentación comercial exacta y declara por separado su agrupación logística de simulación. Antes de un uso productivo deben confirmarse caja, peso, dimensiones, apilabilidad y condiciones de conservación con el proveedor y el fabricante.

## Validaciones de la importación

La importación es deliberadamente conservadora:

1. Admite solamente GTIN numéricos de longitud válida y dígito de control correcto.
2. Compara los códigos normalizados a catorce posiciones: un UPC de doce cifras no puede duplicar el mismo producto expresado con ceros a la izquierda.
3. Excluye los GTIN de las doce referencias originales y cualquier identidad de producto repetida.
4. Rechaza kits virtuales, códigos vacíos, números internos cortos y cadenas dañadas como notación científica.
5. **Descarta tres GTIN ambiguos del propio catálogo de origen**, compartidos por referencias diferentes. Un código correcto matemáticamente no basta si identifica productos contradictorios.
6. Comprueba que el vendedor de cada artículo corresponde a Vega.
7. Revisa la coherencia entre el nombre y la familia comercial: se detectó y excluyó, por ejemplo, un alimento para mascotas publicado por el proveedor dentro de aguas.
8. Comprueba la fotografía, formato, dimensiones mínimas y resumen de integridad. La revisión visual también excluyó una ficha de harina de 180 g cuya fotografía oficial mostraba una bolsa de 1 kg; se sustituyó por una referencia de 1 kg con nombre y foto coincidentes.
9. Resuelve marca, categoría y proveedor sin referencias huérfanas ni nombres duplicados al normalizar espacios, mayúsculas y tildes.
10. Mantiene intactas las doce identidades originales y no genera stock ficticio durante la carga de maestros.

Resultado: **119 GTIN distintos válidos**, de los cuales 117 tienen trece cifras y dos son UPC de doce cifras. Las marcas compartidas con el surtido original —Primor, Costeño, Don Vittorio y Gloria— utilizan una misma identidad normalizada.

Las pruebas deterministas están en [`expanded-catalog.test.js`](../tests/expanded-catalog.test.js). Se pueden ejecutar sin conexión y comprueban identidad, relaciones, integridad de fotos, GTIN y separación entre fuentes comerciales e inventario.

## Fuentes y reproducción

- [Catálogo oficial de abarrotes de Vega](https://www.vega.pe/abarrotes).
- [Aceites y marcas comercializadas por Vega](https://www.vega.pe/abarrotes/aceite).
- [Ventas corporativas y abastecimiento empresarial de Vega](https://www.vega.pe/ventas-corporativas).
- [API pública oficial de productos](https://www.vega.pe/api/catalog_system/pub/products/search).
- [Árbol público de categorías](https://www.vega.pe/api/catalog_system/pub/category/tree/3).

El script [`import-verified-catalog.cjs`](../scripts/import-verified-catalog.cjs) reproduce la consulta y la descarga de imágenes. No abre la base de datos de la aplicación. Usa la biblioteca de imágenes del entorno; en otros equipos se puede indicar su ruta mediante `DONPEPE_SHARP_MODULE`. Los datos de terceros pueden cambiar: una actualización del archivo debe revisarse como una nueva importación de maestros y conservar las identidades ya utilizadas por operaciones históricas.
