import { asyncRoute } from './lib/asyncRoute';
import { HistoryExportService, HistoryExportError } from './services/historyExport';
import { createHistoryExportRouter } from './routes/historyExportRoutes';
import type { Express, ErrorRequestHandler } from 'express';
import type { Pool } from 'pg';
import type pino from 'pino';
import type { Config } from './config';
import { OidcProvider } from './lib/oidcProvider';
import { createSsoAuthRouter } from './routes/ssoAuthRoutes';
import { createUploadRouter } from './routes/uploadRoutes';
import { createTransferGroupRouter } from './routes/transferGroupRoutes';
import { commercialSession, SEND_SESSION_COOKIE, type SendSession } from './middleware/commercialSession';
import { CommercialIdentityRepository, type SendPrincipal } from './services/commercialIdentity';
import { commercialUsageRuntime } from './services/commercialUsageRuntime';
import { CommercialSendConnection } from './services/commercialSendConnection';
import { TransferRepo } from './services/transferRepo';
import { TransferGroupRepo } from './services/transferGroupRepo';
import type { AuditLogRepo } from './services/auditLogRepo';
import type { StorageService } from './services/storageService';
import { signValue } from './lib/signedCookie';
import { setCookie, clearCookie } from './lib/cookies';
import { hashDownloadToken, safeEqual } from './services/tokenService';
import { createRateLimiter } from './middleware/rateLimit';
import { assertCustomerAdmin, AuthorizationDenied } from './domain/tenantAuthorization';
import { UsageError } from './domain/commercialUsage';

/** Opt-in composition of the existing server and OIDC protocol, not an additional auth service. */
export function mountCommercialUpload(app: Express, pool: Pool, storage: StorageService,
  audit: AuditLogRepo, config: Config, logger: pino.Logger): void {
  const origin = config.commercial?.origin, secret = config.sso.sessionSecret;
  if (!origin || new URL(origin).origin !== origin || !secret || secret.length < 32 ||
      (!config.sso.google && !config.sso.microsoft)) throw new Error('Commercial SSO/origin configuration required');
  if (config.nodeEnv === 'production' && !origin.startsWith('https://')) throw new Error('Commercial origin requires HTTPS');
  if (config.sso.microsoft && !/^[0-9a-f-]{36}$/i.test(config.sso.microsoft.tenantId)) {
    throw new Error('Commercial Microsoft SSO requires a concrete tenant ID, not common/organizations');
  }
  const identities = new CommercialIdentityRepository(pool), gcs = storage.commercial();
  const usage = commercialUsageRuntime(pool,gcs);
  for (const provider of ['google','microsoft'] as const) {
    const c = config.sso[provider]; if (!c) continue;
    const discoveryUrl = provider === 'google' ? 'https://accounts.google.com/.well-known/openid-configuration' :
      `https://login.microsoftonline.com/${config.sso.microsoft!.tenantId}/v2.0/.well-known/openid-configuration`;
    if (new URL(c.redirectUri).origin !== origin || new URL(c.redirectUri).pathname !== `/auth/${provider}/callback`) {
      throw new Error('Commercial callback must use the configured upload origin');
    }
    app.use(`/auth/${provider}`,createRateLimiter({windowMs:60000,maxRequests:20}),
      createSsoAuthRouter(provider,new OidcProvider({...c,discoveryUrl,scope:'openid email profile'}),null,secret,
        config.nodeEnv,logger,{complete: async (identity,res) => {
          await identities.resolve(identity); // Only pre-approved identity + active membership. Never JIT provision by domain.
          const session: SendSession = {audience:'secure-send',identity,expiresAt:Date.now()+3600000};
          setCookie(res,SEND_SESSION_COOKIE,signValue(secret,session),{maxAgeSeconds:3600,secure:config.nodeEnv==='production'});
          res.redirect('/');
        }}));
  }
  app.use('/api',commercialSession(identities,secret,origin));
  app.post('/api/logout',(_req,res)=>{clearCookie(res,SEND_SESSION_COOKIE);res.json({ok:true});});
  app.get('/api/session',(req,res)=>res.json({organizationId:req.sendPrincipal!.organization.id,
    role:req.sendPrincipal!.membership.role,canSend:req.sendPrincipal!.membership.canSend}));
  const connection = (principal: SendPrincipal) =>
    new CommercialSendConnection(principal,pool,usage,gcs);
  app.use('/api/transfers',createRateLimiter({windowMs:60000,maxRequests:30}),(req,res,next)=>{
    const principal=req.sendPrincipal!, scope={organizationId:principal.organization.id,userId:principal.user.id};
    const groups=new TransferGroupRepo(pool,scope);
    return createUploadRouter(new TransferRepo(pool,scope),audit,storage,config,connection(principal),async(id,token)=>{
      const g=await groups.findById(id);return !!g && safeEqual(g.tokenHash,hashDownloadToken(token));
    })(req,res,next);
  });
  app.use('/api/transfer-groups',createRateLimiter({windowMs:60000,maxRequests:30}),(req,res,next)=>{
    const principal=req.sendPrincipal!;
    return createTransferGroupRouter(new TransferGroupRepo(pool,{organizationId:principal.organization.id,userId:principal.user.id}),
      audit,config,connection(principal))(req,res,next);
  });
  app.get('/api/usage',asyncRoute(async(req,res)=>{
    const p=req.sendPrincipal!; assertCustomerAdmin(p);
    const {rows}=await pool.query(`SELECT period_id FROM send_usage_periods WHERE organization_id=$1
        AND (allowance->>'startsAt')::bigint<=$2 AND (allowance->>'endsAt')::bigint>$2`,[p.organization.id,Date.now()]);
      if(rows.length!==1)throw new UsageError('ALLOWANCE_NOT_CONFIGURED');
      const periodId=String(rows[0]!.period_id);
      // Release before the usage transaction to avoid holding two pool connections per request.
      const view=await usage.management(p,periodId,async org=>{
        const r=await pool.query(`SELECT count(*)::text AS count FROM memberships m JOIN users u ON u.id=m.user_id
          WHERE m.organization_id=$1 AND m.status='active' AND m.can_send=true AND u.status='active'`,[org]);
        return Number(r.rows[0]?.count??0);
      });
      // Internal order references and configuration are not customer-facing API payloads.
      res.json({contractedSenders:view.contractedSenders,activeSenders:view.activeSenders,senderMismatch:view.senderMismatch,
        consumedBytes:view.period.consumedBytes,reservedBytes:view.period.reservedBytes,extraBytes:view.period.extraBytes,
        remainingBytes:view.remainingBytes,sendingRestricted:view.sendingRestricted});
  }));
  app.use('/api/audit-logs',createRateLimiter({windowMs:60000,maxRequests:10}),createHistoryExportRouter(
    new HistoryExportService(pool,config.commercial?.exportLimits ?? {maxDays:90,maxRows:10000,maxBytes:10*1024*1024})));
  // The legacy global audit query is never mounted in customer mode.
  app.use('/api',(_req,res)=>res.status(404).json({error:'NOT_FOUND'}));
  const errors: ErrorRequestHandler = (err,_req,res,_next) => {
    const denied = err instanceof AuthorizationDenied;
    const code=err instanceof HistoryExportError ? err.code : err instanceof UsageError ? err.code : denied ? 'ACCESS_DENIED' : 'REQUEST_FAILED';
    logger.warn({code},'Commercial request failed');
    res.status(denied?403:err instanceof HistoryExportError?err.status:err instanceof UsageError?409:500).json({error:code});
  };
  app.use(errors);
}
