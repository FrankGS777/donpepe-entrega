# Logotipos de marcas y procedencia

El catálogo de DonPepe distingue los logotipos auténticos de las representaciones creadas para la demostración académica. Al 18 de octubre de 2026 se obtuvieron 62 logotipos desde sitios oficiales de las marcas, sus fabricantes o sus tiendas oficiales. Para las otras 27 identidades se registraron las búsquedas y las limitaciones de acceso antes de preparar representaciones claramente identificadas.

Las fotografías comerciales de los 131 productos se mantienen como fotografías de productos. No se reutilizan como logotipos de marca, ni se recortan sus envases para aparentar una identidad gráfica oficial.

## Archivos y clasificación

- `core/brand-logo-assets.json`: 62 logotipos oficiales con página de referencia, URL exacta del activo, organización que lo publica, fecha de verificación y huellas SHA-256 del original y del archivo local.
- `core/brand-illustration-assets.json`: ilustraciones referenciales. Su clasificación es `GENERATED_BRAND_REPRESENTATION`, no `OFFICIAL_BRAND_LOGO`.
- `core/brand-logo-fallback-requests.json`, `brand-logo-fallback-requests-2.json` y `brand-logo-fallback-requests-3.json`: las 27 decisiones de representación, con búsquedas, enlaces consultados y motivo.
- `public/images/brands/`: los archivos locales optimizados. Los oficiales usan el nombre de la marca y las ilustraciones llevan el prefijo `illustration-`.

Los logotipos de terceros conservan la identidad publicada por sus titulares. Su inclusión como referencia de catálogo no implica patrocinio, asociación comercial ni autorización para alterar sus marcas.

## Integridad y tratamiento visual

Los activos oficiales se normalizan a WebP de 640 × 360 píxeles mediante ajuste completo de proporción y relleno transparente. No se estiran, recortan, redibujan ni recolorean. Los fondos y márgenes incorporados por el titular se conservan: no todos los originales publicados tienen transparencia.

Cuando el sitio publica un SVG, se rasteriza antes de servirlo. El importador rechaza contenido ejecutable, elementos `foreignObject` y referencias externas. Trident se obtiene como el SVG completo de la cabecera oficial; el selector y el procedimiento figuran en el manifiesto.

Florida, B&D, Inka Chips y San Fernando tienen una versión oficial blanca y reciben `preferredBackground: "dark"`. El resto utiliza `"light"`. Esta preferencia cambia el marco de presentación de DonPepe, no los colores de la marca.

Las migraciones conservan imágenes personalizadas o cargadas por el administrador. Los nuevos activos reemplazan referencias iniciales de producto o completan la misma imagen ya administrada por el manifiesto; no crean stock ni cambian productos o permisos.

## Identidades que requieren especial cuidado

- Del Valle corresponde a infusiones de Agrofil Huyro, publicado en [Del Valle Huyro](https://delvallehuyro.com/). No es la marca de jugos de Coca-Cola. Frugos utiliza por separado el logotipo oficial Frugos del Valle publicado por Coca-Cola Perú.
- Cartavio usa la identidad de la empresa azucarera en [Coazúcar](https://www.coazucar.com/esp/cartavio_nosotros.html), no la del ron homónimo.
- San Mateo utiliza el recurso público `SM_LogoRGB.svg` publicado por [Gloria Perú](https://www.gloria.com.pe/), no una imagen tomada de una botella.
- Dulfina procede de Agro Industrial Paramonga; Costeño y Paisana, de Costeño Alimentos. No se atribuyen a Alicorp.
- Romex corresponde a repostería de [Romex Perú](https://romex.pe/es/product/chocolate-y-derivados-del-cacao/), no a una empresa extranjera homónima.
- El logo principal de Ritz procede de la sección de marca de SnackWorks/Mondelēz; se descarta el recurso promocional Ritz Island.
- Norsal se mantiene como representación identificada porque no se obtuvo un activo independiente de la marca peruana de sal. No se sustituye por el logo de la empresa brasileña homónima.

## Fuentes oficiales de los logotipos disponibles

| Marca | Organización que publica el recurso | Página de referencia | Archivo de origen | Marco |
| --- | --- | --- | --- | --- |
| Costeño | Costeño Alimentos | [Página oficial](https://www.costenoalimentos.com.pe/) | [Activo original](https://www.costenoalimentos.com.pe/media/1672/yTuwlYVO2U3c1Cm2mSEUlQkxgA3lO20zC6mRlWNc.png) | Claro |
| Primor | Alicorp | [Página oficial](https://www.alicorp.com.pe/pe/es/productos/consumo-masivo) | [Activo original](https://www.alicorp.com.pe/images/marcas/marcas_primor.webp) | Claro |
| Don Vittorio | Alicorp | [Página oficial](https://www.alicorp.com.pe/pe/es/productos/consumo-masivo) | [Activo original](https://www.alicorp.com.pe/images/marcas/marcas_donvittorio.webp) | Claro |
| Dulfina | Agro Industrial Paramonga | [Página oficial](https://www.agroparamonga.com/lineas-negocio/azucar/) | [Activo original](https://www.agroparamonga.com/wp-content/uploads/2023/05/Logo_Dulfina_sobre_gris.ai_page-0001-removebg-preview.png) | Claro |
| Gloria | Gloria Perú | [Página oficial](https://www.gloria.com.pe/) | [Activo original](https://www.gloria.com.pe/logogloria3.svg) | Claro |
| Floralp | Floralp Perú | [Página oficial](https://www.floralpperu.com/) | [Activo original](https://www.floralpperu.com/images/logo_floralp.png) | Claro |
| D’Onofrio | Tienda oficial Nestlé Perú | [Página oficial](https://tiendanestle.pe/collections/donofrio-productos) | [Activo original](https://cdn.shopify.com/s/files/1/0460/5558/8007/files/1_1.png?v=1671730523) | Claro |
| San Fernando | San Fernando | [Página oficial](https://corporativo.sanfernando.pe/) | [Activo original](https://corporativo.sanfernando.pe/wp-content/uploads/2024/01/unnamed-e1750197336259.webp) | Oscuro |
| Sapolio | Alicorp | [Página oficial](https://www.alicorp.com.pe/pe/es/productos/consumo-masivo) | [Activo original](https://www.alicorp.com.pe/images/marcas/marcas_sapolio.webp) | Claro |
| Vega | Corporación Vega | [Página oficial](https://www.vega.pe/nuestras-marcas) | [Activo original](https://vegaperu.vtexassets.com/arquivos/logoveganuestrasmarcas.png) | Claro |
| Cocinero | Alicorp | [Página oficial](https://www.alicorp.com.pe/pe/es/productos/consumo-masivo) | [Activo original](https://www.alicorp.com.pe/images/marcas/marcas_cocinero.webp) | Claro |
| Olivos Del Sur | Olivos del Sur Perú | [Página oficial](https://olivosdelsur.com/) | [Activo original](https://olivosdelsur.com/wp-content/uploads/2024/03/logo-olivos-del.png) | Claro |
| Gran Chalan | Induamerica — Gran Chalán | [Página oficial](https://induamerica.com.pe/gran-chalan/) | [Activo original](https://induamerica.com.pe/wp-content/uploads/2025/05/Logo-11.png) | Claro |
| PACASMAYO | Molinos Samán — Arroz Pacasmayo | [Página oficial](https://www.molinosaman.com.pe/) | [Activo original](https://www.molinosaman.com.pe/app/assets/images/img/02072024014106000000.jpg) | Claro |
| Paisana | Costeño Alimentos | [Página oficial](https://www.costenoalimentos.com.pe/) | [Activo original](https://www.costenoalimentos.com.pe/media/627/l5h8QLGJZilNtWzmEygm0RPRPjkOHgYUjrxDN8Tk.png) | Claro |
| Cartavio | Cartavio — Coazúcar | [Página oficial](https://www.coazucar.com/esp/cartavio_nosotros.html) | [Activo original](https://www.coazucar.com/esp/images/logohome-cartavio.jpg) | Claro |
| LA BOLIVIANA | Nutra Stevia — La Boliviana | [Página oficial](https://www.labolivianastevia.com/) | [Activo original](https://www.labolivianastevia.com/wp-content/themes/la_boliviana/images/logo.png) | Claro |
| Molitalia | Molitalia | [Página oficial](https://www.molitalia.com.pe/) | [Activo original](https://www.molitalia.com.pe/wp-content/uploads/2020/09/Group-409-1.svg) | Claro |
| Benoti | Benoti | [Página oficial](https://benoti.pe/) | [Activo original](https://benoti.pe/wp-content/uploads/2025/07/cropped-Sin-titulo-1-scaled-1-1.png) | Claro |
| Nicolini | Alicorp | [Página oficial](https://www.alicorp.com.pe/pe/es/productos/consumo-masivo) | [Activo original](https://www.alicorp.com.pe/images/marcas/marcas_nicolini.webp) | Claro |
| Grano De Oro | Grano de Oro | [Página oficial](https://www.granodeoro.com.pe/) | [Activo original](https://www.granodeoro.com.pe/img/logo.png) | Claro |
| Florida | Florida Perú | [Página oficial](https://florida.com.pe/) | [Activo original](https://florida.com.pe/img/iconos/logo-florida-blanco-fecha.svg) | Oscuro |
| Campomar | Campomar — Hayduk | [Página oficial](https://www.campomar.com.pe/) | [Activo original](https://www.campomar.com.pe/img/svg/brand-campomar-blue.svg) | Claro |
| SANTORINI | Ave Latam — Santorini | [Página oficial](https://ave-store.pe/) | [Activo original](https://ave-store.pe/wp-content/uploads/2025/03/logo1.svg) | Claro |
| Fanny | Molitalia | [Página oficial](https://www.molitalia.com.pe/) | [Activo original](https://www.molitalia.com.pe/wp-content/uploads/2020/09/Group-411-1.svg) | Claro |
| Alacena | Alicorp | [Página oficial](https://www.alicorp.com.pe/pe/es/productos/consumo-masivo) | [Activo original](https://www.alicorp.com.pe/images/marcas/marcas_alacena.webp) | Claro |
| B&D | B&D Perú | [Página oficial](https://byd.com.pe/) | [Activo original](https://byd.com.pe/wp-content/uploads/2025/09/logo-byd-white.png) | Oscuro |
| Kariño | Condimentos Kariño | [Página oficial](https://www.karino.com.pe/) | [Activo original](https://www.karino.com.pe/images/img_prin.jpg) | Claro |
| Emsal | Sal Marina Emsal — Quimpac | [Página oficial](https://salmarinaemsal.com/) | [Activo original](https://salmarinaemsal.com/wp-content/themes/mimanzana/assets/img/logo_header.png) | Claro |
| Piki | Alimentos Piki | [Página oficial](https://alimentospiki.com/) | [Activo original](https://alimentospiki.com/wp-content/uploads/2025/03/logo_piki.png) | Claro |
| Sibarita | Sibarita Perú | [Página oficial](https://sibarita.pe/) | [Activo original](https://sibarita.pe/wp-content/themes/sibarita/img/logo-sibarita.png) | Claro |
| LOPESA | Lopesa | [Página oficial](https://www.lopesa.com/) | [Activo original](https://www.lopesa.com/images/logo.png) | Claro |
| Nestle | Tienda oficial Nestlé Perú | [Página oficial](https://tiendanestle.pe/collections/nestle-chocolateria) | [Activo original](https://cdn.shopify.com/s/files/1/0460/5558/8007/files/23_1.png?v=1671731184) | Claro |
| Ritz | Ritz — Mondelēz / SnackWorks | [Página oficial](https://www.snackworks.com/brands/ritz/) | [Activo original](https://images.ctfassets.net/npgfyzd0fxha/5DF9qjQCIFsF0WNC7o0UTQ/7d3bfd9d57d19d030fd6afdb6a56a885/RITZ_Logo_US_2023-09_100.png) | Claro |
| Fini | Fini — The Fini Company | [Página oficial](https://www.finiworld.com/es-es/) | [Activo original](https://www.finiworld.com/wp-content/uploads/thegem/logos/logo_4e9fb37cf87f31971696a408a513ac0e_3x.png) | Claro |
| Ambrosoli | Molitalia | [Página oficial](https://www.molitalia.com.pe/) | [Activo original](https://www.molitalia.com.pe/wp-content/uploads/2020/09/Group-406-1.svg) | Claro |
| San Jorge | Panadería San Jorge | [Página oficial](https://sanjorge.com.pe/) | [Activo original](https://sanjorge.com.pe/wp-content/uploads/2022/09/LogotipoSVG2rev300.svg) | Claro |
| TRIDENT | Trident — Mondelēz | [Página oficial](https://www.tridentgum.com/) | [Activo original](https://www.tridentgum.com/) | Claro |
| Costa | Molitalia | [Página oficial](https://www.molitalia.com.pe/) | [Activo original](https://www.molitalia.com.pe/wp-content/uploads/2020/09/Group-405-1.svg) | Claro |
| Fanta | Coca-Cola Perú | [Página oficial](https://www.coca-cola.com/pe/es/brands) | [Activo original](https://www.coca-cola.com/content/dam/onexp/br/pt/offerings/fanta-ccxp/logofantanuevo.svg) | Claro |
| San Mateo | Gloria Perú — San Mateo | [Página oficial](https://www.gloria.com.pe/) | [Activo original](https://www.gloria.com.pe/SM_LogoRGB.svg) | Claro |
| Frugos | Coca-Cola Perú — Frugos del Valle | [Página oficial](https://www.coca-cola.com/pe/es/brands) | [Activo original](https://www.coca-cola.com/content/dam/onexp/pe/es/home-images/brands/logo-del-valle.jpg) | Claro |
| San Luis | Coca-Cola Perú | [Página oficial](https://www.coca-cola.com/pe/es/brands) | [Activo original](https://www.coca-cola.com/content/dam/onexp/pe/es/home-images/brands/es_peru_san_luis_logo_180x180%202.png) | Claro |
| Sprite | Coca-Cola Perú | [Página oficial](https://www.coca-cola.com/pe/es/brands) | [Activo original](https://www.coca-cola.com/content/dam/onexp/pe/es/brands/sprite/logo_sprite_pe.png) | Claro |
| Coca Cola | Coca-Cola Perú | [Página oficial](https://www.coca-cola.com/pe/es/brands) | [Activo original](https://www.coca-cola.com/content/dam/onexp/pe/es/home-images/brands/es_coca_cola_logo_500x180%20(1).png) | Claro |
| Cielo | Grupo AJE | [Página oficial](https://www.ajegroup.com/nuestras-marcas/) | [Activo original](https://www.ajegroup.com/aje-assets/wp-content/uploads/2020/05/Web-AJE-CIELO-800-X-800-PX.jpg) | Claro |
| Volt | Grupo AJE | [Página oficial](https://www.ajegroup.com/nuestras-marcas/) | [Activo original](https://www.ajegroup.com/aje-assets/wp-content/uploads/2020/05/VOLT-800-X-800-PX.jpg) | Claro |
| Oro | Grupo AJE | [Página oficial](https://www.ajegroup.com/nuestras-marcas/) | [Activo original](https://www.ajegroup.com/aje-assets/wp-content/uploads/2020/05/11_Logo-oro.png) | Claro |
| Pringles | Pringles Perú — Kellanova | [Página oficial](https://www.promopringles.com/es_PE/home.html) | [Activo original](https://www.promopringles.com/content/dam/latinamerica/promo-pringles/assets/logoPringles.png) | Claro |
| INKA CHIPS | Inka Crops — Inka Chips | [Página oficial](https://inkachips.com/peru/) | [Activo original](https://inkachips.com/wp-content/themes/inkachips/img/logo.png) | Oscuro |
| Act II | ACT II — Conagra Brands | [Página oficial](https://www.actii.com.mx/) | [Activo original](https://www.actii.com.mx/sites/default/files/2026-06/LOGO-ACT-II-2017-_1_-2048x1239.webp) | Claro |
| Cheetos | PepsiCo — Cheetos | [Página oficial](https://www.pepsico.com/brands) | [Activo original](https://digitalassets.pepsico.com/transform/ec574b24-5500-4942-a13a-fa45ba8e43ce/cheetos-full-offwhite?q=75&w=1000) | Claro |
| Doritos | PepsiCo — Doritos | [Página oficial](https://www.pepsico.com/brands) | [Activo original](https://digitalassets.pepsico.com/transform/d38d63a9-f2cb-4626-880f-25e822c776a3/doritos-full-offwhite?q=75&w=1000) | Claro |
| Quaker | Quaker Oats — PepsiCo | [Página oficial](https://www.quakeroats.com/) | [Activo original](https://www.quakeroats.com/sites/quakeroats.com/themes/quakeroats/img/Quaker_Logo_Header.png) | Claro |
| Del Valle | Agrofil Huyro — Infusiones Del Valle | [Página oficial](https://delvallehuyro.com/) | [Activo original](https://delvallehuyro.com/wp-content/uploads/2020/08/LGO-DELVALLE.png) | Claro |
| Winter'S | Compañía Nacional de Chocolates del Perú | [Página oficial](https://chocolates.com.pe/en/brands/winters/) | [Activo original](https://chocolates.com.pe/wp-content/uploads/2019/02/winters-logo-producto.png) | Claro |
| QFOODS | Qfoods | [Página oficial](https://qfoods.pe/) | [Activo original](https://qfoods.pe/wp-content/uploads/2026/09/qf_fi_retina.svg) | Claro |
| Nescafe | Tienda oficial Nestlé Perú | [Página oficial](https://tiendanestle.pe/) | [Activo original](https://cdn.shopify.com/s/files/1/0460/5558/8007/files/logo_nescafe_ok.png?v=1744310380) | Claro |
| Universal | Universal Perú | [Página oficial](https://universalperu.com/) | [Activo original](https://universalperu.com/wp-content/uploads/2024/01/cropped-Logo-peque-1.png) | Claro |
| Blanca Flor | Alicorp | [Página oficial](https://www.alicorp.com.pe/pe/es/productos/consumo-masivo) | [Activo original](https://www.alicorp.com.pe/images/marcas/marcas_blancaflor.webp) | Claro |
| P.A.N. | P.A.N. — Alimentos Polar | [Página oficial](https://pe.allofpan.com/) | [Activo original](https://pe.allofpan.com/wp-content/uploads/logo.png) | Claro |
| ROMEX | Romex — Repostería | [Página oficial](https://romex.pe/es/product/chocolate-y-derivados-del-cacao/) | [Activo original](https://romex.pe/wp-content/uploads/2022/05/logoreposteria_romex.png) | Claro |

## Representaciones sin logo oficial accesible

Las 27 marcas de esta categoría son Eco Fresh, Timonel, ALPA, OD TERRA, OLI21, Deleite, Faraon, Vallenorte, Anita, TERRALÉ, Tari, Walibi, Ajinomix, Norsal, Globo Pop, GN, Golpe, Loa, VORAZ, RIKYTOK, Tortees, Cheese Tris, Altomayo, Kirma, Mc Collins, Duryea y Bonle.

En algunos casos el fabricante publica solamente fotografías de producto; en otros, los recursos de marca no están disponibles o requieren acceso que no corresponde utilizar. Estas condiciones no convierten una imagen generada en logo oficial. La interfaz debe mantener visible la clasificación de representación y permitir al administrador sustituirla por una imagen propia.

## Reproducción y verificación

El importador reutilizable está en `scripts/import-brand-logos.cjs`. Conserva descargas verificadas y permite una actualización explícita con `DONPEPE_REFRESH_LOGOS=1`; sus fuentes son públicas y no usa credenciales. La ubicación de Sharp puede establecerse mediante `DONPEPE_SHARP_MODULE`.

La suite `tests/brand-logo-assets.test.js` comprueba cobertura de las 89 identidades, ausencia de duplicados, archivos WebP locales, huellas de integridad, separación respecto de fotografías de producto, fuentes de marcas homónimas, preferencias de contraste y clasificación de las representaciones generadas.

