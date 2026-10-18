// Uses compiled production modules and ephemeral loopback HTTP only. No Cloud/SMTP/DB credentials.
const {test}=require('node:test'),assert=require('node:assert/strict');
const express=require('express'),pino=require('pino');
const {commercialSession,SEND_SESSION_COOKIE}=require('../dist/middleware/commercialSession');
const {signValue}=require('../dist/lib/signedCookie');
const {createSsoAuthRouter}=require('../dist/routes/ssoAuthRoutes');
const {CommercialIdentityRepository}=require('../dist/services/commercialIdentity');
const {CommercialSendConnection}=require('../dist/services/commercialSendConnection');
const {CommercialUsageService}=require('../dist/services/commercialUsageService');
const {PgCommercialUsageStore}=require('../dist/services/pgCommercialUsageStore');
const {createUploadRouter}=require('../dist/routes/uploadRoutes');
const {createTransferGroupRouter}=require('../dist/routes/transferGroupRoutes');
const {createDownloadRouter}=require('../dist/routes/downloadRoutes');
const {TransferRepo}=require('../dist/services/transferRepo');
const {TransferGroupRepo}=require('../dist/services/transferGroupRepo');
const {StorageService}=require('../dist/services/storageService');
const {UsageError}=require('../dist/domain/commercialUsage');
const logger=pino({enabled:false}),secret='test-only-secret-'.repeat(3);
const org='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const user='33333333-3333-4333-8333-333333333333',id='44444444-4444-4444-8444-444444444444';
const identity={issuer:'https://issuer.test',subject:'immutable-subject',email:'same@company.test'};
const principal={email:identity.email,organization:{id:org,status:'active'},user:{id:user,status:'active'},
 membership:{organizationId:org,userId:user,role:'member',status:'active',canSend:true}};
const config={transfer:{maxUploadSizeMb:200,defaultExpiresDays:7,maxExpiresDays:14,maxDownloads:3,signedUrlExpiresMinutes:5},scanServiceUrl:'https://scan.test',storageBucket:'private-test'};
const audit={log:async()=>{}};
function cookie(payload={audience:'secure-send',identity,expiresAt:Date.now()+60000}){return `${SEND_SESSION_COOKIE}=${signValue(secret,payload)}`;}
async function http(app,run){const s=app.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));try{await run(`http://127.0.0.1:${s.address().port}`);}finally{await new Promise(r=>s.close(r));}}
function base(){const app=express();app.use(express.json());app.use((req,_res,next)=>{req.log=logger;next();});return app;}
function errors(app){app.use((e,_req,res,_next)=>res.status(e instanceof UsageError?409:403).json({error:e.code??'DENIED'}));}
const json=(body,headers={})=>({method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});

test('HTTP session rejects dev headers, tampered/expired/spike cookies and cross-origin POST; re-resolves membership',async()=>{
 let calls=0,enabled=true;
 const app=base();app.use(commercialSession({resolve:async(i,selection)=>{calls++;assert.deepEqual(i,identity);if(!enabled||selection===other)throw Error();return principal;}},secret,'https://send.test'));
 app.all('/resource',(req,res)=>res.json({org:req.sendPrincipal.organization.id}));
 await http(app,async url=>{
  assert.equal((await fetch(url+'/resource',{headers:{'x-dev-user-email':identity.email}})).status,401);
  for(const c of [cookie().slice(0,-1)+'x',cookie({audience:'sso-verify',identity,expiresAt:Date.now()+10000}),cookie({audience:'secure-send',identity,expiresAt:1})])
   assert.equal((await fetch(url+'/resource',{headers:{cookie:c}})).status,401);
  assert.equal((await fetch(url+'/resource',json({}, {cookie:cookie(),origin:'https://evil.test'}))).status,403);
  assert.equal(calls,0);
  assert.equal((await fetch(url+'/resource',{headers:{cookie:cookie(),'x-send-organization-id':other}})).status,403);
  assert.equal((await fetch(url+'/resource',{headers:{cookie:cookie()}})).status,200);
  enabled=false;assert.equal((await fetch(url+'/resource',{headers:{cookie:cookie()}})).status,403);
 });
});

test('registered issuer/subject is mandatory; selector is bound in SQL, email does not grant membership',async()=>{
 let params,sql,released=0;
 const repo=new CommercialIdentityRepository({connect:async()=>({query:async(s,p)=>{sql=s;params=p;return{rows:[]};},release:()=>released++})});
 await assert.rejects(repo.resolve(identity,other));assert.deepEqual(params,[identity.issuer,identity.subject,other]);
 assert.match(sql,/i.issuer=\$1 AND i.subject=\$2/);assert.doesNotMatch(sql,/WHERE.*email/);assert.equal(released,1);
});

test('existing SSO state/nonce/PKCE callback invokes approved identity adapter, never domain JIT',async()=>{
 let claims,seen,completed=0;
 const oidc={buildAuthorizationUrl:async p=>{seen=p;return 'https://idp.test/?state='+p.state;},exchangeCode:async(c,v)=>{assert.equal(c,'code');assert.ok(v.length>20);return{idToken:'not-output'};},verifyIdToken:async(_t,n)=>{assert.equal(n,seen.nonce);return identity;}};
 const app=base();app.use('/auth/google',createSsoAuthRouter('google',oidc,null,secret,'development',logger,{complete:async(i,res)=>{claims=i;completed++;res.status(204).end();}}));
 await http(app,async url=>{
  const login=await fetch(url+'/auth/google/login',{redirect:'manual'});
  const stateCookie=login.headers.get('set-cookie').split(';')[0];assert.match(stateCookie,/HttpOnly|sso_oauth_state/);
  assert.equal((await fetch(url+'/auth/google/callback?state=wrong&code=code',{headers:{cookie:stateCookie}})).status,400);
  assert.equal(completed,0);
  assert.equal((await fetch(url+`/auth/google/callback?state=${seen.state}&code=code`,{headers:{cookie:stateCookie}})).status,204);
  assert.deepEqual(claims,identity);assert.equal(completed,1);
 });
});

test('OIDC JWT verifies real signatures, issuer, audience, nonce, expiry and immutable subject',async()=>{
 const {generateKeyPair,exportJWK,SignJWT}=require('jose');const {OidcProvider}=require('../dist/lib/oidcProvider');
 const {publicKey,privateKey}=await generateKeyPair('RS256'),jwk=await exportJWK(publicKey);jwk.kid='test-key';
 const app=base();let origin;
 app.get('/discovery',(_q,r)=>r.json({issuer:origin,jwks_uri:origin+'/keys',authorization_endpoint:origin+'/authorize',token_endpoint:origin+'/token'}));
 app.get('/keys',(_q,r)=>r.json({keys:[jwk]}));
 await http(app,async url=>{origin=url;
  const provider=new OidcProvider({discoveryUrl:url+'/discovery',clientId:'client',clientSecret:'test',redirectUri:url+'/callback',scope:'openid email profile'});
  const token=async(extra={},issuer=url,audience='client',exp='5m',subject='subject')=>new SignJWT({nonce:'nonce',email:identity.email,email_verified:true,...extra}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setIssuer(issuer).setSubject(subject).setAudience(audience).setIssuedAt().setExpirationTime(exp).sign(privateKey);
  assert.equal((await provider.verifyIdToken(await token(),'nonce')).subject,'subject');
  for(const t of [await token({},'https://wrong.test'),await token({},url,'other'),await token({nonce:'wrong'}),await token({},url,'client',1),await token({email_verified:false}),await token({},url,'client','5m','')])await assert.rejects(provider.verifyIdToken(t,'nonce'));
 });
});

test('upload HTTP reserves before issuing URL; quota failure is handled; cross-tenant group cannot create transfer',async()=>{
 let created=0,reserved=0,signed=0,denied=false;
 const app=base();app.use((q,_r,n)=>{q.userEmail=identity.email;n();});
 const transfers={create:async()=>{created++;return{id};}};
 const storage={objectPath:()=>`incoming/${org}/${id}`,createUploadUrl:async()=>{signed++;throw Error('legacy signing forbidden');}};
 const bridge={assertGroup:async()=>{if(denied)throw new UsageError('TRANSFER_NOT_FOUND');},reserve:async()=>{reserved++;throw new UsageError('CAPACITY_EXHAUSTED');}};
 app.use(createUploadRouter(transfers,audit,storage,config,bridge));errors(app);
 await http(app,async url=>{
  const body={groupId:id,filename:'test.txt',contentType:'text/plain',sizeBytes:100};
  assert.equal((await fetch(url+'/',json(body))).status,409);assert.equal(created,1);assert.equal(reserved,1);assert.equal(signed,0);
  denied=true;assert.equal((await fetch(url+'/',json(body))).status,409);assert.equal(created,1);
 });
});

test('scoped repositories bind tenant and immutable sender in history/find/create/revoke SQL',async()=>{
 const calls=[],pool={query:async(s,p)=>{calls.push([s,p]);return{rows:[]};}};
 const t=new TransferRepo(pool,{organizationId:org,userId:user}),g=new TransferGroupRepo(pool,{organizationId:org,userId:user});
 await t.findById(id);await t.listHistoryBySender(identity.email);await g.findById(id);await g.revoke(id);
 for(const [sql,p]of calls){assert.ok(p.includes(org)&&p.includes(user));assert.match(sql,/organization_id/);assert.match(sql,/sender_user_id/);}
});

test('complete retry uses original reservation period across month boundary and no client-selected period',async()=>{
 const calls=[],pool={connect:async()=>({query:async(s,p)=>{calls.push([s,p]);return{rows:[{period_id:'original-month',reservation_id:'reserved-id'}]};},release(){}})};
 const usage={complete:async(p,period,r)=>{assert.equal(p,principal);assert.equal(period,'original-month');assert.equal(r,'reserved-id');return{generation:'9007199254740993'};}};
 const c=new CommercialSendConnection(principal,pool,usage,{},()=>Date.UTC(2026,10,1));
 assert.equal((await c.complete(id,id)).generation,'9007199254740993');assert.deepEqual(calls[0][1],[org,id,user,id]);
});

test('PostgreSQL adapter uses one connection for scoped transfer and actual-size/generation commit, rollback on update failure',async()=>{
 let connects=0,releases=0,fail=false;const queries=[];
 const pool={connect:async()=>{connects++;return{query:async(s,p)=>{queries.push([s,p]);if(s.startsWith('UPDATE transfers'))return{rows:fail?[]:[{id}]};if(s.includes('FROM organizations o'))return{rows:[{id,organization_id:org,sender_user_id:user,group_id:id,storage_object:'object',created_at:new Date(),expires_at:new Date(Date.now()+10000)}]};return{rows:[]};},release:()=>releases++};}};
 const store=new PgCommercialUsageStore(pool);
 await store.transaction(org,'month',async tx=>{assert.equal((await tx.transferScope(id,id,user)).organizationId,org);await tx.commitTransfer({transferId:id,senderUserId:user,bytes:123,generation:'9007199254740993'});});
 assert.equal(connects,1);assert.equal(releases,1);assert.equal(queries.at(-1)[0],'COMMIT');
 const update=queries.find(([s])=>s.startsWith('UPDATE transfers'));assert.deepEqual(update[1],[org,id,user,123,'9007199254740993']);
 fail=true;await assert.rejects(store.transaction(org,'month',tx=>tx.commitTransfer({transferId:id,senderUserId:user,bytes:123,generation:'1'})));
 assert.equal(queries.at(-1)[0],'ROLLBACK');assert.equal(releases,2);
});

test('recipient OTP/download remains available independently of exhausted sending quota, pins generation and expiry',async()=>{
 const deadline=Date.now()+30000,calls=[];
 const group={id,expiresAt:new Date(deadline),revokedAt:null,downloadCount:0,maxDownloads:3};
 const app=base();app.use(createDownloadRouter({findCleanInGroup:async()=>[{originalFilename:'test.txt',storageObject:'object',storageGeneration:'9007199254740993'}]},
  {findByTokenHash:async()=>group,claimDownload:async()=>{calls.push('count');return true;}},audit,
  {createDownloadUrl:async(...a)=>{calls.push(a);return 'https://private-download.test';}}, {},{verify:async()=>({status:'ok',recipientEmail:'recipient@test.test'})},config,(_q,_r,n)=>n()));
 await http(app,async url=>{const r=await fetch(url+'/token/verify',json({code:'123456'}));assert.equal(r.status,200);assert.equal((await r.json()).files.length,1);});
 assert.equal(calls[0][3],'9007199254740993');assert.equal(calls[0][4],deadline);assert.equal(calls[1],'count');
});

test('GCS SDK bridge passes signed headers, pinned scan read and generation-conditional delete',async()=>{
 const calls=[],s=new StorageService('private-test');
 s.storage={bucket:()=>({file:(name,options)=>({getSignedUrl:async opts=>{calls.push(['sign',name,options,opts]);return['https://signed.test'];},getMetadata:async()=>[{size:'123',generation:'9007199254740993'},{}],download:async()=>{calls.push(['download',options]);return[Buffer.from('test')];},delete:async opts=>{calls.push(['delete',opts]);}})})};
 const g=s.commercial();const grant=await g.uploadGrant({state:'reserved',expiresAt:Date.now()+60000,bytes:123,objectName:'object'},'text/plain',Date.now());
 assert.equal(grant.headers['x-goog-if-generation-match'],'0');assert.equal((await g.metadata('object')).generation,'9007199254740993');
 await s.download('object','9007199254740993');await s.delete('object','9007199254740993');
 assert.deepEqual(calls[1][1],{generation:'9007199254740993'});assert.equal(calls[2][1].ifGenerationMatch,'9007199254740993');
 await s.createDownloadUrl('object','test.txt',5,'9007199254740993',Date.now()+10000);
 assert.deepEqual(calls[3][2],{generation:'9007199254740993'});assert.ok(calls[3][3].expires<=Date.now()+10000);
});

test('connected upload completes real-size quota once and retries scan failure without legacy markUploaded',async()=>{
 const {MemoryUsageStore}=require('./support/usageHarness.cjs');const memory=new MemoryUsageStore();
 let status='pending_upload',commits=0,scans=0;
 const at=Date.now(),transfer={organizationId:org,senderUserId:user,groupId:id,transferId:id,objectName:'object',createdAt:at,accessExpiresAt:at+86400000};
 const store={transaction:(o,p,work)=>memory.transaction(o,p,tx=>{
  tx.transferScope=async()=>transfer;
  tx.commitTransfer=async r=>{assert.equal(r.generation,'9007199254740993');assert.equal(r.bytes,100);commits++;status='scanning';};
  return work(tx);
 })};
 const usage=new CommercialUsageService(store,{now:()=>at,newId:()=>id,transfer:async()=>{throw Error('Nested lookup forbidden');},metadata:async()=>({sizeBytes:100,generation:'9007199254740993'})});
 await usage.applyAllowance({actorId:'operator',permissions:['allowance:apply']},{organizationId:org,periodId:'month',startsAt:at,endsAt:at+86400000,contractedSenders:1,baseQuotaBytes:100,sourceOrderId:'order',sourceRevision:1,effectiveAt:at,sendingEnabled:true,
  plan:{id:'test',version:'1',bytesPerContractedSender:100,maxFileBytes:100,warningPercent:80,reservationTtlMs:60000,retentionDays:7,downloadWindowMs:10000,downloadAlertBytes:100,countingMode:'received_bytes'}});
 await usage.reserve(principal,'month',{requestId:id,groupId:id,transferId:id,bytes:100});
 const bridge={complete:()=>usage.complete(principal,'month',id)};
 const app=base();app.use((q,_r,n)=>{q.userEmail=identity.email;n();});
 app.use(createUploadRouter({findById:async()=>({id,groupId:id,senderEmail:identity.email,status,storageObject:'object'}),markUploaded:async()=>{throw Error('Legacy update forbidden');}},audit,{},config,bridge,async()=>true,
  async()=>{scans++;if(scans===1)throw Error('Simulated scan failure');status='clean';}));errors(app);
 await http(app,async url=>{
  const path=url+'/'+id+'/complete',body={groupId:id,groupToken:'test-token'};
  assert.equal((await fetch(path,json(body))).status,502);
  assert.equal((await fetch(path,json(body))).status,200);
  assert.equal((await fetch(path,json(body))).status,200);
 });
 assert.equal(commits,1);assert.equal(scans,2);const u=await usage.usage(principal,'month');assert.equal(u.period.consumedBytes,100);assert.equal(u.period.reservedBytes,0);assert.equal(u.sendingRestricted,true);
});

test('commercial group uses contract retention rather than global legacy defaults; admin without sender seat cannot send',async()=>{
 const pool={connect:async()=>({query:async()=>({rows:[{period_id:'month'}]}),release(){}})};
 const usage={usage:async()=>({sendingRestricted:false,period:{plan:{id:'fixture',version:'1',retentionDays:7,
  bytesPerContractedSender:100,maxFileBytes:100,warningPercent:80,reservationTtlMs:60000,downloadWindowMs:10000,downloadAlertBytes:100,countingMode:'received_bytes'}}})};
 const c=new CommercialSendConnection(principal,pool,usage,{},()=>100000);
 assert.equal((await c.groupDeadline()).getTime(),100000+7*86400000);
 await assert.rejects(c.groupDeadline(14),/INVALID_RETENTION/);
 const admin={...principal,membership:{...principal.membership,role:'admin',canSend:false}};
 await assert.rejects(new CommercialSendConnection(admin,pool,usage,{}).groupDeadline(),/Access denied/);
});

test('atomic download claim contains expiry, revoke and count conditions',async()=>{
 let query;const repo=new TransferGroupRepo({query:async(s,p)=>{query=[s,p];return{rowCount:0};}});
 assert.equal(await repo.claimDownload(id),false);assert.match(query[0],/download_count<max_downloads/);assert.match(query[0],/revoked_at IS NULL/);assert.match(query[0],/expires_at>now\(\)/);
});

test('commercial HTTP serializers exclude callback codes, cookies and recipient tokens',()=>{
 const {commercialHttpSerializers:s}=require('../dist/lib/commercialHttpLogging');
 assert.doesNotMatch(JSON.stringify(s.req({url:'/auth/google/callback?code=SECRET',headers:{cookie:'SECRET'}})),/SECRET/);
 assert.doesNotMatch(JSON.stringify(s.req({url:'/api/d/SECRET/verify'})),/SECRET/);
 assert.doesNotMatch(JSON.stringify(s.res({statusCode:200,headers:{'set-cookie':'SECRET'}})),/SECRET/);
});

test('commercial server composition separates admin/sender roles and blocks the global audit router',async()=>{
 const {mountCommercialUpload}=require('../dist/commercialUpload');let role='member',canSend=true;
 const query=async(s,p)=>{
  if(s.includes('FROM user_identities'))return{rows:p[2]===other?[]:[{organization_id:org,organization_status:'active',user_id:user,user_status:'active',role,membership_status:'active',can_send:canSend,email:identity.email}]};
  return{rows:[]};
 };
 const pool={query,connect:async()=>({query,release(){}})},app=base();
 mountCommercialUpload(app,pool,{commercial:()=>({})},audit,{...config,nodeEnv:'development',commercial:{origin:'https://send.test'},sso:{sessionSecret:secret,google:{clientId:'test',clientSecret:'test',redirectUri:'https://send.test/auth/google/callback'}}},logger);
 await http(app,async url=>{
  const headers={cookie:cookie()};
  assert.equal((await fetch(url+'/api/session',{headers})).status,200);
  assert.equal((await fetch(url+'/api/audit-logs',{headers})).status,404);
  assert.equal((await fetch(url+'/api/usage',{headers})).status,403);
  assert.equal((await fetch(url+'/api/session',{headers:{...headers,'x-send-organization-id':other}})).status,403);
  role='admin';canSend=false;
  assert.equal((await fetch(url+'/api/usage',{headers})).status,409); // Admin reached own unconfigured allowance, not a role bypass.
  assert.equal((await fetch(url+'/api/transfer-groups',json({senderName:'fixture',to:'recipient@example.invalid'}, {...headers,origin:'https://send.test'}))).status,403);
 });
});

test('existing OTP reissue requires correct code and expiry even after verified_at (real bcrypt, fixture DB)',async()=>{
 const {OtpService}=require('../dist/services/otpService'),{hashOtpCode}=require('../dist/services/tokenService');
 const row={id,code_hash:await hashOtpCode('123456'),recipient_email:'recipient@example.invalid',expires_at:new Date(Date.now()+60000),attempt_count:0,verified_at:new Date()};
 let updates=0;const service=new OtpService({query:async s=>s.startsWith('SELECT')?{rows:[row]}:(updates++,{rows:[]})},10,5);
 assert.equal((await service.verify(id,'wrong')).status,'invalid');assert.equal(updates,1);
 assert.equal((await service.verify(id,'123456')).status,'ok');assert.equal(updates,1);
 row.expires_at=new Date(1);assert.equal((await service.verify(id,'123456')).status,'expired');
 row.attempt_count=5;assert.equal((await service.verify(id,'123456')).status,'locked');
});

for(const name of ['PostgreSQL real transaction/locking + ordered DDL','GCS real PUT/CORS/size/precondition/egress','ClamAV real clean/infected + definition update','SMTP real delivery/retry/current admins','Google/Microsoft real SSO + registered memberships','Production-equivalent sender/recipient end-to-end'])
 test(name,{skip:'Requires approved isolated environment; no DB/Cloud/SMTP/IdP action performed'},()=>{});
