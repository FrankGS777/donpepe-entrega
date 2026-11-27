const form = document.querySelector("#login-form");
const token = new URLSearchParams(location.search).get("token") || "";
const flow = location.pathname;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
document.body.dataset.authFlow = ["/forgot-password", "/reset-password", "/verify-recovery-email"].includes(flow) ? "recovery" : "login";
form.noValidate = true;
function setAuthBusy(busy) {
  form.setAttribute("aria-busy", String(busy));
  document.body.classList.toggle("is-submitting", busy);
  const button = form.querySelector('button[type="submit"], button.btn.primary');
  if (button) {
    button.disabled = busy;
    button.classList.toggle("auth-busy-button", busy);
  }
}
function authNavigate(url, success = false) {
  document.body.classList.add(success ? "auth-signed-in" : "auth-leaving");
  if (reducedMotion.matches) location.href = url;
  else setTimeout(() => { location.href = url; }, success ? 300 : 180);
}
document.addEventListener("click", (event) => {
  const link = event.target.closest("a.recovery-link,a.auth-back");
  if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  authNavigate(link.href);
});
function clearAuthField(control) {
  if (!control?.name) return;
  control.removeAttribute("aria-invalid");
  const id = `auth-${control.name}-error`;
  document.getElementById(id)?.remove();
  const described = (control.getAttribute("aria-describedby") || "")
    .split(" ")
    .filter((value) => value && value !== id);
  if (described.length)
    control.setAttribute("aria-describedby", described.join(" "));
  else control.removeAttribute("aria-describedby");
}
function authFailure(text, fields = {}) {
  const summary = document.querySelector("#login-error");
  if (!summary) return;
  summary.classList.add("auth-error-summary");
  summary.textContent = text;
  document.body.classList.remove("auth-signed-in", "auth-leaving");
  let first;
  for (const [name, message] of Object.entries(fields)) {
    const control = form.elements.namedItem(name);
    if (!control?.tagName) continue;
    clearAuthField(control);
    const feedback = document.createElement("span");
    feedback.className = "auth-field-error";
    feedback.id = `auth-${name}-error`;
    feedback.textContent = message;
    control.setAttribute("aria-invalid", "true");
    control.setAttribute(
      "aria-describedby",
      [control.getAttribute("aria-describedby"), feedback.id]
        .filter(Boolean)
        .join(" "),
    );
    control.closest("label").append(feedback);
    first ||= control;
  }
  if (first) first.focus({ preventScroll: true });
  (first || summary).scrollIntoView({
    block: "nearest",
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth",
  });
}
form.addEventListener("input", (event) => {
  clearAuthField(event.target);
  if (!form.querySelector('[aria-invalid="true"]')) {
    const summary = document.querySelector("#login-error");
    if (summary) {
      summary.textContent = "";
      summary.classList.remove("auth-error-summary");
    }
  }
});
form.addEventListener(
  "submit",
  (event) => {
    const problems = {};
    for (const control of form.elements) {
      if (!control.name || control.disabled || !control.willValidate) continue;
      clearAuthField(control);
      if (control.required && !control.value.trim())
        problems[control.name] =
          control.name === "email"
            ? "Escribe tu correo de acceso."
            : "Completa este campo.";
      else if (control.validity.typeMismatch)
        problems[control.name] =
          "Escribe un correo válido, por ejemplo nombre@empresa.com.";
      else if (
        control.validity.tooShort ||
        (control.minLength > 0 && control.value.length < control.minLength)
      )
        problems[control.name] =
          `Usa al menos ${control.minLength} caracteres.`;
      else if (
        control.maxLength > 0 &&
        control.value.length > control.maxLength
      )
        problems[control.name] = `No superes ${control.maxLength} caracteres.`;
      if (
        ["password", "currentPassword"].includes(control.name) &&
        new TextEncoder().encode(control.value).length > 72
      )
        problems[control.name] =
          "La contraseña no puede superar 72 bytes. Reduce su longitud.";
    }
    if (
      flow === "/reset-password" &&
      form.elements.password &&
      !problems.password &&
      !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/s.test(
        form.elements.password.value,
      )
    )
      problems.password =
        "Incluye al menos 12 caracteres, mayúscula, minúscula, número y símbolo.";
    if (
      form.elements.confirmation &&
      form.elements.password?.value !== form.elements.confirmation.value
    )
      problems.confirmation = "Las contraseñas nuevas deben coincidir.";
    if (Object.keys(problems).length) {
      event.preventDefault();
      event.stopImmediatePropagation();
      authFailure("Revisa los campos marcados antes de continuar.", problems);
    } else {
      const summary = document.querySelector("#login-error");
      if (summary) {
        summary.textContent = "";
        summary.classList.remove("auth-error-summary");
      }
    }
  },
  true,
);
document.querySelector("#show-password")?.addEventListener("click", (event) => {
  const input = document.querySelector("#password");
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  event.currentTarget.textContent = show ? "Ocultar" : "Mostrar";
  event.currentTarget.setAttribute(
    "aria-label",
    show ? "Ocultar contraseña" : "Mostrar contraseña",
  );
  event.currentTarget.setAttribute("aria-pressed", String(show));
});
async function request(url, body) {
  let response;
  try {
    response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...(body === undefined
        ? {}
        : { method: "POST", body: JSON.stringify(body) }),
    });
  } catch {
    throw Error(
      "No hay conexión con el servidor. Comprueba la conexión y vuelve a intentarlo.",
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error(
      "El servicio no respondió correctamente. Vuelve a intentarlo en unos momentos.",
    );
  }
  if (!response.ok) {
    const error = Error(data.error || "No se pudo completar la solicitud.");
    error.fields = data.fieldErrors || {};
    throw error;
  }
  return data;
}
if (flow === "/login" || flow === "/")
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.getAttribute("aria-busy") === "true") return;
    setAuthBusy(true);
    document.querySelector("#login-error").textContent = "";
    try {
      await request("/api/login", {
        email: form.email.value,
        password: form.password.value,
      });
      document.body.classList.remove("is-submitting");
      form.querySelector(".auth-submit-label").textContent = "Acceso confirmado";
      authNavigate("/", true);
    } catch (error) {
      authFailure(
        error instanceof TypeError
          ? "No hay conexión con el servidor. Comprueba la conexión y vuelve a intentarlo."
          : error.message,
      );
      setAuthBusy(false);
    }
  });
if (
  ["/forgot-password", "/reset-password", "/verify-recovery-email"].includes(
    flow,
  )
) {
  document.querySelector(".recovery-link").hidden = true;
  document.querySelector(".login-heading p").textContent = "";
  const title = document.querySelector(".login-heading h1");
  const back = document.createElement("a");
  back.className = "auth-back";
  back.href = "/login";
  back.textContent = "← Volver al acceso";
  form.after(back);
  const showMessage = (heading, text) => {
    setAuthBusy(false);
    title.textContent = heading;
    form.replaceChildren();
    const symbol = document.createElement("div");
    symbol.className = "auth-status-symbol";
    symbol.textContent = "✓";
    const p = document.createElement("p");
    p.textContent = text;
    form.append(symbol, p);
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
  };
  if (flow === "/forgot-password") {
    title.textContent = "Recupera tu acceso";
    form.innerHTML =
      '<p class="muted">Escribe tu correo de acceso. Tras la revisión de administración, recibirás las instrucciones en tu Gmail vinculado.</p><label>Correo de acceso<input type="email" name="email" autocomplete="username" maxlength="120" required placeholder="nombre@empresa.com"></label><p id="login-error" role="alert"></p><button class="btn primary wide" type="submit">Solicitar recuperación</button>';
    form.onsubmit = async (event) => {
      event.preventDefault();
      const submit = form.querySelector("button");
      if (submit.disabled) return;
      setAuthBusy(true);
      try {
        await request("/api/password-recovery", { email: form.email.value });
        showMessage(
          "Solicitud recibida",
          "Si la cuenta permite recuperación, se procesará la solicitud y recibirás las instrucciones en tu Gmail verificado. No es necesario repetirla. Si no vinculaste un Gmail, contacta con administración para recuperar el acceso.",
        );
      } catch (error) {
        authFailure(error.message);
        setAuthBusy(false);
      }
    };
  } else if (!token) {
    title.textContent = "Este enlace no está disponible";
    const detail = document.createElement("p");
    detail.textContent = "Abre el enlace completo que recibiste por correo.";
    form.replaceChildren(detail);
  } else {
    title.textContent = "Comprobando enlace";
    form.innerHTML =
      '<p class="muted">Revisando vigencia y uso del enlace…</p>';
    history.replaceState(null, "", flow);
    const verifyingEmail = flow === "/verify-recovery-email";
    request(
      `${verifyingEmail ? "/api/recovery-email/verify" : "/api/password-reset/validate"}?token=${encodeURIComponent(token)}`,
    )
      .then(() => {
        title.textContent = verifyingEmail
          ? "Confirma tu Gmail"
          : "Crea una nueva contraseña";
        form.innerHTML = verifyingEmail
          ? '<p>Confirma que quieres vincular este Gmail a tu cuenta. Tu correo anterior permanece vigente hasta la confirmación.</p><p id="login-error" role="alert"></p><button class="btn primary wide" type="submit">Confirmar mi correo</button>'
          : '<p class="muted">Usa al menos 12 caracteres, mayúscula, minúscula y número. Debe ser distinta de la actual y de las cinco anteriores.</p><label>Nueva contraseña<input type="password" name="password" autocomplete="new-password" minlength="12" maxlength="72" required></label><label>Repetir nueva contraseña<input type="password" name="confirmation" autocomplete="new-password" minlength="12" maxlength="72" required></label><p id="login-error" role="alert"></p><button class="btn primary wide" type="submit">Guardar nueva contraseña</button>';
        if (!verifyingEmail)
          form.querySelector("p").textContent =
            "Usa al menos 12 caracteres, mayúscula, minúscula, número y símbolo. Debe ser distinta de la actual y de las cinco anteriores.";
        form.onsubmit = async (event) => {
          event.preventDefault();
          const submit = form.querySelector("button");
          if (submit.disabled) return;
          setAuthBusy(true);
          try {
            if (
              !verifyingEmail &&
              form.password.value !== form.confirmation.value
            )
              throw Error("Las contraseñas no coinciden.");
            await request(
              verifyingEmail
                ? "/api/recovery-email/verify"
                : "/api/password-reset",
              verifyingEmail
                ? { token }
                : {
                    token,
                    password: form.password.value,
                    confirmation: form.confirmation.value,
                  },
            );
            showMessage(
              verifyingEmail ? "Gmail verificado" : "Contraseña actualizada",
              verifyingEmail
                ? "Tu Gmail ya está vinculado. Las futuras recuperaciones se enviarán únicamente a este correo después de su aprobación."
                : "El enlace ya fue utilizado y las sesiones anteriores fueron revocadas. Ya puedes iniciar sesión con tu contraseña nueva.",
            );
          } catch (error) {
            authFailure(
              error.message,
              !verifyingEmail && form.password.value !== form.confirmation.value
                ? { confirmation: "Las contraseñas nuevas deben coincidir." }
                : error.fields || {},
            );
            setAuthBusy(false);
          }
        };
      })
      .catch((error) => {
        title.textContent = "Este enlace no está disponible";
        form.replaceChildren();
        const detail = document.createElement("p");
        detail.textContent = error.message;
        form.append(detail);
      });
  }
}
