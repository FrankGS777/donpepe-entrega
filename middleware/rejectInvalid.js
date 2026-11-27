const { validationResult, matchedData } = require("express-validator");
const AppError = require("../utils/AppError");
module.exports = (req, res, next) => {
  const result = validationResult(req);
  if (!result.isEmpty())
    return next(
      new AppError(
        result
          .array()
          .map((error) => error.msg)
          .join(" · "),
        422,
      ),
    );
  req.validated = matchedData(req, {
    locations: ["body", "params", "query"],
    includeOptionals: true,
  });
  next();
};
