// Typed application errors. Services throw these; the HTTP layer maps them to
// status codes. Keeping the mapping in one place makes error behaviour testable
// and consistent across the API (P005: success AND error paths).

export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (msg, code = 'bad_request') => new AppError(400, code, msg);
export const unauthorized = (msg = 'Autenticação necessária.', code = 'unauthorized') =>
  new AppError(401, code, msg);
export const forbidden = (msg = 'Acesso negado.', code = 'forbidden') =>
  new AppError(403, code, msg);
export const notFound = (msg = 'Recurso não encontrado.', code = 'not_found') =>
  new AppError(404, code, msg);
export const conflict = (msg, code = 'conflict') => new AppError(409, code, msg);
