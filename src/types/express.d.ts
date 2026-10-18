export {};

declare global {
  namespace Express {
    interface Request {
      sendPrincipal?: import('../services/commercialIdentity').SendPrincipal;
      userEmail?: string;
    }
  }
}
