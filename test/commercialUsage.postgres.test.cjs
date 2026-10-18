// Opt-in LOCAL disposable DB only. Never uses DATABASE_URL or application config.
require('./support/register-types.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const { PgCommercialUsageStore } = require('../src/services/pgCommercialUsageStore.ts');
const { CommercialUsageService } = require('../src/services/commercialUsageService.ts');
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
    await pool.query('CREATE TABLE organizations(id UUID PRIMARY KEY); CREATE TABLE transfers(id UUID PRIMARY KEY,organization_id UUID NOT NULL REFERENCES organizations(id),UNIQUE(organization_id,id))');
    // REVIEW ONLY schema applied to random ephemeral fixtures, never a service migration ledger.
    await pool.query(fs.readFileSync(require.resolve('../docs/commercial-usage-schema.draft.sql'),'utf8'));
    const org='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
    await pool.query('INSERT INTO organizations(id) VALUES($1),($2)',[org,other]);
    const ids=Array.from({length:20},(_,i)=>`33333333-3333-4333-8333-${String(i).padStart(12,'0')}`);
    for(const id of ids)await pool.query('INSERT INTO transfers(id,organization_id) VALUES($1,$2)',[id,org]);
    const now=Date.UTC(2026,9,1),plan={id:'pilot',version:'1',bytesPerContractedSender:5000000000,maxFileBytes:5000000000,warningPercent:80,reservationTtlMs:60000,retentionDays:7,downloadWindowMs:3600000,downloadAlertBytes:5000000000,countingMode:'received_bytes'};
    const deps={now:()=>now,newId:()=>randomBytes(8).toString('hex'),transfer:async(g,t,o)=>{const r=(await pool.query('SELECT id,organization_id::text FROM transfers WHERE id=$1 AND organization_id=$2',[t,o])).rows[0];return r?{organizationId:o,senderUserId:'user',groupId:g,transferId:t,objectName:`incoming/${o}/${t}`,createdAt:now,accessExpiresAt:now+7*86400000}:null},metadata:async()=>null,deleteGeneration:async()=>{},uploadClosed:async()=>false};
    const service=new CommercialUsageService(new PgCommercialUsageStore(pool),deps),operator={actorId:'operator',permissions:['allowance:apply']};
    const allowance=o=>({organizationId:o,periodId:'2026-10',startsAt:now,endsAt:Date.UTC(2026,10,1),contractedSenders:2,baseQuotaBytes:10000000000,sourceOrderId:'approved-order',sourceRevision:1,effectiveAt:now,sendingEnabled:true,plan});
    await service.applyAllowance(operator,allowance(org));await service.applyAllowance(operator,allowance(org));await service.applyAllowance(operator,allowance(other));
    const ctx={organization:{id:org,status:'active'},user:{id:'user',status:'active'},membership:{organizationId:org,userId:'user',role:'member',status:'active',canSend:true}};
    const results=await Promise.allSettled(ids.map((id,i)=>service.reserve(ctx,'2026-10',{requestId:'request-'+i,groupId:'group',transferId:id,bytes:1000000000})));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,10);
    const p=await service.usage(ctx,'2026-10');assert.equal(p.period.reservedBytes,10000000000);
    await assert.rejects(pool.query('UPDATE send_usage_events SET payload=payload'),/append-only/);
    // DB itself rejects an A transfer referenced from a B reservation, not just the API.
    const payload={id:'cross',organizationId:other,periodId:'2026-10'};
    await assert.rejects(pool.query('INSERT INTO send_usage_reservations VALUES($1,$2,$3,$4,$5,$6)',[other,'2026-10','cross',ids[0],'cross-object',JSON.stringify(payload)]),e=>e.code==='23503');
  } finally {
    if(pool)await pool.end();
    // Only the generated, validated namespace is removed; no table/data outside it is targeted.
    try{if(created)await owner.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);}finally{await owner.end();}
  }
});
