import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const sources=JSON.parse(await fs.readFile('infra-work/billing-source-extract.json','utf8'));
function csv(text){const rows=[];let row=[],s='',quote=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quote&&text[i+1]==='"'){s+='"';i++;}else quote=!quote;}else if(c===','&&!quote){row.push(s);s='';}else if(c==='\n'&&!quote){row.push(s.replace(/\r$/,''));rows.push(row);row=[];s='';}else s+=c;}if(s||row.length){row.push(s);rows.push(row);}const h=rows.shift();return rows.map(r=>Object.fromEntries(h.map((x,i)=>[x,r[i]??''])));}
const num=s=>Number((s??'').replaceAll(',',''));const tables=sources.map(x=>csv(x.content));
const data=tables.map(t=>t.filter(r=>r['サービスの説明']));
const gross=r=>num(r['正規の費用（¥）']);const net=r=>num(r['四捨五入前の小計（¥）']);
const sum=(a,f)=>a.reduce((v,r)=>v+f(r),0);const sku=id=>data[0].find(r=>r['SKU ID']===id);
const rate=id=>gross(sku(id))/num(sku(id)['使用量']);const effective=id=>net(sku(id))/num(sku(id)['使用量']);
const rates={cpuActive:rate('4856-B847-F1EB'),memActive:rate('02A2-9231-36A6'),cpuIdle:rate('7EBB-8579-2C98'),memIdle:rate('740D-08F2-7A11'),vmCore:rate('EAED-8A05-843B'),vmRam:rate('CB4B-B875-93B4')};
const services=data.map(t=>[...new Set(t.map(r=>r['サービスの説明']))].map(service=>({service,gross:sum(t.filter(r=>r['サービスの説明']===service),gross),net:sum(t.filter(r=>r['サービスの説明']===service),net)})));
const run=services[0].find(r=>r.service==='Cloud Run');const minimum=net(sku('7EBB-8579-2C98'))+net(sku('740D-08F2-7A11'));
const totals=tables.map((t,i)=>({detailSum:sum(data[i],net),reportedSubtotal:num(t.find(r=>Object.values(r).includes('小計'))['四捨五入前の小計（¥）']),reportedTotal:num(t.find(r=>Object.values(r).includes('合計'))['四捨五入前の小計（¥）'])}));
// Q3 exported total differs from subtotal. Preserve it as an unexplained report adjustment.
totals.forEach(t=>assert.ok(Math.abs(t.detailSum-t.reportedSubtotal)<0.00001));
const obs=JSON.parse(await fs.readFile('secure-send-infra-analysis/docs/evidence/20261018-metrics/monthly-summary.json','utf8')).rows;
const metric=(period,last)=>obs.find(r=>r.scope==='ppap-virus-scan'&&r.period===period&&r.metric.endsWith('/'+last)).sum;
const sec=metric('2026-09','billable_instance_time'),cpu=metric('2026-09','allocation_time');
// CPU and memory have same suffix; select exact paths below.
const alloc=(p,k)=>obs.find(r=>r.scope==='ppap-virus-scan'&&r.period===p&&r.metric==='run.googleapis.com/container/'+k+'/allocation_time').sum;
const scanSeptember={idleCpuProxy:Math.max(0,sec-alloc('2026-09','cpu')),idleMemoryProxy:Math.max(0,alloc('2026-09','memory')-2*alloc('2026-09','cpu'))};
scanSeptember.grossEstimate=scanSeptember.idleCpuProxy*rates.cpuIdle+scanSeptember.idleMemoryProxy*rates.memIdle;
scanSeptember.netAllocationEstimate=scanSeptember.idleCpuProxy*effective('7EBB-8579-2C98')+scanSeptember.idleMemoryProxy*effective('740D-08F2-7A11');
const standby30=2592000*(rates.cpuIdle+2*rates.memIdle),vmMonth=720*(2*rates.vmCore+8*rates.vmRam);
const result={source:sources.map(x=>({name:x.name,libraryFileId:x.id,grain:x.name.includes('07-01')?'SKU / whole quarter':'service / partial October'})),warning:'CSV contains no project/resource/month columns. User identifies shared project; filter cannot be independently verified. Amounts are report subtotals, not settled payment. Rates inferred from rounded gross JPY and displayed usage; approximate, not contracted tariff.',totals,services,rates,run,minimum,minimumShare:minimum/run.net,scanSeptember,standby30,vmMonth};
const old=JSON.parse(await fs.readFile('outputs/secure-send-cost-20261017/results.json','utf8'));
const prior=JSON.parse(await fs.readFile('outputs/secure-send-infrastructure-20261018/results.json','utf8'));
const revised=[];
for(const r of prior){const p=old.find(p=>p[0]===r.companies&&p[1]===r.plan&&p[2]===r.scenario);const tx=p[13],s=p[18],warm=r.newScanSeconds,days=2592000;
 const api=tx*.3*(rates.cpuActive+.5*rates.memActive),download=tx*p[8]*.2*(rates.cpuActive+.5*rates.memActive);
 let fixed=r.fixedInfrastructure,compute=r.computeVariable;
 if(r.option==='A'){fixed+=standby30-3499.2;compute=api+s*(rates.cpuActive+.5*rates.memActive)+download+Math.max(0,s*(rates.cpuActive+2*rates.memActive)-Math.min(s,days)*(rates.cpuIdle+2*rates.memIdle));}
 if(r.option==='B'){fixed+=days*(rates.cpuIdle+4*rates.memIdle)-5832;compute=api+warm*(rates.cpuActive+.5*rates.memActive)+download+Math.max(0,warm*(rates.cpuActive+4*rates.memActive)-Math.min(warm,days)*(rates.cpuIdle+4*rates.memIdle));}
 if(['C','D'].includes(r.option))compute=api+download+(warm+Math.max(100,Math.ceil(r.files/1000))*20)*(rates.cpuActive+4*rates.memActive);
 if(r.option==='E'){fixed+=r.workerCount*(vmMonth-9046.5417);compute=api+download;}
 if(r.option==='F'){const app=r.companies===10?1:r.companies===1000?4:2,db=r.companies===10?1:2;fixed+=(app+2*db+r.workerCount)*(vmMonth-9046.5417);}
 const infrastructure=fixed+compute+r.queueVariable+r.commonNonCompute+r.commonReserve;const pre=r.revenue-infrastructure-r.payment-r.customerSupport-r.fixedOperations;
 revised.push({...r,baselineInfrastructure:r.infrastructure,fixedInfrastructure:fixed,computeVariable:compute,infrastructure,preShare:pre,after50:pre-r.revenue*.5,afterBasic:pre-r.companies*500,maxShareFor20pct:pre/r.revenue-.2,calibration:'Q3 rounded gross JPY implied Run/E2 unit rates; all usage/performance/other cost assumptions retained; no credit assumed'});
}
assert.equal(revised.length,216);result.vmBreakEvenSlotHours=(vmMonth+450+3000)/(rates.cpuActive+4*rates.memActive)/3600;result.vmTcoBreakEvenSlotHours=(vmMonth+450+3000+8000)/(rates.cpuActive+4*rates.memActive)/3600;
await fs.mkdir('secure-send-infra-analysis/docs/evidence/20261018-billing',{recursive:true});
await fs.writeFile('secure-send-infra-analysis/docs/evidence/20261018-billing/analysis.json',JSON.stringify(result,null,2));
await fs.writeFile('secure-send-infra-analysis/docs/infra-analysis/billing-calibrated-scenarios.json',JSON.stringify(revised,null,2));
await fs.writeFile('infra-work/billing-analysis.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,standard:revised.filter(r=>r.plan==='Business'&&r.scenario==='標準'&&[10,100,1000].includes(r.companies)).map(r=>({n:r.companies,option:r.option,infra:r.infrastructure,after50:r.after50}))},null,2));
