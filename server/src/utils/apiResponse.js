export function success(res, data, message = "Success", statusCode = 200, meta) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    ...(meta ? { meta } : {})
  });
}
