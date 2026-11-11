export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Necesitas iniciar sesión') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'Operación no permitida') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'No encontrado') => new HttpError(404, 'not_found', message);
export const conflict = (code, message, details) => new HttpError(409, code, message, details);
export const tooManyRequests = () => new HttpError(429, 'rate_limited', 'Demasiadas solicitudes, intenta más tarde');
