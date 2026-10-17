import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire('C:/Users/YoshihisaHagisaka/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {FileBlob,SpreadsheetFile}=require('@oai/artifact-tool');
const root='secure-send-infra-analysis/';const out='outputs/secure-send-break-even-20261018';await fs.mkdir(out,{recursive:true});
const rates=JSON.parse(await fs.readFile(root+'docs/evidence/20261018-billing/analysis.json','utf8'));
const prior=JSON.parse(await fs.readFile('outputs/secure-send-cost-20261017/results.json','utf8'));
// Input is the billing-calibrated 4-sheet baseline (remote 95f77d7), not this script's 7-sheet output.
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load('outputs/secure-send-billing-20261018/Secure_Send_Cost_Model.xlsx'));
const cfg=wb.worksheets.add('損益分岐設定'),sim=wb.worksheets.add('損益分岐比較'),growth=wb.worksheets.add('累積赤字');
for(const s of [cfg,sim,growth]){s.showGridLines=false;s.getRange('A1:AZ520').format={font:{name:'Arial',size:10},columnWidth:16,rowHeight:23};}
const put=(s,c,v)=>typeof v==='string'&&v.startsWith('=')?s.getRange(c).formulas=[[v]]:s.getRange(c).values=[[v]];
const head=(s,r,v)=>{s.getRangeByIndexes(r-1,0,1,v.length).values=[v];s.getRangeByIndexes(r-1,0,1,v.length).format={fill:'#1F3556',font:{bold:true,color:'#FFFFFF'},rowHeight:36,wrapText:true};};
const link=(r,c='B')=>`'損益分岐設定'!$${c}$${r}`;
put(cfg,'A1','損益分岐点・段階増強の設定');put(cfg,'A2','実測は共有請求・構成のみ。利用量、増強境界、性能、サポート、成長速度は仮定。価格・配分は未決定。');
head(cfg,4,['プラン','価格/社月','人数','混在比率','区分']);
for(let p=0;p<3;p++){const r=5+p;put(cfg,'A'+r,['Starter','Business','Business Plus'][p]);put(cfg,'B'+r,`='設定と出典'!C${51+p}`);put(cfg,'C'+r,`='設定と出典'!B${51+p}`);put(cfg,'D'+r,[.5,.3,.2][p]);put(cfg,'E'+r,'価格・混在は比較仮定');}
const inputs=[['決済率',.036],['固定運用時給',4000],['Run固定運用h',2],['Hybrid基本運用h',4],['Hybrid追加worker運用h',.5],['VM月額計算資源',rates.vmMonth],['VMディスク/台月',450],['VM群ネットワーク/月',3000],['メール固定/月',2000],['その他固定/月',1500],['定義配信予算/月',500],['VM自営DB追加保存/月',2000],['warm scan時間係数',.3],['VM scan slots/台',2],['業務時間/月',176],['目標scan稼働率',.4],['worker起動秒',20],['最低起動回数/月',100],['ファイル/起動',1000],['Run CPU円/秒',rates.rates.cpuActive],['Run memory円/GiB秒',rates.rates.memActive],['worker memory GiB',4],['キュー円/ファイル Run',3*.4*150/1e6],['キュー円/ファイル Hybrid',2*1024/(1024**4)*40*150]];
inputs.forEach((v,i)=>cfg.getRange(`A${10+i}:B${10+i}`).values=[v]);
head(cfg,36,['段階','企業数下限','企業数上限','専用SQL/月','LB/月','VM API台数','VM DB台数','VM固定運用h']);
const stages=[[1,1,10,18000,0,1,1,8],[2,11,100,18000,4500,2,2,12],[3,101,500,40000,4500,2,2,20],[4,501,1000,70000,4500,4,2,32]];cfg.getRange('A37:H40').values=stages;
put(cfg,'A42','段階境界は計画仮定。前評価の10/100/500/1,000社予算を区間化。11/101/501社で増強する想定。');
put(cfg,'A43','VM worker台数は各段階上限の処理量を収容するよう先行確保。性能実測による増強トリガーではない。');
head(cfg,46,['利用','送信/人月','file/送信','MiB/file','DL倍率','OTP/送信','scan秒/file','サポート分/社']);
for(let i=0;i<3;i++)for(let c=0;c<8;c++)put(cfg,String.fromCharCode(65+c)+(47+i),`='設定と出典'!${String.fromCharCode(65+c)}${57+i}`);
put(cfg,'A51','標準に高位顧客が混在する比率');put(cfg,'B51',.2);put(cfg,'A52','会社数ではなく利用量を平均化する期待値。少数社では比率どおりの実社数にならない。');
head(cfg,55,['プラン','利用','非計算インフラ/社','通常API秒/社','DL API秒/社','scan秒/社','file/月社','サポート/社']);
const drivers=[];
for(let p=0;p<3;p++)for(let u=0;u<3;u++){const row=56+p*3+u,sr=47+u,pr=5+p;
 const v={C:`=${link(pr,'C')}*50*0+50+${link(pr,'C')}*2+(${link(pr,'C')}*B${sr})*(C${sr}*(1*.005+(2+E${sr})*.0004)/1000*150+(1+F${sr})*.1+12/1048576*.5*150+8/1e6*.4*150)+(${link(pr,'C')}*B${sr}*C${sr}*D${sr}/1024)*(28/30*.025*150+E${sr}*.12*150)`,D:`=${link(pr,'C')}*B${sr}*.3`,E:`=${link(pr,'C')}*B${sr}*E${sr}*.2`,F:`=${link(pr,'C')}*B${sr}*C${sr}*G${sr}`,G:`=${link(pr,'C')}*B${sr}*C${sr}`,H:`=(H${sr}+${link(pr,'C')}*.1)/60*B11`};
 put(cfg,'A'+row,['Starter','Business','Business Plus'][p]);put(cfg,'B'+row,['低位','標準','高位'][u]);for(const [c,f]of Object.entries(v))put(cfg,c+row,'='+f.slice(1).replaceAll(link(pr,'C'),`$C$${pr}`));drivers.push({p,u,row});}
// This block deliberately retains prior non-compute assumptions; no zero-cost extrapolation from free tiers.
put(cfg,'A67','出典: docs/evidence/20261018-billing/analysis.json。Run/E2は丸め済み正規費用÷使用量の概算。');
put(cfg,'A68','非計算費は既存モデルの保存21+7日、通信0.12USD/GiB、メール等を継承。共有請求の全額配賦はしない。');
put(cfg,'A69','Run起動費は最低100回分＋file/1000回分を計上する上限寄り近似。min=0・非同期・4GiBは未実装。');
cfg.getRange('B10:B33').format.font.color='#0000FF';cfg.getRange('D5:D7').format.font.color='#0000FF';cfg.getRange('B37:H40').format.font.color='#0000FF';cfg.getRange('B51').format.font.color='#0000FF';
cfg.getRange('A1:A70').format.columnWidth=37;cfg.getRange('B1:H70').format.columnWidth=20;cfg.getRange('B5:B7').setNumberFormat('#,##0');cfg.getRange('D5:D7').setNumberFormat('0.0%');
put(sim,'A1','損益分岐・利益成長（円/月）');put(sim,'A2','初回黒字と増強後も黒字の最小社数を分離。検索範囲1〜1,000社。範囲外を成立不能と断定しない。');
const hdr=['構成','プラン構成','利用','配分率','運用含む','平均単価','変動インフラ/社','サポート/社','限界利益/社','初回黒字社数','以降1000社まで黒字','10社差引','30社差引','50社差引','100社差引','300社差引','1000社差引','固定1','固定2','固定3','固定4','段階1候補','段階2候補','段階3候補','段階4候補','段階1最終赤字','段階2最終赤字','段階3最終赤字','段階4最終赤字','重みStarter','重みBusiness','重みPlus','非計算/社','API秒/社','DL秒/社','warm scan秒/社','file/社','support/社','worker1','worker2','worker3','worker4'];head(sim,4,hdr);sim.freezePanes.freezeRows(4);sim.freezePanes.freezeColumns(3);
const cases=[];let row=5;
for(const arch of ['Run','Hybrid','VM'])for(let mix=0;mix<4;mix++)for(let use=0;use<4;use++)for(const share of [0,.2,.3,.4,.5])for(const ops of [0,1]){const r=row++,w=['AD','AE','AF'];put(sim,'A'+r,arch);put(sim,'B'+r,['Starter','Business','Business Plus','混在'][mix]);put(sim,'C'+r,['低位','標準','高位','標準+高位混在'][use]);put(sim,'D'+r,share);put(sim,'E'+r,ops);
 for(let p=0;p<3;p++)put(sim,w[p]+r,mix===3?`=${link(5+p,'D')}/SUM('損益分岐設定'!$D$5:$D$7)`:Number(mix===p));
 put(sim,'F'+r,`=AD${r}*${link(5)}+AE${r}*${link(6)}+AF${r}*${link(7)}`);
 for(const [target,source]of [['AG','C'],['AH','D'],['AI','E'],['AJ','F'],['AK','G'],['AL','H']]){const terms=[0,1,2].map(p=>{const rr=56+p*3+(use===3?1:use);const v=`'損益分岐設定'!$${source}$${rr}`;const vv=use===3?`(${v}*(1-${link(51)})+'損益分岐設定'!$${source}$${58+p*3}*${link(51)})`:v;return `${w[p]}${r}*${vv}`;});put(sim,target+r,'='+terms.join('+')+(target==='AJ'?`*1`:''));}
 // Parenthesize the weighted scan sum before applying warm-engine assumption.
put(sim,'AJ'+r,`=(${sim.getRange('AJ'+r).formulas[0][0].slice(1)})*${link(22)}`);
const api=`(AH${r}+AI${r})*(${link(29)}+0.5*${link(30)})`,workerRate=`(${link(29)}+${link(31)}*${link(30)})`;
put(sim,'G'+r,`=AG${r}+${arch==='VM'?'0':api}+AK${r}*${link(arch==='Run'?32:33)}${arch==='Run'?`+(AJ${r}+AK${r}/${link(28)}*${link(26)})*${workerRate}`:''}`);
put(sim,'H'+r,`=AL${r}*E${r}`);put(sim,'I'+r,`=F${r}*(1-D${r}-${link(10)})-G${r}-H${r}`);
for(let st=0;st<4;st++){const sr=37+st,fix=['R','S','T','U'][st],workers=['AM','AN','AO','AP'][st],candidate=['V','W','X','Y'][st],negative=['Z','AA','AB','AC'][st];
put(sim,workers+r,`=MAX(${st===0?1:2},ROUNDUP('損益分岐設定'!C${sr}*AJ${r}/(${link(23)}*${link(24)}*3600*${link(25)}),0))`);
const common=`${link(18)}+${link(19)}+${link(20)}+'損益分岐設定'!E${sr}`;
let cost=arch==='Run'?`${common}+'損益分岐設定'!D${sr}+${link(26)}*${link(27)}*${workerRate}+E${r}*${link(12)}*${link(11)}`:arch==='Hybrid'?`${common}+'損益分岐設定'!D${sr}+${workers}${r}*(${link(15)}+${link(16)})+${link(17)}+E${r}*(${link(13)}+(${workers}${r}-1)*${link(14)})*${link(11)}`:`${common}+('損益分岐設定'!F${sr}+2*'損益分岐設定'!G${sr}+${workers}${r})*(${link(15)}+${link(16)})+${link(17)}+${link(21)}+E${r}*'損益分岐設定'!H${sr}*${link(11)}`;
put(sim,fix+r,'='+cost);put(sim,candidate+r,`=IF(I${r}<=0,1001,IF(MAX('損益分岐設定'!B${sr},ROUNDUP(${fix}${r}/I${r},0))<='損益分岐設定'!C${sr},MAX('損益分岐設定'!B${sr},ROUNDUP(${fix}${r}/I${r},0)),1001))`);
put(sim,negative+r,`=IF(I${r}<=0,'損益分岐設定'!C${sr},IF('損益分岐設定'!C${sr}*I${r}-${fix}${r}<0,'損益分岐設定'!C${sr},IF('損益分岐設定'!B${sr}*I${r}-${fix}${r}>=0,0,ROUNDUP(${fix}${r}/I${r},0)-1)))`);}
put(sim,'J'+r,`=IF(MIN(V${r}:Y${r})>1000,"範囲内なし",MIN(V${r}:Y${r}))`);put(sim,'K'+r,`=IF(MAX(Z${r}:AC${r})>=1000,"範囲内なし",MAX(1,MAX(Z${r}:AC${r})+1))`);
for(const [j,n]of [10,30,50,100,300,1000].entries()){const c=String.fromCharCode(76+j);put(sim,c+r,`=${n}*I${r}-${['R','S','T','U'][n<=10?0:n<=100?1:n<=500?2:3]}${r}`);}
cases.push({row:r,arch,mix,use,share,ops});}
sim.getRange(`D5:D${row-1}`).setNumberFormat('0%');sim.getRange(`F5:I${row-1}`).setNumberFormat('#,##0;(#,##0);"-"');sim.getRange(`L5:U${row-1}`).setNumberFormat('#,##0;(#,##0);"-"');sim.getRange(`I5:Q${row-1}`).conditionalFormats.add('cellIs',{operator:'lessThan',formula:0,format:{fill:'#FDE9E7',font:{color:'#B71C1C'}}});sim.getRange('A1:C485').format.columnWidth=23;sim.getRange('J1:K485').format.columnWidth=24;
put(growth,'A1','契約増加と累積営業差引（資金繰り予測とは別）');put(growth,'A2','初期赤字許容額は未設定。開発・初期導入・営業費・税・入金時差は未計上。累積赤字は運営差引のみ。');
put(growth,'A4','比較ケース行（損益分岐比較）');put(growth,'B4',cases.find(c=>c.arch==='Run'&&c.mix===3&&c.use===1&&c.share===.3&&c.ops===1).row);
put(growth,'A5','月間新規契約数');put(growth,'B5',3);put(growth,'A6','初月開始契約数');put(growth,'B6',0);put(growth,'A7','月間解約率');put(growth,'B7',0);
put(growth,'A8','選択ケース');put(growth,'B8',`=INDEX('損益分岐比較'!A5:A484,B4-4)&" / "&INDEX('損益分岐比較'!B5:B484,B4-4)&" / "&INDEX('損益分岐比較'!C5:C484,B4-4)`);
head(growth,10,['月','契約社数','月額差引','累積差引','累計赤字月損失','必要運営資金・最大谷']);
for(let m=1;m<=36;m++){const r=m+10;put(growth,'A'+r,m);put(growth,'B'+r,m===1?'=$B$6+$B$5':`=B${r-1}*(1-$B$7)+$B$5`);put(growth,'C'+r,`=IF(B${r}>1000,"範囲外",B${r}*INDEX('損益分岐比較'!I5:I484,$B$4-4)-IF(B${r}<=10,INDEX('損益分岐比較'!R5:R484,$B$4-4),IF(B${r}<=100,INDEX('損益分岐比較'!S5:S484,$B$4-4),IF(B${r}<=500,INDEX('損益分岐比較'!T5:T484,$B$4-4),INDEX('損益分岐比較'!U5:U484,$B$4-4)))))`);put(growth,'D'+r,m===1?`=C${r}`:`=D${r-1}+C${r}`);put(growth,'E'+r,m===1?`=MAX(0,-C${r})`:`=E${r-1}+MAX(0,-C${r})`);put(growth,'F'+r,`=MAX(0,-MIN($D$11:D${r}))`);}
growth.getRange('A1:A49').format.columnWidth=38;growth.getRange('B1:F49').format.columnWidth=24;growth.getRange('B4:B7').format.font.color='#0000FF';growth.getRange('C11:F46').setNumberFormat('#,##0;(#,##0);"-"');
wb.recalculate();
// Independent JS model for controls, including each stage and integer search.
const rowValues=sim.getRange(`A5:AP${row-1}`).values;const check=[];
for(let i=0;i<cases.length;i++){const c=cases[i],v=rowValues[i];const profit=n=>n*v[8]-v[17+(n<=10?0:n<=100?1:n<=500?2:3)];let first=null,lastBad=0;for(let n=1;n<=1000;n++){if(profit(n)>=0&&first===null)first=n;if(profit(n)<0)lastBad=n;}assert.equal(v[9],first??'範囲内なし');assert.equal(v[10],lastBad===1000?'範囲内なし':lastBad+1);check.push({...c,price:v[5],variableInfra:v[6],variableSupport:v[7],contribution:v[8],firstBE:v[9],sustainedBE:v[10],fixed:v.slice(17,21),profits:v.slice(11,17)});}
for(const d of drivers){const p=prior.find(p=>p[0]===10&&p[1]===['Starter','Business','Business Plus'][d.p]&&p[2]===['低位','標準','高位'][d.u]);const actual=cfg.getRange('C'+d.row).values[0][0];assert.ok(Math.abs(actual-(p[20]+p[21]+p[25]+p[26]+p[27]+p[28]+p[29])/10)<.00001);}
const base=growth.getRange('F46').values[0][0];growth.getRange('B5').values=[[10]];wb.recalculate();const changed=growth.getRange('F46').values[0][0];assert.notEqual(base,changed);growth.getRange('B5').values=[[3]];const mixBefore=sim.getRange('F140').values[0][0];cfg.getRange('D5').values=[[.6]];wb.recalculate();assert.notEqual(sim.getRange('F140').values[0][0],mixBefore);cfg.getRange('D5').values=[[.5]];wb.recalculate();
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!',options:{useRegex:true,maxResults:50}});console.log(errors.ndjson);
await fs.writeFile(out+'/verification.json',JSON.stringify({cases:cases.length,baseFundingNeed:base,fastFundingNeed:changed,errors:errors.ndjson},null,2));
for(const [sheet,range,name]of [['損益分岐設定','A4:H7','settings'],['損益分岐比較','A4:Q14','comparison'],['累積赤字','A10:F23','growth']])await fs.writeFile(out+'/'+name+'.png',new Uint8Array(await (await wb.render({sheetName:sheet,range,scale:1})).arrayBuffer()));
await (await SpreadsheetFile.exportXlsx(wb)).save(out+'/Secure_Send_Cost_Model.xlsx');
await fs.writeFile(root+'docs/infra-analysis/break-even-results.json',JSON.stringify(check,null,2));
await fs.writeFile(out+'/growth-default.json',JSON.stringify(growth.getRange('A11:F46').values,null,2));
console.log(JSON.stringify({cases:cases.length,base,changed,selected:check.filter(c=>c.arch==='Run'&&c.mix===3&&c.use===1&&c.ops===1)},null,2));
