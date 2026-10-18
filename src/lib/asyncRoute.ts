import type { RequestHandler } from 'express';

/** Express 4 does not forward rejected promises to error middleware. */
export function asyncRoute(handler: RequestHandler): RequestHandler {
  return (req,res,next) => { Promise.resolve().then(() => handler(req,res,next)).catch(next); };
}
