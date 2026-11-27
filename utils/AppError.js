class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.expose = status < 500;
  }
}
module.exports = AppError;
