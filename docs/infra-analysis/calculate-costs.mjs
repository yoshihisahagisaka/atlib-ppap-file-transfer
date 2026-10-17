import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const prior=JSON.parse(await fs.readFile(new URL('./prior-model-results.json',import.meta.url),'utf8'));
const cfg=JSON.parse(await fs.readFile(new URL('./assumptions.json',import.meta.url),'utf8'));
const vmMonth=cfg.vmHourlyReference*cfg.vmRegionFactor*cfg.days*24*cfg.fx;
const scanActivePerSecond=(cfg.cpuActive+4*cfg.memActive)*cfg.runRegionFactor*cfg.fx;
const idle4=(cfg.cpuIdle+4*cfg.memIdle)*cfg.days*86400*cfg.runRegionFactor*cfg.fx;
const options={A:'既存同期・共有SQL（PR2）',B:'専用project・同期clamd・共有SQL',C:'専用project・非同期Run・共有SQL',D:'専用project・非同期Run・専用SQL',E:'専用project・Run＋VM・専用SQL',F:'専用project・VM群・自営Postgres'};
const results=[];
for(const r of prior){
 const [n,plan,scenario,seats,price]=r;const files=r[14],tx=r[13],warmSec=r[10]*cfg.warmScanFactor;
 const s=files*warmSec;const starts=Math.max(cfg.minStarts,Math.ceil(files/cfg.filesPerStart));
 const reserve=r[20]+r[21];
 // Common non-compute: GCS operations, email, logs/requests, storage and egress.
 const nonCompute=r[25]+r[26]+r[27]+r[28]+r[29];
 const apiUpload=tx*0.3*(cfg.cpuActive+0.5*cfg.memActive)*cfg.runRegionFactor*cfg.fx;
 const apiDownload=r[23];
 const queue=files*cfg.taskOpsPerFile/1e6*cfg.taskUsdPerMillion*cfg.fx;
 const workerRun=(s+starts*cfg.coldSeconds)*scanActivePerSecond;
 const capacity=cfg.vmScanSlots*cfg.businessHoursMonth*3600*cfg.targetUtilization;
 const vmCount=Math.max(n===10?1:2,Math.ceil(s/capacity));
 const db=cfg.dedicatedDbMonthly[n];const lb=n===10?0:cfg.dedicatedLbMonthly;
 for(const id of Object.keys(options)){
  let fixed=0,compute=0,queueCost=0,ops=8000,workerCount=0,dbBudget=cfg.sharedDbMonthly;
  if(id==='A'){fixed=r[30];compute=r[22]+r[23]+r[24];}
  if(id==='B'){
   fixed=idle4+cfg.sharedDbMonthly+cfg.mailFixedMonthly+cfg.otherMonthly+cfg.definitionMirrorMonthly;
   compute=apiUpload+s*(cfg.cpuActive+0.5*cfg.memActive)*cfg.runRegionFactor*cfg.fx+apiDownload+
     Math.max(0,s*(cfg.cpuActive+4*cfg.memActive)-Math.min(s,cfg.days*86400)*(cfg.cpuIdle+4*cfg.memIdle))*cfg.runRegionFactor*cfg.fx;
  }
  if(id==='C'||id==='D'){
   dbBudget=id==='D'?db:cfg.sharedDbMonthly;
   fixed=dbBudget+cfg.mailFixedMonthly+cfg.otherMonthly+cfg.definitionMirrorMonthly+(id==='D'?lb:0);
   compute=apiUpload+apiDownload+workerRun;queueCost=queue;
  }
  if(id==='E'){
   dbBudget=db;workerCount=vmCount;
   fixed=db+lb+cfg.mailFixedMonthly+cfg.otherMonthly+cfg.definitionMirrorMonthly+
     vmCount*(vmMonth+cfg.vmDiskMonthly)+cfg.vmFleetNetworkMonthly;
   compute=apiUpload+apiDownload;
   // Pub/Sub pull assumed 1KiB work-item, publish+delivery; free allowance excluded.
   queueCost=files*2*1024/(1024**4)*40*cfg.fx;
   ops=(4+0.5*(vmCount-1))*cfg.opsHourly;
  }
  if(id==='F'){
   dbBudget=0;workerCount=vmCount;
   const appVms=n===10?1:n===1000?4:2,dbVms=n===10?1:2;
   fixed=appVms*(vmMonth+450)+dbVms*(vmMonth*2+900)+vmCount*(vmMonth+450)+
     cfg.vmFleetNetworkMonthly+lb+cfg.mailFixedMonthly+cfg.otherMonthly+cfg.definitionMirrorMonthly+2000;
   compute=0;queueCost=files*2*1024/(1024**4)*40*cfg.fx;
   ops=({10:8,100:12,500:20,1000:32}[n])*cfg.opsHourly;
  }
  const infrastructure=fixed+compute+queueCost+reserve+nonCompute;
  const support=r[33];const payment=r[32];const revenue=r[19];
  const pre=revenue-infrastructure-payment-support-ops;
  const after50=pre-revenue*.5;
  const afterBasic=pre-n*500;
  const deltaInfra=r[31]-infrastructure;
  const deltaAfter=after50-r[36];
  results.push({option:id,name:options[id],companies:n,plan,scenario,seatsPerCompany:seats,revenue,
    fixedInfrastructure:fixed,computeVariable:compute,queueVariable:queueCost,commonNonCompute:nonCompute,
    commonReserve:reserve,infrastructure,payment,customerSupport:support,fixedOperations:ops,preShare:pre,after50,afterBasic,
    infrastructureSavingVsPR2:deltaInfra,totalSavingVsPR2:deltaAfter,dbBudget,workerCount,
    oldScanSeconds:r[18],newScanSeconds:s,files,uploadGiB:r[15],downloadGiB:r[16],egressCost:r[29],
    maxShareFor20pct:pre/revenue-.2,availableAvgSlots:vmCount*2,vmCapacitySlotSeconds:capacity});
 }
}
for(const r of results){assert.ok(Math.abs(r.preShare-(r.revenue-r.infrastructure-r.payment-r.customerSupport-r.fixedOperations))<1e-7);if(r.option==='A'){const old=prior.find(p=>p[0]===r.companies&&p[1]===r.plan&&p[2]===r.scenario);assert.ok(Math.abs(r.infrastructure-old[31])<1e-7);assert.ok(Math.abs(r.after50-old[36])<1e-7);}}
assert.equal(results.length,216);

await fs.writeFile(process.argv[2] || 'infrastructure-results.json',JSON.stringify(results,null,2));
console.log('216 scenarios and 36 PR2 reconciliations PASS');
