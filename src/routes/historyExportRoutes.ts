import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute } from '../lib/asyncRoute';
import { assertCustomerAdmin } from '../domain/tenantAuthorization';
import { HistoryExportError, type HistoryExportService } from '../services/historyExport';

const range={kind:z.enum(['transfers','audit']),from:z.string(),to:z.string()};
export function createHistoryExportRouter(service: HistoryExportService) {
  const router=Router();
  router.use((req,_res,next)=>{try{assertCustomerAdmin(req.sendPrincipal!);next();}catch(e){next(e);}});
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');next();});
  router.get('/',asyncRoute(async(req,res)=>{
    const q=z.object({...range,offset:z.coerce.number().int().min(0).optional(),limit:z.coerce.number().int().positive().max(200).optional()}).strict().safeParse(req.query);
    if(!q.success)throw new HistoryExportError('INVALID_EXPORT_REQUEST',400);
    const result=await service.read(req.sendPrincipal!,q.data,{exportCsv:false,offset:q.data.offset,limit:q.data.limit});
    res.json({entries:result.rows,hasMore:result.hasMore});
  }));
  router.post('/export',asyncRoute(async(req,res)=>{
    const q=z.object({...range,format:z.literal('csv')}).strict().safeParse(req.body);
    if(!q.success)throw new HistoryExportError('INVALID_EXPORT_REQUEST',400);
    const result=await service.read(req.sendPrincipal!,q.data,{exportCsv:true,ip:req.ip});
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="secure-send-${q.data.kind}-${result.operationId}.csv"`);
    res.setHeader('X-Audit-Id',result.operationId!);res.send(result.csv);
  }));
  return router;
}
