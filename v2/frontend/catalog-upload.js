const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_NORMALIZED_BYTES = 2 * 1024 * 1024;
const bindings = new WeakMap();

export async function normalizeCatalogPhoto(file, logo = false) {
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw Error("Elige una fotografía JPG, PNG o WebP.");
  if (!file.size || file.size > MAX_FILE_BYTES)
    throw Error("La imagen debe tener contenido y no puede superar 10 MB.");
  let image;
  try {
    image = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw Error(
      "No se pudo leer la imagen. Comprueba el archivo o selecciona otra fotografía.",
    );
  }
  try {
    if (
      !image.width ||
      !image.height ||
      image.width * image.height > 36000000 ||
      Math.max(image.width, image.height) > 16384
    )
      throw Error(
        "La imagen debe tener como máximo 36 megapíxeles y 16 384 píxeles por lado.",
      );
    if (Math.max(image.width, image.height) < 64)
      throw Error("La imagen debe medir al menos 64 píxeles en su lado mayor.");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 768;
    const context = canvas.getContext("2d", { alpha: logo });
    if (!context) throw Error("Este navegador no pudo preparar la imagen.");
    if (!logo) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, 768, 768);
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const scale = Math.min(720 / image.width, 720 / image.height);
    const width = image.width * scale,
      height = image.height * scale;
    context.drawImage(
      image,
      (768 - width) / 2,
      (768 - height) / 2,
      width,
      height,
    );
    const result = canvas.toDataURL("image/png");
    if (!result.startsWith("data:image/png;base64,"))
      throw Error("No se pudo preparar una fotografía PNG válida.");
    if (Math.ceil(((result.length - 22) * 3) / 4) > MAX_NORMALIZED_BYTES)
      throw Error(
        "La imagen preparada supera 2 MB. Utiliza una fotografía menos pesada.",
      );
    return result;
  } finally {
    image.close();
  }
}

/** Mount beside imageUrl / logoUrl. Choosing a file previews it; the explicit
 * upload button persists it, then updates the field. Saving the record remains
 * the containing form's responsibility. Returns a cleanup handle. */
export function bindCatalogUpload({ form, api, onPreview, kind, fieldName }) {
  if (!form || typeof api !== "function") return null;
  if (bindings.has(form)) return bindings.get(form);
  const field =
    fieldName && ["imageUrl", "logoUrl"].includes(fieldName)
      ? form.elements.namedItem(fieldName)
      : form.querySelector('[name="imageUrl"], [name="logoUrl"]');
  if (!field) return null;
  const isLogo = field.name === "logoUrl";
  const mediaKind = [
    "sku",
    "supplier",
    "category",
    "brand",
    "branch",
    "asset",
  ].includes(kind)
    ? kind
    : isLogo
      ? "supplier"
      : "sku";
  const entity = {
    sku: "el producto",
    supplier: "el proveedor",
    category: "la categoría",
    brand: "la marca",
    branch: "la sucursal",
    asset: "el activo",
  }[mediaKind];
  const group = document.createElement("section");
  group.className = "catalog-upload";
  group.setAttribute(
    "aria-label",
    isLogo ? "Subir logotipo del proveedor" : `Subir imagen para ${entity}`,
  );
  const controls = document.createElement("div");
  controls.className = "row-actions catalog-upload-controls";
  const choose = document.createElement("label");
  choose.className = "avatar-upload-label btn secondary";
  choose.append(
    document.createTextNode(isLogo ? "Elegir logotipo" : "Elegir fotografía"),
  );
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/jpeg,image/png,image/webp";
  input.className = "avatar-file";
  input.setAttribute(
    "aria-label",
    isLogo ? "Archivo del logotipo" : "Archivo de la fotografía",
  );
  choose.append(input);
  const upload = document.createElement("button"),
    discard = document.createElement("button");
  upload.type = discard.type = "button";
  upload.className = "btn secondary";
  upload.textContent = "Subir imagen";
  upload.disabled = true;
  discard.className = "btn ghost small";
  discard.textContent = "Descartar selección";
  discard.hidden = true;
  controls.append(choose, upload, discard);
  const hint = document.createElement("p");
  hint.className = "field-hint";
  hint.textContent =
    "JPG, PNG o WebP · hasta 10 MB · imagen completa, sin recortes.";
  const status = document.createElement("p"),
    error = document.createElement("p"),
    progress = document.createElement("progress");
  status.className = "field-hint catalog-upload-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  error.className = "form-error catalog-upload-error";
  error.setAttribute("role", "alert");
  progress.className = "catalog-upload-progress";
  progress.max = 100;
  progress.hidden = true;
  progress.setAttribute("aria-label", "Subida de imagen");
  group.append(controls, hint, progress, status, error);
  const previewElement = form.querySelector(".master-asset-preview");
  if (previewElement) previewElement.after(group);
  else (field.closest("label") || field).after(group);
  let pending = "",
    busy = false,
    generation = 0,
    disposed = false;

  function preview(url, stage) {
    if (typeof onPreview === "function")
      return onPreview(url, { stage, kind: mediaKind });
    const target = form.querySelector(
      "#master-preview-image, [data-catalog-preview]",
    );
    if (!target) return;
    if (!url) {
      target.replaceChildren();
      return;
    }
    const image = document.createElement("img");
    image.src = url;
    image.alt = isLogo
      ? "Vista previa del logotipo completo"
      : "Vista previa del producto completo";
    image.decoding = "async";
    target.replaceChildren(image);
  }
  function setBusy(value, message) {
    busy = value;
    group.setAttribute("aria-busy", String(value));
    input.disabled = discard.disabled = value;
    upload.disabled = value || !pending;
    progress.hidden = !value;
    if (value) progress.removeAttribute("value");
    if (message) status.textContent = message;
  }
  function showError(message) {
    error.textContent = message;
    input.setAttribute("aria-invalid", "true");
  }
  function clearError() {
    error.textContent = "";
    input.removeAttribute("aria-invalid");
  }
  async function chooseFile() {
    const file = input.files?.[0];
    if (!file || busy) return;
    const current = ++generation;
    clearError();
    pending = "";
    discard.hidden = true;
    setBusy(true, "Preparando imagen…");
    try {
      const dataUrl = await normalizeCatalogPhoto(file, isLogo);
      if (disposed || current !== generation) return;
      pending = dataUrl;
      preview(dataUrl, "selected");
      discard.hidden = false;
      status.textContent =
        "Vista previa lista. Sube la imagen antes de guardar el registro.";
    } catch (failure) {
      if (!disposed && current === generation) {
        preview(field.value, "restored");
        status.textContent = "La imagen vinculada no ha cambiado.";
        showError(failure.message || "No se pudo preparar la imagen.");
      }
    } finally {
      if (!disposed && current === generation) setBusy(false);
    }
  }
  async function uploadFile() {
    if (!pending || busy) return;
    const selected = pending,
      current = generation;
    clearError();
    setBusy(true, "Subiendo y verificando imagen…");
    try {
      const response = await api("/api/catalog-media", {
        kind: mediaKind,
        dataUrl: selected,
      });
      if (
        !/^\/images\/catalog\/uploads\/[a-f0-9]{64}\.png$/.test(
          response?.imageUrl || "",
        )
      )
        throw Error(
          "El servidor no devolvió una imagen válida. La imagen anterior se conserva.",
        );
      if (disposed || current !== generation) return;
      field.value = response.imageUrl;
      pending = "";
      input.value = "";
      discard.hidden = true;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      preview(response.imageUrl, "uploaded");
      status.textContent = `Imagen subida. Guarda ${entity} para vincularla.`;
      progress.value = 100;
    } catch (failure) {
      if (!disposed && current === generation) {
        preview(field.value, "restored");
        status.textContent =
          "La imagen anterior sigue vinculada. Puedes reintentar la subida.";
        showError(failure.message || "No se pudo subir la imagen.");
      }
    } finally {
      if (!disposed && current === generation) setBusy(false);
    }
  }
  function discardFile() {
    if (busy) return;
    generation++;
    pending = "";
    input.value = "";
    discard.hidden = true;
    clearError();
    preview(field.value, "restored");
    status.textContent =
      "Selección descartada. La imagen vinculada no ha cambiado.";
    setBusy(false);
  }
  function protectSubmit(event) {
    if (!busy && !pending) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showError(
      busy
        ? "Espera a que termine la preparación o subida de la imagen."
        : "Sube la imagen seleccionada o descártala antes de guardar.",
    );
    upload.focus();
  }
  input.addEventListener("change", chooseFile);
  upload.addEventListener("click", uploadFile);
  discard.addEventListener("click", discardFile);
  form.addEventListener("submit", protectSubmit, true);
  const handle = {
    destroy() {
      disposed = true;
      generation++;
      input.removeEventListener("change", chooseFile);
      upload.removeEventListener("click", uploadFile);
      discard.removeEventListener("click", discardFile);
      form.removeEventListener("submit", protectSubmit, true);
      group.remove();
      bindings.delete(form);
      pending = "";
    },
  };
  bindings.set(form, handle);
  return handle;
}
