// Only locally uploaded photos are accepted. Never fetch remote avatar URLs.
export function avatarMarkup(user, esc) {
  const initial = esc((user.name || "D").trim().charAt(0).toUpperCase());
  return user.avatarUrl?.startsWith("/api/avatars/")
    ? `<span class="avatar-initial">${initial}</span><img src="${esc(user.avatarUrl)}" alt="" width="768" height="768" decoding="async">`
    : `<span class="avatar-initial">${initial}</span>`;
}

export function renderAvatar(element, user, esc) {
  const signature = `${user.avatarUrl || ""}:${user.name}`;
  if (element.dataset.avatarSignature === signature) return;
  if (
    element.dataset.avatarSource === user.avatarUrl &&
    Number(element.dataset.avatarRetryAt) > Date.now()
  )
    return;
  element.dataset.avatarSignature = signature;
  element.dataset.avatarSource = user.avatarUrl || "";
  element.innerHTML = avatarMarkup(user, esc);
  bindAvatarFallback(element);
}

export function bindAvatarFallback(element) {
  element.querySelectorAll("img").forEach((img) => {
    img.addEventListener(
      "error",
      () => {
        img.remove();
        delete element.dataset.avatarSignature;
        element.dataset.avatarRetryAt = String(Date.now() + 30000);
      },
      { once: true },
    );
  });
}

export async function normalizePhoto(file) {
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw Error("Elige una foto JPG, PNG o WebP.");
  if (file.size > 10 * 1024 * 1024)
    throw Error("La foto no puede superar 10 MB.");
  let image;
  try {
    image = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw Error("No se pudo leer la imagen. Prueba con otra foto.");
  }
  try {
    if (!image.width || !image.height || image.width * image.height > 36000000)
      throw Error("La foto debe tener como máximo 36 megapíxeles.");
    const sourceSize = Math.min(image.width, image.height);
    if (sourceSize < 64)
      throw Error("La foto debe medir al menos 64 × 64 píxeles.");
    const size = Math.min(768, sourceSize);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#17191d";
    context.fillRect(0, 0, size, size);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      (image.width - sourceSize) / 2,
      (image.height - sourceSize) / 2,
      sourceSize,
      sourceSize,
      0,
      0,
      size,
      size,
    );
    return canvas.toDataURL("image/png");
  } finally {
    image.close();
  }
}
