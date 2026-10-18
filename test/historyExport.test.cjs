const {test}=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {HistoryExportService,HistoryExportError,csvCell,writeHistoryCsv,validateExportRange}=require('../dist/services/historyExport');
const {createHistoryExportRouter}=require('../dist/routes/historyExportRoutes');
const {AuthorizationDenied}=require('../dist/domain/tenantAuthorization');
const org='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222';
const context={organization:{id:org,status:'active'},user:{id:user,status:'active'},membership:{organizationId:org,userId:user,status:'active',role:'admin',canSend:false}};
const range={kind:'transfers',from:'2026-10-01T00:00:00.000Z',to:'2026-10-02T00:00:00.000Z'};
const limits={maxDays:90,maxRows:10000,maxBytes:10485760};
function harness({authorized=true,rows=[],auditFails=false}={}) {
 const calls=[];let released=0;
 const pool={connect:async()=>({query:async(sql,args)=>{
  calls.push({sql,args});
  if(sql.includes('SELECT m.role'))return{rows:authorized?[{role:'admin'}]:[]};
  if(sql.startsWith('INSERT INTO audit_logs')){if(auditFails)throw Error('DB failure');return{rows:[{id:'33333333-3333-4333-8333-333333333333'}]};}
  if(sql.startsWith('SELECT t.created_at')||sql.startsWith('SELECT a.created_at'))return{rows};
  return{rows:[]};
 },release:()=>released++})};
 return {service:new HistoryExportService(pool,limits),pool,calls,released:()=>released};
}
const raw={recorded_at:new Date('2026-10-01T01:02:03Z'),uploaded_at:null,sender:'sender@example.invalid',
 to_emails:'to@example.invalid',cc_emails:null,original_filename:'=HYPERLINK("https://example.invalid")',size_bytes:'9007199254740993',
 status:'pending_upload',expires_at:new Date('2026-10-07T00:00:00Z'),revoked_at:null,download_count:0,last_issued_at:null,
 transfer_id:'transfer',group_id:'group',audit_id:null,event:null,actor:null};

test('CSV protects formula/DDE including whitespace/control prefixes and escapes commas/quotes/newlines',()=>{
 for(const value of ['=1+1','+cmd','-cmd','@SUM(A1)',' \t=1','\ufeff=1','\r\n=1','\ttext'])assert.ok(csvCell(value).startsWith('"\''));
 assert.equal(csvCell('a,"b"'),'"a,""b"""');assert.equal(csvCell(null),'""');assert.equal(csvCell('normal.txt'),'"normal.txt"');
 const csv=writeHistoryCsv([{recordedAt:'2026-10-01',filename:'日本語\r\nfile.txt'}],limits.maxBytes);
 assert.deepEqual([...csv.subarray(0,3)],[239,187,191]);assert.match(csv.toString(),/日本語\r\nfile.txt/);
});
test('strict date interval rejects invalid dates, reversed/excessive range, unknown kind and non-UTC strings',()=>{
 validateExportRange(range,limits);
 for(const patch of [{from:'2026-02-30T00:00:00Z'},{from:range.to},{to:'2027-10-01T00:00:00Z'},{kind:'all'},{from:'2026-10-01T00:00:00+09:00'}])assert.throws(()=>validateExportRange({...range,...patch},limits));
});
test('member and suspended contexts cannot export or connect to DB; admin needs no sender seat',async()=>{
 const h=harness();await assert.rejects(h.service.read({...context,membership:{...context.membership,role:'member'}},range,{exportCsv:true}),AuthorizationDenied);
 await assert.rejects(h.service.read({...context,user:{...context.user,status:'suspended'}},range,{exportCsv:true}),AuthorizationDenied);assert.equal(h.calls.length,0);
 await h.service.read(context,range,{exportCsv:true});assert.equal(h.released(),1);
});
test('fresh DB role revocation fails closed under locks before history read or audit write',async()=>{
 const h=harness({authorized:false});await assert.rejects(h.service.read(context,range,{exportCsv:true}),AuthorizationDenied);
 assert.ok(h.calls.some(x=>x.sql.includes('FOR SHARE OF o,m,u')));assert.ok(!h.calls.some(x=>x.sql.startsWith('INSERT')));
 assert.equal(h.calls.at(-1).sql,'ROLLBACK');assert.equal(h.released(),1);
});
test('transfers bind trusted org and half-open interval, preserve null/unmeasured facts, audit before releasing bytes',async()=>{
 const h=harness({rows:[raw]});const r=await h.service.read(context,range,{exportCsv:true,ip:'127.0.0.1'});
 const select=h.calls.find(x=>x.sql.startsWith('SELECT t.created_at'));
 assert.deepEqual(select.args,[org,range.from,range.to,limits.maxRows+1,0]);assert.match(select.sql,/g.organization_id=t.organization_id/);
 assert.match(select.sql,/t.organization_id=\$1/);assert.match(select.sql,/t.created_at>=\$2 AND t.created_at<\$3/);
 assert.equal(r.rows[0].uploadedAt,null);assert.equal(r.rows[0].bytes,'9007199254740993');assert.equal(r.rows[0].lastGroupIssuedAt,null);
 assert.equal(r.rows[0].auditId,null);assert.equal(r.operationId,'33333333-3333-4333-8333-333333333333');
 const event=h.calls.find(x=>x.sql.startsWith('INSERT INTO audit_logs'));
 const detail=JSON.parse(event.args[2]);assert.equal(detail.organizationId,org);assert.equal(detail.state,'generated');assert.equal(detail.rows,1);
 assert.equal(h.calls.at(-1).sql,'COMMIT');assert.doesNotMatch(r.csv.toString(),/password|token_hash|ip_address/);
});
test('audit scopes both parent IDs, excludes contradictory references and only admits explicitly scoped export events',async()=>{
 const h=harness();await h.service.read(context,{...range,kind:'audit'},{exportCsv:true});
 const q=h.calls.find(x=>x.sql.startsWith('SELECT a.created_at')).sql;
 assert.match(q,/t.organization_id=\$1/);assert.match(q,/g.organization_id=\$1/);
 assert.match(q,/a.group_id IS NULL OR a.group_id=t.group_id/);assert.match(q,/a.transfer_id IS NULL AND g.id IS NOT NULL/);
 assert.match(q,/a.event='history_exported' AND a.detail->>'organizationId'=\$1::text/);
 assert.doesNotMatch(q,/SELECT.*a.detail,/); // No raw audit payload projected into export.
});
test('audit write failure prevents CSV response; oversize/too many rows roll back without a success event',async()=>{
 const h=harness({auditFails:true});await assert.rejects(h.service.read(context,range,{exportCsv:true}));assert.equal(h.calls.at(-1).sql,'ROLLBACK');
 const many=harness({rows:[raw,raw]});await assert.rejects(new HistoryExportService(many.pool,{...limits,maxRows:1}).read(context,range,{exportCsv:true}),/EXPORT_TOO_MANY_ROWS/);
 assert.ok(!many.calls.some(x=>x.sql.startsWith('INSERT')));
 const large=harness({rows:[raw]});await assert.rejects(new HistoryExportService(large.pool,{...limits,maxBytes:1}).read(context,range,{exportCsv:true}),/EXPORT_TOO_LARGE/);
 assert.ok(!large.calls.some(x=>x.sql.startsWith('INSERT')));
});
test('bounded viewing uses same model and deterministic pagination without creating export event',async()=>{
 const h=harness({rows:[raw,raw]});const result=await h.service.read(context,range,{exportCsv:false,limit:1,offset:1});
 assert.equal(result.rows.length,1);assert.equal(result.hasMore,true);assert.equal(result.csv,null);
 assert.ok(!h.calls.some(x=>x.sql.startsWith('INSERT')));
});
test('HTTP role guard, tenant-selector spoof rejection and csv-only contract, no-store attachment/audit ID',async()=>{
 const h=harness({rows:[raw]}),app=express();app.use(express.json());let admin=true;
 app.use((q,_r,n)=>{q.sendPrincipal={...context,membership:{...context.membership,role:admin?'admin':'member'}};n();});
 app.use('/api/audit-logs',createHistoryExportRouter(h.service));
 app.use((e,_q,r,_n)=>r.status(e instanceof AuthorizationDenied?403:e.status??500).json({error:e.code??'DENIED'}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const url=`http://127.0.0.1:${server.address().port}/api/audit-logs/export`;
 const send=body=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  admin=false;assert.equal((await send({...range,format:'csv'})).status,403);admin=true;
  assert.equal((await send({...range,format:'csv',organizationId:'foreign'})).status,400);
  assert.equal((await send({...range,format:'xlsx'})).status,400);
  const r=await send({...range,format:'csv'});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
  assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.match(r.headers.get('content-disposition'),/^attachment;/);
  assert.ok(r.headers.get('x-audit-id'));assert.match(await r.text(),/日本|記録日時/);
 }finally{await new Promise(r=>server.close(r));}
});
test('real PostgreSQL tenant-mixing fixtures, export query plans and role-change concurrency',{skip:'Requires separately approved validation DB application; SQL port tests are not DB isolation proof'},()=>{});
test('read-only preflight refuses missing, non-local, generic DB names and connection query overrides',()=>{
 const {validateTarget}=require('../scripts/validation/secure-send-preflight.cjs');
 for(const value of [undefined,'postgres://user:fake@production.example/db','postgres://user:fake@localhost/production',
   'postgres://user:fake@localhost/commercial_usage_test?host=remote'])assert.throws(()=>validateTarget(value));
 assert.equal(validateTarget('postgres://user:fake@127.0.0.1/send_commercial_usage_test'),'postgres://user:fake@127.0.0.1/send_commercial_usage_test');
});
