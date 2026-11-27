const { parseScan, fieldValue } = require("../utils/scanCode");
const QRCode = require("qrcode");
window.QRCode = { toCanvas: QRCode.toCanvas };
const supported = [
  "qr_code",
  "ean_13",
  "ean_8",
  "code_128",
  "code_39",
  "upc_a",
  "upc_e",
  "itf",
  "data_matrix",
];

async function cameras(select, preferred = "") {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
    (d) => d.kind === "videoinput",
  );
  select.replaceChildren(new Option("Automática · cámara posterior", ""));
  devices.forEach((d, i) =>
    select.add(new Option(d.label || `Cámara ${i + 1}`, d.deviceId)),
  );
  if (devices.some((d) => d.deviceId === preferred)) select.value = preferred;
  return devices;
}
function cameraSession({ video, deviceId, onRead, onReady, onError }) {
  let stream,
    controls,
    stopped = false,
    reading = false,
    timer;
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    controls?.stop();
    stream?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
  const read = (raw) => {
    if (stopped || reading || !raw) return;
    reading = true;
    stop();
    onRead(raw);
  };
  (async () => {
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Abre el sistema mediante HTTPS o localhost y permite el acceso a la cámara.",
        );
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          ...(deviceId
            ? { deviceId: { exact: deviceId } }
            : { facingMode: { ideal: "environment" } }),
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 24, max: 30 },
        },
      });
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      await video.play();
      if (stopped) return;
      onReady?.();
      let detector;
      if (window.BarcodeDetector) {
        try {
          const available = await window.BarcodeDetector.getSupportedFormats();
          const formats = supported.filter((f) => available.includes(f));
          // Si falta QR o EAN, el lector alternativo mantiene ambos formatos.
          if (formats.includes("qr_code") && formats.includes("ean_13"))
            detector = new window.BarcodeDetector({ formats });
        } catch {
          /* Safari y plataformas con soporte parcial usan ZXing. */
        }
      }
      if (detector) {
        const loop = async () => {
          if (stopped) return;
          try {
            const results = await detector.detect(video);
            if (results[0]?.rawValue) return read(results[0].rawValue);
          } catch {
            /* Reintentar el próximo frame. */
          }
          if (!stopped) timer = setTimeout(loop, 100);
        };
        loop();
      } else {
        if (!window.ZXingBrowser?.BrowserMultiFormatReader)
          throw new Error(
            "No se pudo cargar el lector. Recarga la página y vuelve a activar la cámara.",
          );
        const reader = new window.ZXingBrowser.BrowserMultiFormatReader();
        controls = await reader.decodeFromStream(
          stream,
          video,
          (result, error, ctl) => {
            if (result && !stopped) {
              ctl?.stop();
              read(result.getText());
            }
          },
        );
        if (stopped) controls?.stop();
      }
    } catch (error) {
      if (!stopped) {
        stop();
        onError(error);
      }
    }
  })();
  return { stop };
}
async function lookup(raw) {
  const endpoint = document.body.classList.contains("rf-mode")
    ? "/rf/api/scan"
    : "/wms/api/scan";
  const response = await fetch(`${endpoint}?code=${encodeURIComponent(raw)}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("application/json")
  )
    throw new Error(
      "No se pudo consultar el código. Revisa tu conexión o vuelve a iniciar sesión.",
    );
  return response.json();
}
function confirmReading(item) {
  return new Promise((resolve) => {
    const element = document.createElement("div");
    element.className = "modal scan-review-modal";
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-modal", "true");
    element.setAttribute("aria-label", "Confirmar lectura");
    element.innerHTML =
      '<div class="modal-dialog modal-dialog-centered"><div class="modal-content"><div class="modal-header"><h2>Confirmar lectura</h2><button type="button" class="btn-close" data-ui-dismiss="modal" aria-label="Cerrar"></button></div><div class="modal-body"><article class="scan-confirm-preview"><span></span><strong></strong><code></code><p></p></article></div><div class="modal-footer"><button type="button" class="btn btn-outline-light" data-ui-dismiss="modal">Cancelar</button><button type="button" class="btn btn-brand" data-accept>Usar registro</button></div></div></div>';
    element.querySelector("article span").textContent = item.tipo.replaceAll(
      "_",
      " ",
    );
    element.querySelector("article strong").textContent = item.titulo;
    element.querySelector("article code").textContent = item.codigo;
    element.querySelector("article p").textContent = item.detalle;
    if (item.imagen_url && /^(https?:\/\/|\/images\/)/.test(item.imagen_url)) {
      const image = document.createElement("img");
      image.src = item.imagen_url;
      image.alt = item.titulo;
      image.className = "scan-product-image";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => image.remove(), { once: true });
      element.querySelector("article").prepend(image);
    }
    element.querySelector("[data-accept]").disabled =
      item.tipo === "NO_ENCONTRADO";
    document.body.append(element);
    const modal = window.WmsUi.modal(element);
    let accepted = false;
    element.querySelector("[data-accept]").addEventListener("click", () => {
      accepted = true;
      modal.hide();
    });
    element.addEventListener(
      "ui:modal-hidden",
      () => {
        element.remove();
        resolve(accepted);
      },
      { once: true },
    );
    modal.show();
  });
}
window.WmsScanner = {
  parseScan,
  fieldValue,
  cameras,
  cameraSession,
  lookup,
  confirmReading,
};
