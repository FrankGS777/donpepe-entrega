# Fotografías y datos maestros del catálogo

Consulta y descarga: 17 de octubre de 2026. Las imágenes son fotografías públicas de los productos comerciales; no son imágenes generadas ni envases reconstruidos. Se conservaron las marcas y los empaques tal como aparecen en las fuentes. Las referencias externas sirven para comprobar la identidad del artículo y no para consultar stock ni precios del escenario DonPepe.

Las doce fotografías se descargaron del catálogo público de Metro Perú y se guardaron localmente en `v2/public/images/catalog/` como WebP de hasta 600 × 600 píxeles. Por ello, las vistas no dependen de que el navegador pueda conectarse al comercio. Los tres logotipos se descargaron de los sitios oficiales de cada proveedor; los SVG originales de Makro y Alicorp se rasterizaron a PNG preservando sus colores y transparencia. El manifiesto que relaciona cada recurso con su entidad es `v2/core/catalog-assets.json`.

## Productos

| Entidad | Producto y presentación comercial | Marca | Código publicado | Referencia |
| --- | --- | --- | --- | --- |
| SKU-ARROZ | Arroz superior, bolsa de 750 g | Costeño | 7755139965326 | [Metro](https://www.metro.pe/arroz-superior-costeno-750g-171247/p) |
| SKU-ACEITE | Aceite vegetal Clásico, botella de 900 ml | Primor | 7750243979214 | [Metro](https://www.metro.pe/aceite-vegetal-primor-cl-sico-botella-900ml-3201-2/p) |
| SKU-FIDEOS | Spaghetti, bolsa de 500 g | Don Vittorio | 7750243072571 | [Metro](https://www.metro.pe/spaghetti-don-vittorio-500g-962239/p) |
| SKU-AZUCAR | Azúcar rubia, bolsa de 1 kg | Dulfina | 7751160000234 | [Metro](https://www.metro.pe/azucar-rubia-dulfina-bolsa-1-kg-333705/p) |
| SKU-ATUN | Filete de atún, lata de 140 g | Primor | 7750243049658 | [Metro](https://www.metro.pe/filete-de-atun-primor-140g/p) |
| SKU-LECHE | Leche entera UHT, caja de 946 ml | Gloria | 7751271019545 | [Metro](https://www.metro.pe/leche-entera-uht-gloria-caja-946ml-3230/p) |
| SKU-YOGUR | Yogurt bebible de fresa, botella de 946 g | Gloria | 7751271027526 | [Metro](https://www.metro.pe/yogurt-bebible-gloria-fresa-botella-946g-48255001-2/p) |
| SKU-QUESO | Queso fresco, molde de 500 g | Floralp | 7751758876821 | [Metro](https://www.metro.pe/queso-fresco-floralp-molde-500-gr-2-2/p) |
| SKU-JUGO | Jugo de naranja, botella de 1 L | Eco Fresh | 7752705002843 | [Metro](https://www.metro.pe/jugo-de-naranja-natural-wong-botella-1l-1038985/p) |
| SKU-HELADO | Helado de crema Peziduri vainilla, pote de 900 ml | D’Onofrio | 8445291014091 | [Metro](https://www.metro.pe/helado-de-crema-peziduri-vainilla-900ml-299433005-2/p) |
| SKU-POLLO | Filete de pechuga de pollo congelado, venta por kg | San Fernando | 2578970000002 | [Metro](https://www.metro.pe/filete-de-pechuga-de-pollo-san-fernando-x-kg-987004/p) |
| SKU-DETERGENTE | Detergente en polvo Aros de Poder Limón, bolsa de 730 g | Sapolio | 7750243079358 | [Metro](https://www.metro.pe/detergente-en-polvo-sapolio-aros-de-poder-limon-730g-1030636/p) |

Se contrastó el nombre, la marca y el campo `ean` del artículo mediante la API pública de catálogo `https://www.metro.pe/api/catalog_system/pub/products/search`. La selección se hizo por coincidencia exacta del código publicado, no solo por el primer resultado de búsqueda. Los nombres visibles se normalizaron en mayúsculas, espacios y unidades sin cambiar la presentación.

Precisiones del catálogo:

- El título del jugo en Metro menciona Wong, pero el campo de marca y la etiqueta de la fotografía dicen Eco Fresh. Se usa Eco Fresh para evitar presentar al distribuidor como fabricante del producto.
- La fotografía del pollo muestra expresamente «Congelado» y San Fernando. El artículo se vende por kg y su código comienza por 25: es una referencia de peso variable del comercio, no una afirmación de que exista un envase fijo de 1 kg ni un GTIN de fabricante para cada bolsa. Su presentación se declara como «Venta por kg · peso variable».
- La leche es UHT. El escenario la conserva en la zona ambiente mientras el envase permanezca cerrado; no se deduce una necesidad de cámara frigorífica solamente por ser un lácteo.
- Los nombres, gramajes y códigos de este catálogo describen las unidades comerciales fotografiadas. Los tamaños de caja, cantidades por palé, plazos de suministro, existencias, fechas de lote, pedidos y rutas son parámetros del escenario universitario DonPepe; no son condiciones comerciales publicadas por las marcas.

## Proveedores y logotipos

| Entidad | Nombre visible | Sitio oficial | Recurso original |
| --- | --- | --- | --- |
| PROV-1 | Corporación Vega | [Vega](https://www.vega.pe) | [Logotipo de la cabecera oficial](https://vegaperu.vtexassets.com/assets/vtex.file-manager-graphql/images/78f0ab5d-dc9d-4da0-afa5-86d90bf1940c___1c0526ea15e28bc8ce3671a22aa436fc.png) |
| PROV-2 | Makro Supermayorista | [Makro Perú](https://www.makro.plazavea.com.pe) | [Logotipo oficial](https://plazavea.vteximg.com.br/arquivos/logo-makro-active.svg?v=638645306746300000) |
| PROV-3 | Alicorp S.A.A. | [Alicorp](https://www.alicorp.com.pe) | [Logotipo de la cabecera oficial](https://www.alicorp.com.pe/images/logo-alicorp-header.svg) |

Las empresas y sus logotipos son reales. Su relación comercial con DonPepe, la asignación de determinados SKU a cada proveedor, las zonas autorizadas, los plazos y los pedidos de este sistema pertenecen al escenario ficticio. No se afirma que exista un contrato, una integración, un convenio de distribución o una relación real entre DonPepe y estas empresas. No se han inventado correos, teléfonos, números fiscales ni contactos comerciales.

Los recursos conservan la identidad de sus titulares. Su disponibilidad pública no equivale a una licencia de redistribución irrestricta; para una publicación comercial corresponde revisar las condiciones de uso de cada titular. En este proyecto se documenta la procedencia para que puedan sustituirse o autorizarse sin perder trazabilidad.
