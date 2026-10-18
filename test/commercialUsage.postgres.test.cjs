// Opt-in LOCAL disposable DB only. Never uses DATABASE_URL or application config.
require('./support/register-types.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const { PgCommercialUsageStore } = require('../src/services/pgCommercialUsageStore.ts');
const { CommercialUsageService } = require('../src/services/commercialUsageService.ts');
const { HistoryExportService } = require('../src/services/historyExport.ts');
const url = process.env.SECURE_SEND_USAGE_TEST_DATABASE_URL;

test('PostgreSQL: isolated schema concurrency, composite tenant FK and append-only history', {skip:!url}, async()=>{
  const parsed=new URL(url);
  assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname),'Only a disposable LOCAL DB may be used');
  assert.match(parsed.pathname,/\/_?[A-Za-z0-9_]*commercial_usage_test$/,'Test DB name must end in commercial_usage_test');
  assert.equal(process.env.SECURE_SEND_USAGE_TEST_ALLOW_DDL,'yes','Explicit isolated fixture-DDL consent required');
  const { Pool } = require('pg');
  const schema='send_usage_test_'+randomBytes(8).toString('hex');assert.match(schema,/^send_usage_test_[a-f0-9]{16}$/);
  const owner=new Pool({connectionString:url,max:1});let pool,created=false;
  try {
    await owner.query(`CREATE SCHEMA ${schema}`);
    created=true;
    pool=new Pool({connectionString:url,max:12,options:`-c search_path=${schema},public`});
    // Full dependency order in an empty random schema. Never invoke the service migration runner.
    for(const file of fs.readdirSync(require('node:path').join(__dirname,'../migrations')).filter(f=>f.endsWith('.sql')).sort())
      await pool.query(fs.readFileSync(require('node:path').join(__dirname,'../migrations',file),'utf8'));
    for(const file of ['tenant-foundation-schema.draft.sql','commercial-transfer-connection-schema.draft.sql','commercial-usage-schema.draft.sql'])
      await pool.query(fs.readFileSync(require('node:path').join(__dirname,'../docs',file),'utf8'));
    const org='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
    const uid='55555555-5555-4555-8555-555555555555',group='66666666-6666-4666-8666-666666666666';
    await pool.query("INSERT INTO organizations(id,name,status) VALUES($1,'fixture A','active'),($2,'fixture B','active')",[org,other]);
    await pool.query("INSERT INTO users(id,status) VALUES($1,'active')",[uid]);
    await pool.query("INSERT INTO memberships VALUES($1,$2,'member','active',true)",[org,uid]);
    const now=Date.now();
    await pool.query(`INSERT INTO transfer_groups(id,sender_email,token_hash,expires_at,organization_id,sender_user_id)
      VALUES($1,'fixture@example.invalid','fixture-only',to_timestamp($2/1000.0),$3,$4)`,[group,now+86400000,org,uid]);
    const ids=Array.from({length:20},(_,i)=>`33333333-3333-4333-8333-${String(i).padStart(12,'0')}`);
    for(const id of ids)await pool.query(`INSERT INTO transfers(id,organization_id,sender_user_id,group_id,sender_email,original_filename,content_type,size_bytes,storage_object)
      VALUES($1,$2,$3,$4,'fixture@example.invalid','fixture.bin','application/octet-stream',1000000000,$5)`,[id,org,uid,group,`incoming/${org}/${id}`]);
    const plan={id:'pilot',version:'1',bytesPerContractedSender:5000000000,maxFileBytes:5000000000,warningPercent:80,reservationTtlMs:60000,retentionDays:7,downloadWindowMs:3600000,downloadAlertBytes:5000000000,countingMode:'received_bytes'};
    const deps={now:()=>now,newId:()=>randomBytes(8).toString('hex'),transfer:async()=>{throw Error('Nested connection forbidden');},metadata:async()=>({sizeBytes:1000000000,generation:'9007199254740993'}),deleteGeneration:async()=>{},uploadClosed:async()=>false};
    const service=new CommercialUsageService(new PgCommercialUsageStore(pool),deps),operator={actorId:'operator',permissions:['allowance:apply']};
    const allowance=o=>({organizationId:o,periodId:'test-period',startsAt:now,endsAt:now+86400000,contractedSenders:2,baseQuotaBytes:10000000000,sourceOrderId:'approved-order',sourceRevision:1,effectiveAt:now,sendingEnabled:true,plan});
    await service.applyAllowance(operator,allowance(org));await service.applyAllowance(operator,allowance(org));await service.applyAllowance(operator,allowance(other));
    const ctx={organization:{id:org,status:'active'},user:{id:uid,status:'active'},membership:{organizationId:org,userId:uid,role:'member',status:'active',canSend:true}};
    const results=await Promise.allSettled(ids.map((id,i)=>service.reserve(ctx,'test-period',{requestId:'request-'+i,groupId:group,transferId:id,bytes:1000000000})));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,10);
    const p=await service.usage(ctx,'test-period');assert.equal(p.period.reservedBytes,10000000000);
    const completed=results.findIndex(r=>r.status==='fulfilled');
    await service.complete(ctx,'test-period','request-'+completed);await service.complete(ctx,'test-period','request-'+completed);
    const actual=(await pool.query('SELECT storage_generation,size_bytes,status FROM transfers WHERE id=$1',[ids[completed]])).rows[0];
    assert.equal(actual.storage_generation,'9007199254740993');assert.equal(actual.status,'scanning');
    await assert.rejects(pool.query('UPDATE send_usage_events SET payload=payload'),/append-only/);
    // DB itself rejects an A transfer referenced from a B reservation, not just the API.
    const payload={id:'cross',organizationId:other,periodId:'test-period'};
    await assert.rejects(pool.query('INSERT INTO send_usage_reservations VALUES($1,$2,$3,$4,$5,$6)',[other,'test-period','cross',ids[0],'cross-object',JSON.stringify(payload)]),e=>e.code==='23503');
    // Export integration, only in this separately approved disposable fixture schema.
    const otherUser='77777777-7777-4777-8777-777777777777',otherGroup='88888888-8888-4888-8888-888888888888',otherTransfer='99999999-9999-4999-8999-999999999999';
    await pool.query("UPDATE memberships SET role='admin' WHERE organization_id=$1 AND user_id=$2",[org,uid]);
    await pool.query("INSERT INTO users(id,status) VALUES($1,'active')",[otherUser]);
    await pool.query("INSERT INTO memberships VALUES($1,$2,'admin','active',false)",[other,otherUser]);
    await pool.query(`INSERT INTO transfer_groups(id,sender_email,token_hash,expires_at,organization_id,sender_user_id)
      VALUES($1,'other@example.invalid','other-fixture',to_timestamp($2/1000.0),$3,$4)`,[otherGroup,now+86400000,other,otherUser]);
    await pool.query(`INSERT INTO transfers(id,organization_id,sender_user_id,group_id,sender_email,original_filename,content_type,size_bytes,storage_object)
      VALUES($1,$2,$3,$4,'other@example.invalid','FOREIGN_FILE.bin','application/octet-stream',1,'foreign-object')`,[otherTransfer,other,otherUser,otherGroup]);
    const ownAudit=(await pool.query(`INSERT INTO audit_logs(transfer_id,group_id,event,actor) VALUES($1,$2,'uploaded','fixture') RETURNING id`,[ids[completed],group])).rows[0].id;
    await pool.query(`INSERT INTO audit_logs(transfer_id,group_id,event,actor) VALUES($1,$2,'uploaded','foreign')`,[otherTransfer,otherGroup]);
    const poison=(await pool.query(`INSERT INTO audit_logs(transfer_id,group_id,event,actor) VALUES($1,$2,'uploaded','contradictory') RETURNING id`,[ids[completed],otherGroup])).rows[0].id;
    await pool.query("INSERT INTO audit_logs(event,actor) VALUES('uploaded','orphan')");
    const exporter=new HistoryExportService(pool,{maxDays:90,maxRows:100,maxBytes:1048576});
    const admin={...ctx,membership:{...ctx.membership,role:'admin'}};
    const range={kind:'transfers',from:new Date(now-1000).toISOString(),to:new Date(now+86400000).toISOString()};
    const exported=await exporter.read(admin,range,{exportCsv:true});
    assert.equal(exported.rows.length,20);assert.doesNotMatch(exported.csv.toString(),/FOREIGN_FILE|other@example/);
    const logs=await exporter.read(admin,{...range,kind:'audit'},{exportCsv:true});
    assert.ok(logs.rows.some(r=>r.auditId===ownAudit));assert.ok(logs.rows.some(r=>r.auditId===exported.operationId));
    assert.ok(!logs.rows.some(r=>r.auditId===poison));assert.doesNotMatch(logs.csv.toString(),/foreign|contradictory|orphan/);
    const spoof={...admin,organization:{id:other,status:'active'},membership:{...admin.membership,organizationId:other}};
    await assert.rejects(exporter.read(spoof,range,{exportCsv:true}));
    await pool.query("UPDATE memberships SET role='member' WHERE organization_id=$1 AND user_id=$2",[org,uid]);
    await assert.rejects(exporter.read(admin,range,{exportCsv:true})); // stale session/context cannot retain admin.
  } finally {
    if(pool)await pool.end();
    // Only the generated, validated namespace is removed; no table/data outside it is targeted.
    try{if(created)await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);}finally{await owner.end();}
  }
});
