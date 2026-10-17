import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire('C:/Users/YoshihisaHagisaka/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {FileBlob,SpreadsheetFile}=require('@oai/artifact-tool');
const root='secure-send-infra-analysis/';const out='outputs/secure-send-seat-ranges-20261018';await fs.mkdir(out,{recursive:true});
const prior=JSON.parse(await fs.readFile(root+'docs/infra-analysis/break-even-results.json','utf8'));
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load('outputs/secure-send-break-even-20261018/Secure_Send_Cost_Model.xlsx'));
const cfg=wb.worksheets.add('人数レンジ設定'),prices=wb.worksheets.add('人数別料金'),sim=wb.worksheets.add('人数レンジ採算');
for(const s of [cfg,prices,sim]){s.showGridLines=false;s.getRange('A1:AJ260').format={font:{name:'Arial',size:10},columnWidth:17,rowHeight:24};}
const put=(s,c,v)=>typeof v==='string'&&v.startsWith('=')?s.getRange(c).formulas=[[v]]:s.getRange(c).values=[[v]];
const head=(s,r,v)=>{s.getRangeByIndexes(r-1,0,1,v.length).values=[v];s.getRangeByIndexes(r-1,0,1,v.length).format={fill:'#1F3556',font:{bold:true,color:'#FFFFFF'},rowHeight:36,wrapText:true};};
const ref=(c,r)=>`'人数レンジ設定'!$${c}$${r}`;
put(cfg,'A1','基本料金レンジ＋送信者従量の比較設定');put(cfg,'A2','価格・配分・人数構成・容量上限は仮定。受信者は無料。売上全額ではなく基本料金のみ配分。');
put(cfg,'A4','送信者 円/名月');put(cfg,'B4',200);
head(cfg,6,['案','上限1','基本1','上限2','基本2','上限3','基本3','上限4','基本4']);
cfg.getRange('A7:I11').values=[['A',10,1500,50,3000,50,3000,50,3000],['B',5,1000,20,2000,50,4000,50,4000],['C',5,1000,10,1500,30,2500,50,4000],['A2 上位2500',10,1500,50,2500,50,2500,50,2500],['A3 11〜15移行',10,1500,15,3000,50,3000,50,3000]];
put(cfg,'A13','比較配分率');cfg.getRange('B13:D13').values=[[.2,.3,.4]];
put(cfg,'A14','運用・サポート含む 1/0');put(cfg,'B14',1);put(cfg,'A15','送信者当りUL上限 GiB/月');put(cfg,'B15',1);put(cfg,'A16','送信者当りDL予算 GiB/月');put(cfg,'B16',2);
put(cfg,'A17','容量ケースは高位要求を上限内へ縮小。既存ファイルDLを直接遮断する実装案ではない。');
head(cfg,19,['送信者数','小規模型','既存比較型','中規模型','均等1〜50']);
const profiles=[{1:.2,3:.25,5:.25,10:.2,20:.08,50:.02},{5:.5,20:.3,50:.2},{5:.1,10:.1,20:.2,30:.3,50:.3},Object.fromEntries(Array.from({length:50},(_,i)=>[i+1,.02]))];
for(let n=1;n<=50;n++)cfg.getRange(`A${19+n}:E${19+n}`).values=[[n,...profiles.map(p=>p[n]??0)]];
put(cfg,'A70','分布は実測ではない。重みは各列の合計で正規化。小数社の期待値で、少数契約では実構成による。');
head(cfg,72,['利用','インフラ固定/社','インフラ/名','support固定/社','support/名','UL GiB/名月','DL GiB/名月']);
for(let u=0;u<3;u++){const r=73+u,lo=prior.find(x=>x.arch==='Run'&&x.mix===0&&x.use===u&&x.ops===1&&x.share===.3),hi=prior.find(x=>x.arch==='Run'&&x.mix===2&&x.use===u&&x.ops===1&&x.share===.3),g=n=>`'損益分岐比較'!G${n}`,h=n=>`'損益分岐比較'!H${n}`;
 put(cfg,'A'+r,['低位','標準','高位'][u]);put(cfg,'C'+r,`=(${g(hi.row)}-${g(lo.row)})/45`);put(cfg,'B'+r,`=${g(lo.row)}-5*C${r}`);put(cfg,'E'+r,`=(${h(hi.row)}-${h(lo.row)})/45`);put(cfg,'D'+r,`=${h(lo.row)}-5*E${r}`);
put(cfg,'F'+r,`='損益分岐設定'!B${47+u}*'損益分岐設定'!C${47+u}*'損益分岐設定'!D${47+u}/1024`);put(cfg,'G'+r,`=F${r}*'損益分岐設定'!E${47+u}`);}
put(cfg,'A77','高位要求の取扱比率');put(cfg,'B77',`=MIN(1,B15/F75,B16/G75)`);
head(cfg,79,['段階','会社下限','会社上限','固定インフラ','固定運用']);
const source=prior.find(x=>x.arch==='Run'&&x.mix===3&&x.use===1&&x.share===.3&&x.ops===0);
for(let i=0;i<4;i++){const r=80+i;put(cfg,'A'+r,i+1);put(cfg,'B'+r,`='損益分岐設定'!B${37+i}`);put(cfg,'C'+r,`='損益分岐設定'!C${37+i}`);put(cfg,'D'+r,`='損益分岐比較'!${['R','S','T','U'][i]}${source.row}`);put(cfg,'E'+r,`='損益分岐設定'!B11*'損益分岐設定'!B12`);}
put(cfg,'A85','出典: 901b4ccの専用SQL・非同期Run/min=0/4GiBモデル。共有実請求は原価校正の資料で、将来固定費は仮定。');
put(cfg,'A86','容量制限時も送信者別2円とサポート負荷は維持。他の利用量連動費だけ取扱比率に比例。');
put(cfg,'A87','A3は基本料金1500→3000を11〜15名で300円ずつ引上げ。送信者200円/名は全員に課金。');
cfg.getRange('B4').format.font.color='#0000FF';cfg.getRange('B7:I11').format.font.color='#0000FF';cfg.getRange('B13:D16').format.font.color='#0000FF';cfg.getRange('B20:E69').format.font.color='#0000FF';cfg.getRange('B20:E69').setNumberFormat('0.0%');cfg.getRange('A1:A90').format.columnWidth=39;
head(prices,4,['送信者数','A基本','B基本','C基本','A2基本','A3基本','A月額','B月額','C月額','A2月額','A3月額','A前人数差','B前人数差','C前人数差','A2前人数差','A3前人数差']);put(prices,'A1','1〜50名の月額税別料金');put(prices,'A2','月額=基本料金＋送信者数×200円。人数増の差額には通常の200円も含む。');
for(let n=1;n<=50;n++){const r=n+4;put(prices,'A'+r,n);for(let a=0;a<5;a++){const sr=7+a,c=String.fromCharCode(66+a),total=String.fromCharCode(71+a),delta=String.fromCharCode(76+a);const f=a===4?`MIN(${ref('E',sr)},${ref('C',sr)}+MAX(0,A${r}-${ref('B',sr)})*(${ref('E',sr)}-${ref('C',sr)})/(${ref('D',sr)}-${ref('B',sr)}))`:`IF(A${r}<=${ref('B',sr)},${ref('C',sr)},IF(A${r}<=${ref('D',sr)},${ref('E',sr)},IF(A${r}<=${ref('F',sr)},${ref('G',sr)},${ref('I',sr)})))`;
put(prices,c+r,'='+f);put(prices,total+r,`=${c}${r}+A${r}*${ref('B',4)}`);put(prices,delta+r,n===1?'—':`=${total}${r}-${total}${r-1}`);}}
prices.getRange('B5:P54').setNumberFormat('#,##0;(#,##0);"-"');prices.freezePanes.freezeRows(4);
head(sim,4,['案','顧客構成','利用','配分率','平均人数','基本売上/社','送信者売上/社','月額売上/社','基本配分/社','変動インフラ/社','support/社','限界利益/社','初回黒字社数','継続黒字社数','10社差引','30社差引','50社差引','100社差引','300社差引','1000社差引','固定1','固定2','固定3','固定4','候補1','候補2','候補3','候補4','最終赤字1','最終赤字2','最終赤字3','最終赤字4']);put(sim,'A1','人数レンジ別・基本料金のみ配分');put(sim,'A2','運用/サポート込みが初期値。240ケース。1〜1,000社、段階増強と再赤字を反映。');sim.freezePanes.freezeRows(4);sim.freezePanes.freezeColumns(3);
const cases=[];let row=5;for(let a=0;a<5;a++)for(let p=0;p<4;p++)for(let u=0;u<4;u++)for(let k=0;k<3;k++){const r=row++,weight=`'人数レンジ設定'!$${String.fromCharCode(66+p)}$20:$${String.fromCharCode(66+p)}$69`,pricecol=String.fromCharCode(66+a),sr=73+Math.min(u,2);
put(sim,'A'+r,['A','B','C','A2','A3'][a]);put(sim,'B'+r,['小規模型','既存比較型','中規模型','均等'][p]);put(sim,'C'+r,['低位','標準','高位','高位・容量上限'][u]);put(sim,'D'+r,`=${ref(String.fromCharCode(66+k),13)}`);
put(sim,'E'+r,`=SUMPRODUCT('人数レンジ設定'!$A$20:$A$69,${weight})/SUM(${weight})`);put(sim,'F'+r,`=SUMPRODUCT('人数別料金'!$${pricecol}$5:$${pricecol}$54,${weight})/SUM(${weight})`);put(sim,'G'+r,`=E${r}*${ref('B',4)}`);put(sim,'H'+r,`=F${r}+G${r}`);put(sim,'I'+r,`=F${r}*D${r}`);
put(sim,'J'+r,u===3?`=${ref('B',75)}+E${r}*(2+(${ref('C',75)}-2)*${ref('B',77)})`:`=${ref('B',sr)}+E${r}*${ref('C',sr)}`);put(sim,'K'+r,`=(${ref('D',sr)}+E${r}*${ref('E',sr)})*${ref('B',14)}`);put(sim,'L'+r,`=H${r}*(1-'損益分岐設定'!B10)-I${r}-J${r}-K${r}`);
for(let st=0;st<4;st++){const cr=80+st,fix=['U','V','W','X'][st],cand=['Y','Z','AA','AB'][st],last=['AC','AD','AE','AF'][st];put(sim,fix+r,`=${ref('D',cr)}+${ref('E',cr)}*${ref('B',14)}`);put(sim,cand+r,`=IF(L${r}<=0,1001,IF(MAX(${ref('B',cr)},ROUNDUP(${fix}${r}/L${r},0))<=${ref('C',cr)},MAX(${ref('B',cr)},ROUNDUP(${fix}${r}/L${r},0)),1001))`);put(sim,last+r,`=IF(L${r}<=0,${ref('C',cr)},IF(${ref('C',cr)}*L${r}-${fix}${r}<0,${ref('C',cr)},IF(${ref('B',cr)}*L${r}-${fix}${r}>=0,0,ROUNDUP(${fix}${r}/L${r},0)-1)))`);}
put(sim,'M'+r,`=IF(MIN(Y${r}:AB${r})>1000,"範囲内なし",MIN(Y${r}:AB${r}))`);put(sim,'N'+r,`=IF(MAX(AC${r}:AF${r})>=1000,"範囲内なし",MAX(1,MAX(AC${r}:AF${r})+1))`);for(const [i,n]of [10,30,50,100,300,1000].entries())put(sim,String.fromCharCode(79+i)+r,`=${n}*L${r}-${['U','V','W','X'][n<=10?0:n<=100?1:n<=500?2:3]}${r}`);cases.push({row:r,a,p,u,k});}
sim.getRange('D5:D244').setNumberFormat('0%');sim.getRange('F5:X244').setNumberFormat('#,##0;(#,##0);"-"');sim.getRange('J5:T244').conditionalFormats.add('cellIs',{operator:'lessThan',formula:0,format:{fill:'#FDE9E7',font:{color:'#B71C1C'}}});sim.getRange('B1:C245').format.columnWidth=23;sim.getRange('M1:N245').format.columnWidth=22;
wb.recalculate();const values=sim.getRange('A5:AF244').values,result=[];for(let i=0;i<cases.length;i++){const c=cases[i],v=values[i];let first=null,lastBad=0;for(let n=1;n<=1000;n++){const profit=n*v[11]-v[20+(n<=10?0:n<=100?1:n<=500?2:3)];if(profit>=0&&first===null)first=n;if(profit<0)lastBad=n;}assert.equal(v[12],first??'範囲内なし');assert.equal(v[13],lastBad===1000?'範囲内なし':lastBad+1);result.push({...c,scheme:v[0],profile:v[1],usage:v[2],share:v[3],seats:v[4],base:v[5],sender:v[6],revenue:v[7],distribution:v[8],variableInfra:v[9],support:v[10],contribution:v[11],firstBE:v[12],sustainedBE:v[13],profits:v.slice(14,20),fixed:v.slice(20,24)});}
const tariff=prices.getRange('A5:P54').values;for(let n=1;n<=50;n++){const base=[n<=10?1500:3000,n<=5?1000:n<=20?2000:4000,n<=5?1000:n<=10?1500:n<=30?2500:4000,n<=10?1500:2500,Math.min(3000,1500+Math.max(0,n-10)*300)];for(let a=0;a<5;a++){assert.equal(tariff[n-1][1+a],base[a]);assert.equal(tariff[n-1][6+a],base[a]+200*n);}}
const sample=result.find(r=>r.a===1&&r.p===1&&r.u===1&&r.k===1);assert.equal(sample.distribution,sample.base*.3);assert.ok(Math.abs(sample.distribution-sample.revenue*.3)>1);
const before=sim.getRange('H'+sample.row).values[0][0];cfg.getRange('B4').values=[[250]];wb.recalculate();assert.ok(Math.abs(sim.getRange('H'+sample.row).values[0][0]-before-sample.seats*50)<1e-7);cfg.getRange('B4').values=[[200]];const quotaBefore=cfg.getRange('B77').values[0][0];cfg.getRange('B15').values=[[.5]];wb.recalculate();assert.ok(cfg.getRange('B77').values[0][0]<quotaBefore);cfg.getRange('B15').values=[[1]];wb.recalculate();
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!',options:{useRegex:true,maxResults:50}});console.log(errors.ndjson);
await fs.writeFile(out+'/verification.json',JSON.stringify({cases:240,tariffChecks:250,errors:errors.ndjson,capacityScale:cfg.getRange('B77').values[0][0]},null,2));
for(const [sheet,range,name]of [['人数レンジ設定','A6:I16','settings'],['人数別料金','A8:P20','tariffs'],['人数レンジ採算','A4:N13','profit']])await fs.writeFile(out+'/'+name+'.png',new Uint8Array(await (await wb.render({sheetName:sheet,range,scale:1})).arrayBuffer()));
await (await SpreadsheetFile.exportXlsx(wb)).save(out+'/Secure_Send_Cost_Model.xlsx');await fs.writeFile(root+'docs/infra-analysis/seat-range-results.json',JSON.stringify(result,null,2));await fs.writeFile(root+'docs/infra-analysis/seat-range-tariffs.json',JSON.stringify(tariff,null,2));
console.log(JSON.stringify(result.filter(r=>r.p===1&&r.u===1),null,2));
