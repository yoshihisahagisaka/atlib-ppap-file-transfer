require('./support/register-types.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CommercialUsageService } = require('../src/services/commercialUsageService.ts');
const { fullMonthCapacity, retentionDeadline } = require('../src/domain/commercialUsage.ts');
const { CommercialGcs } = require('../src/services/commercialGcs.ts');
const { PgCommercialUsageStore } = require('../src/services/pgCommercialUsageStore.ts');
const { createUsageAdminNotifier } = require('../src/services/commercialUsageNotifications.ts');
const { processUsageWork, discoverUsageWork } = require('../src/services/commercialUsageJobs.ts');
const { MemoryUsageStore } = require('./support/usageHarness.cjs');
const GB = 1_000_000_000, DAY = 86400000;
const worker = { actorId: 'worker', permissions: ['usage:process'] };
const operator = { actorId: 'operator', permissions: ['allowance:apply', 'capacity:grant'] };
const context = (org = 'A', user = 'user', role = 'member') => ({ organization: { id: org, status: 'active' }, user: { id: user, status: 'active' }, membership: { organizationId: org, userId: user, role, status: 'active', canSend: true } });
const plan = () => ({ id: 'pilot', version: 'review-1', bytesPerContractedSender: 5 * GB, maxFileBytes: 10 * GB,
  warningPercent: 80, reservationTtlMs: 60000, retentionDays: 7, downloadWindowMs: 3600000, downloadAlertBytes: GB, countingMode: 'received_bytes' });
function harness() {
  let time = Date.UTC(2026, 9, 1), serial = 0, uploadClosed = false;
  const store = new MemoryUsageStore(), objects = new Map(), transfers = new Map(), deleted = [];
  const service = new CommercialUsageService(store, { now: () => time, newId: () => `lease-${++serial}`,
    transfer: async (g,t,org) => transfers.get(`${org}/${g}/${t}`) || null,
    metadata: async name => objects.get(name) || null,
    uploadClosed: async () => uploadClosed,
    deleteGeneration: async (name, generation) => { const obj = objects.get(name); if (obj && obj.generation !== generation) throw Error('PRECONDITION_FAILED'); objects.delete(name); deleted.push(name); } });
  const allowance = (org='A',extra={}) => ({ organizationId: org, periodId: '2026-10', startsAt: Date.UTC(2026,9,1), endsAt: Date.UTC(2026,10,1), contractedSenders: 2,
    baseQuotaBytes: 10*GB, sourceOrderId: 'formal-order', sourceRevision: 1, effectiveAt: time, sendingEnabled: true, plan: plan(), ...extra });
  function transfer(id, org='A', user='user') { const t = { organizationId:org, senderUserId:user, groupId:'group', transferId:id, objectName:`incoming/${org}/${id}`,createdAt:time,accessExpiresAt:time+7*DAY }; transfers.set(`${org}/group/${id}`,t); return t; }
  async function reserve(id,bytes,ctx=context()) { transfer(id,ctx.organization.id,ctx.user.id); return service.reserve(ctx,'2026-10',{requestId:id,groupId:'group',transferId:id,bytes}); }
  async function commit(id,bytes,ctx=context()) { const r=await reserve(id,bytes,ctx); objects.set(r.objectName,{sizeBytes:bytes,generation:'9007199254740993'}); return service.complete(ctx,'2026-10',id); }
  return {store,service,allowance,transfer,reserve,commit,objects,deleted,now:()=>time,setTime:n=>{time=n},closeUpload:()=>{uploadClosed=true}};
}

test('configured 5GB is multiplied by CONTRACTED senders, not active users; absent/unsafe policy fails', async () => {
  const h=harness(); assert.equal(fullMonthCapacity(plan(),20),100*GB);
  assert.equal(retentionDeadline(h.now(),plan()),h.now()+7*DAY);
  await assert.rejects(h.reserve('missing',1),/ALLOWANCE_NOT_CONFIGURED/);
  await assert.rejects(h.service.applyAllowance(operator,h.allowance('A',{baseQuotaBytes:11*GB})),/CAPACITY_EXCEEDS_CONTRACT/);
  await assert.rejects(h.service.applyAllowance(operator,h.allowance('A',{plan:{...plan(),bytesPerContractedSender:undefined}})),/INVALID_POLICY/);
  assert.throws(()=>fullMonthCapacity(plan(),Number.MAX_SAFE_INTEGER),/INVALID_CAPACITY/);
});

test('concurrent reservations cannot exceed shared quota; database error rolls back reservation and counters', async () => {
  const h=harness();await h.service.applyAllowance(operator,h.allowance());
  const results=await Promise.allSettled(Array.from({length:20},(_,i)=>h.reserve(`f${i}`,GB)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,10);
  assert.equal((await h.service.usage(context(),'2026-10')).period.reservedBytes,10*GB);
  await assert.rejects(h.reserve('overflow',1),/QUOTA_EXCEEDED/);
  const x=harness();await x.service.applyAllowance(operator,x.allowance());x.store.failNextEvent=true;
  await assert.rejects(x.reserve('fail',GB),/simulated DB failure/);
  assert.equal((await x.service.usage(context(),'2026-10')).period.reservedBytes,0);
});

test('80% queues one warning, 100% queues full and denies NEW sends while owner can complete reserved upload',async()=>{
  const h=harness();await h.service.applyAllowance(operator,h.allowance());
  await h.commit('first',8*GB);
  assert.equal(h.store.data.get('A/2026-10').notices.quota_warning.state,'pending');
  const r=await h.reserve('last',2*GB); assert.equal((await h.service.usage(context(),'2026-10')).sendingRestricted,true);
  h.objects.set(r.objectName,{sizeBytes:2*GB,generation:'2'});await h.service.complete(context(),'2026-10','last');
  await h.service.complete(context(),'2026-10','last');
  assert.equal((await h.service.usage(context(),'2026-10')).period.consumedBytes,10*GB);
  assert.equal(Object.values(h.store.data.get('A/2026-10').notices).filter(x=>x.kind==='quota_full').length,1);
  assert.equal(h.store.data.get('A/2026-10').notices.quota_warning.state,'superseded');
  await assert.rejects(h.reserve('new',1),/QUOTA_EXCEEDED/);
  // usage read stays available, and this module has no download authorization dependency.
  assert.equal((await h.service.usage(context(),'2026-10')).remainingBytes,0);
});

test('tenant/user/admin denials produce no storage call or cross-tenant side effect',async()=>{
  const h=harness();await h.service.applyAllowance(operator,h.allowance());await h.service.applyAllowance(operator,h.allowance('B'));
  h.transfer('private','A','user');
  await assert.rejects(h.service.reserve(context('B'),'2026-10',{requestId:'attack',groupId:'group',transferId:'private',bytes:1}),/TRANSFER_NOT_FOUND/);
  await assert.rejects(h.service.reserve(context('A','other'),'2026-10',{requestId:'attack',groupId:'group',transferId:'private',bytes:1}),/Access denied/);
  const wrong=context();wrong.membership.organizationId='B';await assert.rejects(h.reserve('wrong',1,wrong),/Access denied/);
  await h.reserve('mine',1);await assert.rejects(h.service.complete(context('A','other'),'2026-10','mine'),/RESERVATION_NOT_FOUND/);
  await assert.rejects(h.service.management(context(),'2026-10',async()=>99),/Access denied/);
  assert.equal((await h.service.usage(context('B'),'2026-10')).period.reservedBytes,0);
});

test('actual metadata size must match reserved size; revoked ownership blocks complete; no double accounting',async()=>{
  const h=harness();await h.service.applyAllowance(operator,h.allowance());const r=await h.reserve('size',100);
  h.objects.set(r.objectName,{sizeBytes:101,generation:'1'});await assert.rejects(h.service.complete(context(),'2026-10','size'),/OBJECT_SIZE_MISMATCH/);
  assert.equal((await h.service.usage(context(),'2026-10')).period.consumedBytes,0);
  h.objects.set(r.objectName,{sizeBytes:100,generation:'1'});await h.service.complete(context(),'2026-10','size');await h.service.complete(context(),'2026-10','size');
  assert.equal((await h.service.usage(context(),'2026-10')).period.consumedBytes,100);
  await h.reserve('revoked',1);h.transfer('revoked','A','other');await assert.rejects(h.service.complete(context(),'2026-10','revoked'),/Access denied/);
});

test('approved quantity snapshot and capacity grants are staff-only, idempotent and audit-backed',async()=>{
  const h=harness(),a=h.allowance();await h.service.applyAllowance(operator,a);
  // JSONB canonical key ordering must not cause a false conflict.
  await h.service.applyAllowance(operator,Object.fromEntries(Object.entries(a).reverse()));
  await assert.rejects(h.service.applyAllowance(operator,{...a,baseQuotaBytes:1}),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(h.service.applyAllowance(operator,{...a,sourceRevision:2,contractedSenders:1,baseQuotaBytes:5*GB}),/DECREASE_REQUIRES_NEW_PERIOD/);
  const grant={requestId:'extra',bytes:GB,reason:'approved manual request',externalReference:'capacity-approval-1'};
  await assert.rejects(h.service.grantCapacity({actorId:'customer',permissions:[]},'A','2026-10',grant),/STAFF_PERMISSION_DENIED/);
  await h.service.grantCapacity(operator,'A','2026-10',grant);await h.service.grantCapacity(operator,'A','2026-10',grant);
  assert.equal((await h.service.usage(context(),'2026-10')).period.extraBytes,GB);
  await assert.rejects(h.service.grantCapacity(operator,'A','2026-10',{...grant,bytes:2*GB}),/IDEMPOTENCY_CONFLICT/);
  const view=await h.service.management(context('A','admin','admin'),'2026-10',async()=>3);
  assert.equal(view.senderMismatch,true);assert.equal(view.contractedSenders,2);assert.equal(view.period.baseQuotaBytes,10*GB);
});

test('expired URL alone cannot refund reservation; positive closure evidence plus no object required',async()=>{
  const h=harness();await h.service.applyAllowance(operator,h.allowance());const r=await h.reserve('orphan',GB);h.setTime(r.expiresAt+1);
  assert.equal(await h.service.releaseExpired(worker,'A','2026-10','orphan'),false);
  h.closeUpload();h.objects.set(r.objectName,{sizeBytes:GB,generation:'1'});assert.equal(await h.service.releaseExpired(worker,'A','2026-10','orphan'),false);
  h.objects.delete(r.objectName);assert.equal(await h.service.releaseExpired(worker,'A','2026-10','orphan'),true);
  assert.equal((await h.service.usage(context(),'2026-10')).period.reservedBytes,0);
});

test('download detection separates estimates, egress and internal scan traffic, dedupes and never disables receiving',async()=>{
  const h=harness();await h.service.applyAllowance(operator,h.allowance());
  const base={organizationId:'A',periodId:'2026-10',at:h.now(),purpose:'recipient',kind:'issued_estimate',bytes:GB/2};
  await h.service.recordDownload(worker,{...base,id:'one'});await h.service.recordDownload(worker,{...base,id:'one'});
  await h.service.recordDownload(worker,{...base,id:'egress',kind:'observed_egress'});
  await h.service.recordDownload(worker,{...base,id:'scan',purpose:'scan',bytes:10*GB});
  assert.equal(Object.keys(h.store.data.get('A/2026-10').notices).length,0);
  await h.service.recordDownload(worker,{...base,id:'two'});
  assert.equal(Object.keys(h.store.data.get('A/2026-10').notices).length,1);
  assert.equal((await h.service.usage(context(),'2026-10')).sendingRestricted,false);
});

test('outbox retries delivery failure, fences concurrent workers, and stops after max attempts',async()=>{
  const h=harness();await h.service.applyAllowance(operator,h.allowance());await h.commit('warn',8*GB);
  const options={leaseMs:1000,retryDelayMs:100,maxAttempts:2};let attempts=0;
  const fail=async()=>{attempts++;throw Error('secret SMTP diagnostics must not be persisted')};
  assert.equal(await h.service.deliverNotice(worker,'A','2026-10','quota_warning',options,fail),false);
  h.setTime(h.now()+101);await h.service.deliverNotice(worker,'A','2026-10','quota_warning',options,fail);
  h.setTime(h.now()+101);await h.service.deliverNotice(worker,'A','2026-10','quota_warning',options,fail);
  assert.equal(attempts,2);assert.equal(h.store.data.get('A/2026-10').notices.quota_warning.lastError,'DELIVERY_FAILED');
  const x=harness();await x.service.applyAllowance(operator,x.allowance());await x.commit('warn',8*GB);let calls=0;
  await Promise.all([1,2].map(()=>x.service.deliverNotice(worker,'A','2026-10','quota_warning',options,async org=>{assert.equal(org,'A');calls++;await new Promise(r=>setTimeout(r,5))})));
  assert.equal(calls,1);
});

test('retention delete is generation-conditional, repeatable, and never refunds monthly usage',async()=>{
  const h=harness();await h.service.applyAllowance(operator,h.allowance());const r=await h.commit('delete',GB);
  await assert.rejects(h.service.deleteExpired(worker,'A','2026-10','delete'),/OBJECT_NOT_DELETABLE/);
  h.setTime(r.accessExpiresAt);h.objects.set(r.objectName,{sizeBytes:GB,generation:'new'});
  await assert.rejects(h.service.deleteExpired(worker,'A','2026-10','delete'),/PRECONDITION_FAILED/);assert.equal(h.deleted.length,0);
  h.objects.set(r.objectName,{sizeBytes:GB,generation:r.generation});await h.service.deleteExpired(worker,'A','2026-10','delete');await h.service.deleteExpired(worker,'A','2026-10','delete');
  assert.equal(h.deleted.length,1);assert.equal((await h.service.usage(context(),'2026-10')).period.consumedBytes,GB);
});

test('GCS grant binds exact bytes and create-only, generation stays a decimal string; 412 is not swallowed',async()=>{
  let signed,deleted;const bucket={file:name=>({getSignedUrl:async options=>{signed={name,options};return ['not-a-real-signed-url']},getMetadata:async()=>[{size:'100',generation:'9007199254740993123'}],delete:async options=>{deleted=options;throw Object.assign(Error('generation changed'),{code:412})}})};
  const gcs=new CommercialGcs(bucket),r={state:'reserved',bytes:100,expiresAt:200,objectName:'incoming/A/file'};
  const grant=await gcs.uploadGrant(r,'application/octet-stream',100);assert.equal(grant.headers['x-goog-content-length-range'],'100,100');assert.equal(grant.headers['x-goog-if-generation-match'],'0');
  assert.equal(signed.options.expires,200);assert.equal((await gcs.metadata('incoming/A/file')).generation,'9007199254740993123');
  await assert.rejects(gcs.deleteGeneration('incoming/A/file','123'),e=>e.code===412);assert.equal(deleted.ifGenerationMatch,'123');
});

test('SQL adapter locks before any period lookup, binds org/period, rolls back and always releases',async()=>{
  const calls=[];let released=false;const c={query:async(sql,args)=>{calls.push([sql,args]);return {rows:[]}},release:()=>{released=true}};
  const store=new PgCommercialUsageStore({connect:async()=>c});
  await assert.rejects(store.transaction('A','p',async tx=>{assert.equal(await tx.period(),null);throw Error('test abort')}),/test abort/);
  assert.match(calls[1][0],/pg_advisory_xact_lock/);assert.deepEqual(calls[2][1],['A','p']);assert.equal(calls.at(-1)[0],'ROLLBACK');assert.equal(released,true);
});

test('notification resolves CURRENT active admins, rejects mixed tenants and missing contacts before SMTP',async()=>{
  let messages=[];const admin={organizationId:'A',organizationStatus:'active',role:'admin',membershipStatus:'active',userStatus:'active',email:'admin@example.test'};
  const mail={send:async(...args)=>messages.push(args)},n={kind:'quota_warning',observedBytes:8*GB,thresholdBytes:10*GB,periodStartsAt:Date.UTC(2026,8,30,15),periodEndsAt:Date.UTC(2026,9,31,15)};
  const notifier=createUsageAdminNotifier(async()=>[admin,{...admin,role:'member',email:'member@example.test'},{...admin,membershipStatus:'suspended',email:'old@example.test'}],mail,{serviceName:'安全なファイル送信'});
  await notifier('A',n);assert.deepEqual(messages[0][0],['admin@example.test']);assert.match(messages[0][2],/既存ファイルの受信/);
  const mixed=createUsageAdminNotifier(async()=>[admin,{...admin,organizationId:'B'}],mail,{serviceName:'Send'});
  await assert.rejects(mixed('A',n),/CONTACT_TENANT_MISMATCH/);assert.equal(messages.length,1);
  const empty=createUsageAdminNotifier(async()=>[],mail,{serviceName:'Send'});await assert.rejects(empty('A',n),/NO_VALID_ADMIN_CONTACT/);
});

test('month boundary keeps existing reservations in original period; new period requires formal snapshot and does not carry extra quota',async()=>{
  const h=harness();await h.service.applyAllowance(operator,h.allowance());
  const end=Date.UTC(2026,10,1);h.setTime(end-1000);const r=await h.reserve('boundary',GB);
  await h.service.grantCapacity(operator,'A','2026-10',{requestId:'extra',bytes:GB,reason:'approved',externalReference:'approved-ref'});
  h.setTime(end+1);h.objects.set(r.objectName,{sizeBytes:GB,generation:'10'});
  await h.service.complete(context(),'2026-10','boundary');await assert.rejects(h.reserve('closedmonth',1),/SENDING_UNAVAILABLE/);
  const next=h.allowance('A',{periodId:'2026-11',startsAt:end,endsAt:Date.UTC(2026,11,1),effectiveAt:end,contractedSenders:1,baseQuotaBytes:5*GB,sourceOrderId:'formal-decrease',sourceRevision:2});
  await h.service.applyAllowance(operator,next);const view=await h.service.usage(context(),'2026-11');
  assert.equal(view.period.extraBytes,0);assert.equal(view.period.consumedBytes,0);assert.equal(view.period.contractedSenders,1);
});

test('job batch records failure without stopping other tenants; unauthorized discovery never reads DB',async()=>{
  let read=false;const pool={connect:async()=>{read=true;throw Error('must not read')}};
  await assert.rejects(discoverUsageWork(pool,{actorId:'customer',permissions:[]},0,10),/STAFF_PERMISSION_DENIED/);assert.equal(read,false);
  const h=harness();await h.service.applyAllowance(operator,h.allowance());await h.commit('file',GB);const r=h.store.data.get('A/2026-10').reservations.file;h.setTime(r.accessExpiresAt);
  const result=await processUsageWork(worker,h.service,[{organizationId:'B',periodId:'2026-10',id:'file',kind:'delete'},{organizationId:'A',periodId:'2026-10',id:'file',kind:'delete'}],{leaseMs:1000,retryDelayMs:100,maxAttempts:2},async()=>{});
  assert.deepEqual(result,{completed:1,deferred:0,failed:1});
});

test('period renaming cannot create a second allowance for overlapping dates; future orders wait for effective date',async()=>{
  const h=harness();await h.service.applyAllowance(operator,h.allowance());
  await assert.rejects(h.service.applyAllowance(operator,h.allowance('A',{periodId:'renamed',sourceOrderId:'another-order'})),/OVERLAPPING_USAGE_PERIOD/);
  await assert.rejects(h.service.applyAllowance(operator,h.allowance('A',{effectiveAt:h.now()+1})),/ALLOWANCE_NOT_EFFECTIVE/);
});

test('manual extra quota supersedes stale pending mail and re-arms notification at the new threshold',async()=>{
  const h=harness();await h.service.applyAllowance(operator,h.allowance());await h.commit('warn',8*GB);
  await h.service.grantCapacity(operator,'A','2026-10',{requestId:'grant',bytes:10*GB,reason:'approved',externalReference:'approved-ref'});
  assert.equal(h.store.data.get('A/2026-10').notices.quota_warning.state,'superseded');
  await h.commit('next',8*GB);const n=h.store.data.get('A/2026-10').notices.quota_warning;
  assert.equal(n.state,'pending');assert.equal(n.thresholdBytes,20*GB);
});

test('existing Mailer usage adapter sends minimal notification; OTP path retains existing behavior',async()=>{
  const {registerHooks}=require('node:module'),{pathToFileURL}=require('node:url');
  const fake=require('./support/fakeNodemailer.cjs');fake.messages.length=0;
  const hook=registerHooks({resolve(specifier,context,next){return specifier==='nodemailer'?{url:pathToFileURL(require.resolve('./support/fakeNodemailer.cjs')).href,shortCircuit:true}:next(specifier,context)}});
  try {
    const {Mailer}=require('../src/services/mailer.ts');
    const mailer=new Mailer({host:'invalid.example.test',port:587,user:'fixture',password:'fixture',from:'sender@example.test'});
    const notifier=createUsageAdminNotifier(async()=>[{organizationId:'A',organizationStatus:'active',role:'admin',membershipStatus:'active',userStatus:'active',email:'admin@example.test'}],{send:(to,subject,text)=>mailer.sendUsageNotice(to,subject,text)},{serviceName:'安全なファイル送信'});
    await notifier('A',{kind:'quota_full',observedBytes:10*GB,thresholdBytes:10*GB,periodStartsAt:Date.UTC(2026,8,30,15),periodEndsAt:Date.UTC(2026,9,31,15)});
    assert.deepEqual(fake.messages[0].to,['admin@example.test']);assert.match(fake.messages[0].subject,/送信容量/);assert.doesNotMatch(fake.messages[0].text,/確認コード:|https:\/\//);
    assert.match(fake.messages[0].text,/2026\/10\/1/);
    await mailer.sendOtpCode('recipient@example.test','123456','fixture.txt');assert.match(fake.messages[1].text,/123456/);assert.match(fake.messages[1].text,/10分/);
  } finally {hook.deregister()}
});
