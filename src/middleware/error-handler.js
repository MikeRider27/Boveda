import { HttpError } from '../lib/errors.js';
import { errorFields, logger } from '../lib/logger.js';

// eslint-disable-next-line no-unused-vars -- Express identifica los manejadores de error por aridad 4.
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  // Errores de body-parser.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'bad_json', message: 'El cuerpo no es JSON válido' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'too_large', message: 'La solicitud es demasiado grande' } });
  }
  logger.error('error no controlado', { id: req.id, ...errorFields(err) });
  // Nunca devolvemos detalles internos al cliente; el request id permite cruzarlo con los logs.
  res.status(500).json({ error: { code: 'internal', message: 'Error interno', requestId: req.id } });
}
