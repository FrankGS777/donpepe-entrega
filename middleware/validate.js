const { validationResult, matchedData } = require("express-validator");
module.exports =
  (view, load = {}) =>
  async (req, res, next) => {
    const errors = validationResult(req);
    if (errors.isEmpty()) {
      req.validated = matchedData(req, {
        locations: ["body", "params", "query"],
        includeOptionals: true,
      });
      return next();
    }
    try {
      const extra = await load(req);
      return res.status(422).render(view, {
        title: "Revisa los datos",
        errors: errors.array(),
        form: req.body,
        ...extra,
      });
    } catch (error) {
      return next(error);
    }
  };
