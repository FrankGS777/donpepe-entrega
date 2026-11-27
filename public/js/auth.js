document.querySelectorAll("[data-toggle-password]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.togglePassword);
    if (!input) return;
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    button.textContent = visible ? "Mostrar" : "Ocultar";
    button.setAttribute(
      "aria-label",
      visible ? "Mostrar contraseña" : "Ocultar contraseña",
    );
  });
});

const password = document.querySelector("[data-password-form] #newPassword");
if (password) {
  const rules = {
    length: (value) => value.length >= 10,
    upper: (value) => /[A-Z]/.test(value),
    lower: (value) => /[a-z]/.test(value),
    number: (value) => /[0-9]/.test(value),
  };
  const updateRules = () =>
    Object.entries(rules).forEach(([name, valid]) =>
      document
        .querySelector(`[data-rule="${name}"]`)
        ?.classList.toggle("valid", valid(password.value)),
    );
  password.addEventListener("input", updateRules);
  updateRules();
}
