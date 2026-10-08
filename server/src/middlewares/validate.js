import { ApiError } from "../utils/apiError.js";

export function validate(schema, source = "body") {
  return (req, _res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      return next(
        new ApiError(
          422,
          "Validation failed",
          error.details.map((detail) => ({ field: detail.path.join("."), message: detail.message }))
        )
      );
    }

    req[source] = value;
    return next();
  };
}
