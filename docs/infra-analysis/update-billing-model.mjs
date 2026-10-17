import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire('C:/Users/YoshihisaHagisaka/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {FileBlob,SpreadsheetFile}=require('@oai/artifact-tool');
const out='outputs/secure-send-billing-20261018';await fs.mkdir(out,{recursive:true});
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load('outputs/secure-send-cost-20261017/Secure_Send_Cost_Model.xlsx'));
const inputs=wb.worksheets.getItem('設定と出典'),sum=wb.worksheets.getItem('判断サマリー'),act=wb.worksheets.getItem('実績取得状況');
await fs.writeFile(out+'/before.png',new Uint8Array(await (await wb.render({sheetName:'実績取得状況',range:'A1:E16',scale:1})).arrayBuffer()));
const before=wb.worksheets.getItem('収益試算').getRange('A6:AW41').values;
const b=JSON.parse(await fs.readFile('infra-work/billing-analysis.json','utf8'));
const rates=b.rates;
// Keep FX driver, but source rates are JPY approximations divided by the existing model FX.
for(const [row,key] of [[8,'cpuActive'],[9,'memActive'],[10,'cpuIdle'],[11,'memIdle']]){inputs.getRange('B'+row).values=[[rates[key]/150]];inputs.getRange('D'+row+':E'+row).values=[['請求から逆算・概算','7〜9月の正規費用（円丸め）÷表示使用量÷150。将来単価保証なし。地域係数は1へ。']];}
inputs.getRange('B12').values=[[1]];inputs.getRange('D12:E12').values=[['概算単価へ更新','日本SKU相当を逆算したため地域係数を重ねない。削減・無料枠を将来へ適用しない。']];
for(const row of [13,14,15,34,35,43,44,45,46]){inputs.getRange('D'+row).values=[['構成実測']];}
for(const row of [13,14,15,34,35,43,44,45,46])inputs.getRange('E'+row).values=[['2026-10-18読み取り専用構成収集で確認。docs/secure-send-config-evidence-20261018.md']];
inputs.getRange('A3').values=[['Run概算単価のみ請求CSVで校正。他の利用量・配賦予算は仮定。価格・人数・利用量は変更可能。']];
sum.getRange('A3').values=[['共有請求取得済。Run単価を校正した将来試算。Secure Send実原価の確定値ではない。']];
act.getRange('A3').values=[['7〜9月は四半期合計のみ取得。月別へ分割しない。10月は請求反映時点不明の途中値。']];
act.getRange('E6:E15').values=Array.from({length:10},()=>['共有請求取得済・サービス別帰属未確定。四半期合計は下表。']);
act.getRange('E13').values=[['メール費は未取得。Google Cloud CSVに外部SMTP料金は含まれない。']];
act.getRange('A2').values=[['実績取得状況 2026-10-18']];
act.getRange('A28').values=[['Monitoring取得済: upload/download/scan、GCS、共有SQL。業務SQL集計は未取得。']];
act.getRange('A31:E31').values=[['共有請求・円','7〜9月削減前','7〜9月削減後','10月途中削減後','区分・出典']];
act.getRange('A31:E31').format={fill:'#1F3556',font:{color:'#FFFFFF',bold:true},rowHeight:30};
for(let i=0;i<b.services[0].length;i++){const r=b.services[0][i],oct=b.services[1].find(x=>x.service===r.service);act.getRange(`A${32+i}:E${32+i}`).values=[[r.service,r.gross,r.net,oct?.net??'未掲載','共有実績・Secure Send配賦前']];}
act.getRange('A46:E46').values=[['最小CPU＋メモリ',8187,b.minimum,'SKUなし','7〜9月共有Cloud Run。scan全額帰属不可']];
act.getRange('A48:E48').values=[['scan9月待機推計',b.scanSeptember.grossEstimate,b.scanSeptember.netAllocationEstimate,'期間不一致','実請求ではない。CPU割当でidleを近似・四半期削減率を仮配賦']];
act.getRange('A50:E50').values=[['出典: 7〜9月 SKU CSV','libfile_ceae161333f88191b3ec86f70899a900',null,null,'添付(1)版と内容一致確認。月別・リソース名・プロジェクト列なし']];
act.getRange('A51:E51').values=[['出典: 10月 service CSV','libfile_0178b7b688d081919ef3d8ea32579b4b',null,null,'10月途中、SKUなし。Monitoringと同一終了時刻とは限らない']];
act.getRange('A52:E52').values=[['共有小計',null,b.totals[0].reportedSubtotal,b.totals[1].reportedSubtotal,'Q3合計行との差0.106628円は未解明。円丸め後は一致']];
act.getRange('B32:D48').setNumberFormat('#,##0.00;(#,##0.00);"-"');act.getRange('E32:E52').format={wrapText:true,rowHeight:36};act.getRange('A31:A52').format.columnWidth=34;act.getRange('B31:D52').format.columnWidth=22;
wb.recalculate();
const updated=wb.worksheets.getItem('収益試算').getRange('A6:AW41').values;
const calibrated=JSON.parse(await fs.readFile('secure-send-infra-analysis/docs/infra-analysis/billing-calibrated-scenarios.json','utf8')).filter(r=>r.option==='A');
for(let i=0;i<updated.length;i++){const r=updated[i],expected=calibrated.find(p=>p.companies===r[0]&&p.plan===r[1]&&p.scenario===r[2]);assert.ok(Math.abs(r[31]-expected.infrastructure)<.001);assert.equal(r[19],before[i][19]);}
const base=sum.getRange('H18').values[0][0];inputs.getRange('C52').values=[[6000]];wb.recalculate();const changed=sum.getRange('H18').values[0][0];assert.notEqual(base,changed);inputs.getRange('C52').values=[[5000]];wb.recalculate();
const inspection=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!',options:{useRegex:true,maxResults:50}});
await fs.writeFile(out+'/verification.json',JSON.stringify({base,changed,errors:inspection.ndjson,independentCases:36},null,2));
for(const [sheet,range,file] of [['実績取得状況','A31:E48','billing-preview'],['設定と出典','A6:E15','rates-preview'],['判断サマリー','A5:K15','summary-preview']])await fs.writeFile(out+'/'+file+'.png',new Uint8Array(await (await wb.render({sheetName:sheet,range,scale:1.2})).arrayBuffer()));
await (await SpreadsheetFile.exportXlsx(wb)).save(out+'/Secure_Send_Cost_Model.xlsx');
await fs.writeFile('secure-send-infra-analysis/docs/infra-analysis/billing-calibrated-cost-results.json',JSON.stringify(updated,null,2));
console.log(JSON.stringify({base,changed,errors:inspection.ndjson,path:out+'/Secure_Send_Cost_Model.xlsx'}));
