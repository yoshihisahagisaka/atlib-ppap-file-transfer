/** No authorization/cookies, OIDC callback query, recipient tokens or signed URLs in HTTP logs. */
export const commercialHttpSerializers = {
  req: (req: { id?: unknown; method?: string; url?: string }) => ({id:req.id,method:req.method,
    route: req.url?.startsWith('/auth/') ? '/auth/[provider]/[action]' :
      req.url?.startsWith('/api/d/') || req.url?.startsWith('/d/') ? '/recipient/[redacted]' : req.url?.split('?')[0]}),
  res: (res: {statusCode?: number}) => ({statusCode:res.statusCode}),
};
