# Entorno exterior y navegación del mapa — 29 de octubre de 2026

La portada de referencia presenta una nave industrial de dientes de sierra, patios, trama urbana baja y cerros costeros. El mapa conserva sus instalaciones y amplía el contexto con 59 edificios, 47 vehículos estacionados, 43 luminarias, aceras con juntas, bordillos, pasos peatonales, drenajes, servicios de cubierta, jardineras, estacionamientos y relieve continuo con materiales PBR. El cielo sigue a la cámara para evitar cortes del fondo. La vista exterior usa perspectiva para mostrar el horizonte; la red de tiendas conserva proyección ortográfica.

Estos elementos son escenografía. No son equipos autónomos nuevos ni generan pedidos, existencias, ubicaciones o rutas. Los patios laterales quedan fuera de las rutas operativas. El relieve mantiene plano el rectángulo completo de los lotes urbanos, incluidas sus esquinas. La base exterior celeste se sustituyó por concreto texturizado.

## Rendimiento

- Una sola escena se conserva durante la sesión. Al salir se retira su nodo del documento, se cancela el renderizado y se limpia la navegación; al volver se conecta el mismo lienzo y se actualiza con el estado recibido del servidor.
- No se reconstruyen racks, materiales ni contexto gráfico por una navegación de pedidos o recepción al mapa. La cámara también conserva su posición. Cerrar o recargar la página libera el contexto.
- Los coches decorativos comparten buffers de instancias por geometría y material. Las llamadas de dibujo de la vista comparada bajaron de 625 a 303. No equivale a medir temperatura, consumo eléctrico ni un porcentaje universal de mejora.
- El contexto urbano se dibuja en exterior/red y se omite en interior/pasillo. No se ocultan objetos del almacén al seleccionar una carga.
- HDR y mapas fotográficos se descargan en paralelo. Se conserva el límite de 30 FPS, DPR máximo 1,25, sombras 2048 y GTAO a media resolución.

## Verificación

`verify-map-session.cjs` usa SQLite temporal e identidad en memoria. Comprueba la identidad del nodo, el lienzo y la instancia gráfica, arquitectura construida una sola vez, cero nuevas solicitudes de texturas al volver y contador de cuadros detenido fuera del mapa. Las pruebas WebGPU y WebGL2 pasaron sin errores de JavaScript.

Última muestra WebGPU: regreso desde pedidos 191 ms, recepción 189 ms, equipos 189 ms e inventario 113 ms. La primera apertura requirió 7503 ms en Chrome de prueba: la preparación inicial de pipelines continúa siendo un coste real. Las mediciones dependen del equipo y navegador; no deben presentarse como tiempos garantizados ni atribuirse a una conexión de internet remota.

Pasaron 51 pruebas unitarias de escena y la revisión de enfoque, selección, píxeles, temas y móvil. El recorrido autónomo aislado completó compra de 12 cajas, almacenamiento de 6 y entrega de 6 a tienda, conservando inventario y liberando equipos; siete comprobaciones y dieciséis capturas, sin errores JavaScript.

Los edificios y el relieve son modelos procedimentales con superficies físicas. No son escaneos fotogramétricos ni reproducciones exactas de una fotografía.
