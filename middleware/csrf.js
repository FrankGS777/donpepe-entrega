const crypto = require("crypto");
const safe = new Set(["GET", "HEAD", "OPTIONS"]);
module.exports = (req, res, next) => {
  if (!req.session.csrfToken)
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  res.locals.csrfToken = req.session.csrfToken;
  if (safe.has(req.method)) return next();
  const token = req.body?._csrf || req.get("x-csrf-token");
  const received = Buffer.from(typeof token === "string" ? token : "");
  const expected = Buffer.from(req.session.csrfToken);
  if (
    received.length !== expected.length ||
    !crypto.timingSafeEqual(received, expected)
  ) {
    const error = new Error(
      "La sesión del formulario venció. Recarga la página.",
    );
    error.status = 403;
    return next(error);
  }
  next();
};
