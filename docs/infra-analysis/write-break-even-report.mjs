import fs from 'node:fs/promises';
const root='secure-send-infra-analysis/';const out='outputs/secure-send-break-even-20261018';
const rs=JSON.parse(await fs.readFile(root+'docs/infra-analysis/break-even-results.json','utf8'));
const find=(arch='Run',mix=3,use=1,share=.3,ops=1)=>rs.find(r=>r.arch===arch&&r.mix===mix&&r.use===use&&r.share===share&&r.ops===ops);
const y=n=>Math.round(n).toLocaleString('ja-JP'),be=c=>c.firstBE===c.sustainedBE?c.firstBE:`${c.firstBE} / ${c.sustainedBE}`;
const t=(h,rs)=>'| '+h.join(' | ')+' |\n| '+h.map(()=>'---').join(' | ')+' |\n'+rs.map(r=>'| '+r.join(' | ')+' |').join('\n');
const names={Run:'Cloud Run・非同期scan・専用SQL',Hybrid:'Run API＋scan VM・専用SQL',VM:'VM API/scan・自営Postgres'};
const growths=[];const selected=find();for(const pace of [1,3,10]){let cumulative=0,lowest=0,losses=0,firstPositive=null,recovered=null;const months=[];for(let m=1;m<=36;m++){const n=m*pace,profit=n*selected.contribution-selected.fixed[n<=10?0:n<=100?1:n<=500?2:3];cumulative+=profit;lowest=Math.min(lowest,cumulative);losses+=Math.max(0,-profit);if(profit>=0&&firstPositive===null)firstPositive=m;if(cumulative>=0&&recovered===null)recovered=m;months.push({month:m,companies:n,profit,cumulative});}growths.push({pace,maxOperatingFunding:-lowest,sumLosses:losses,firstPositiveMonth:firstPositive,cumulativeRecoveryMonth:recovered,cumulativeAt12:months[11].cumulative,cumulativeAt36:cumulative,months});}
const md=`# Secure Send 損益分岐企業数・利益成長・累積赤字（2026-10-18）

初期少数顧客での赤字は許容するという追加方針を反映。赤字を理由にパイロットを否定しない。今回の判定対象は、黒字化に必要な契約企業数、限界利益、増強後の再赤字、累積運営損失。赤字許容額・販売価格・配分率は決定していない。

## 推奨する経営判断用の基準ケース

仮価格5名3,000円／20名5,000円／50名8,000円を標準利用の検証価格として維持し、専用project・Cloud Run API・GCS直接転送・非同期scan・専用SQLを将来原価の基準とする。売上配分30%を比較の中心、20%を余裕優先案、50%を契約数と利用上限を確認する条件付き案とする。これは統括レーンへ戻す提案であり正式な料金・配分決定ではない。

非同期、min=0、常駐clamd・4GiBは未実装・性能未検証。1か月パイロットで同期scan/min=1を維持する場合は、本結果の低いRun原価をそのまま約束せず、旧同期構成と追加工数を再評価する。現行Production変更はしていない。

混在はStarter50%・Business30%・Plus20%の仮定。平均単価4,600円/社。少数社では比率を小数社で平均化した期待値であり、実契約のプラン構成によって変動する。正確な同比率は10社単位で実現する。

${t(['構成・標準混在・運用込み','配分20% 最低社数','配分30% 最低社数','配分50% 最低社数'],Object.entries(names).map(([a,n])=>[n,be(find(a,3,1,.2)),be(find(a,3,1,.3)),be(find(a,3,1,.5))]))}

Runの同比率を正確に維持する場合は20%/30%/50%配分でそれぞれ20/20/40社。各セルは最初に差引0円以上となる社数。初回と増強後の社数が異なる場合は「初回 / 以降1,000社まで黒字」。1,000社超は未評価。

## 固定費と段階増強

${t(['構成・標準混在','1〜10社 インフラ固定','11〜100社','101〜500社','501〜1,000社','固定運用/月（段階順）'],Object.keys(names).map(a=>{const c=find(a),no=find(a,3,1,.3,0);return[a,...no.fixed.map(y),c.fixed.map((v,i)=>y(v-no.fixed[i])).join(' / ')];}))}

専用SQL18,000→40,000→70,000円/月、LB0→4,500円/月は計画予算。11/101/501社で段階を切るのは比較用仮定で、性能実測で確定した境界ではない。Run起動の最低100回分約11円は固定に含む。メール2,000・監視等1,500・定義配信500円/月を計上。Run固定運用は2h×4,000=8,000円/月。DB・監視の実請求額ではない。

Hybrid/VMは段階上限のscan量に対応するworkerを先行確保し、最低1台、11社以上2台、必要量に応じ追加。2slot/台×176h/月×稼働40%の仮定。高位利用では段階ごとの必要台数と固定費がさらに増える。VM中心は自営DB・APIの台数と保守時間も段階増。上限まで先行確保する保守的な予算化であり、実際のスケール台数や性能保証ではない。

## 1社あたり変動費

${t(['Run基準','低位 インフラ/サポート','標準 インフラ/サポート','高位 インフラ/サポート'],[0,1,2,3].map(m=>[[ 'Starter','Business','Business Plus','混在'][m],...[0,1,2].map(u=>{const c=find('Run',m,u);return y(c.variableInfra)+' / '+y(c.variableSupport);})]))}

上記は円/社月。企業別50円、送信者別2円、送信・保存・通信・キュー費を含む。決済手数料3.6%と配分は別で、限界利益=価格×(1−配分率−3.6%)−変動インフラ−サポート。固定運用を含む/除くケースを両方計算し、含まない場合はサポートも除く。メール/DB/LBのインフラ費は除外しない。

低位/標準/高位は既存モデルを継承: 送信/人月5/20/80、file/送信1/2/3、MiB/file2/10/50、DL倍率1/1.5/2、scan秒1/2/5、企業別サポート3/8/20分＋送信者別0.1分/月。warm scan係数0.3は未実測。GCS保存21＋削除後7日、DL単価0.12USD/GiB、為替150は従来仮定。高容量の段階料金割引は保守的に控除しない。

## プラン単独の損益分岐社数（Run・運用/サポート込み）

${t(['プラン','利用','配分0%','20%','30%','40%','50%'],[0,1,2].flatMap(m=>[0,1,2].map(u=>[['Starter','Business','Business Plus'][m],['低位','標準','高位'][u],...[0,.2,.3,.4,.5].map(s=>be(find('Run',m,u,s)))])))}

## 混在の利用量・配分・運用費比較

${t(['混在利用','運用/サポート','0%','20%','30%','40%','50%'],[0,1,2,3].flatMap(u=>[0,1].map(o=>[['低位','標準','高位','標準＋高位20%'][u],o?'含む':'除く',...[0,.2,.3,.4,.5].map(s=>be(find('Run',3,u,s,o)))])))}

標準＋高位20%のRun・30%配分・運用込み限界利益は約${y(find('Run',3,3).contribution)}円/社。企業数が増えても固定費を吸収できるとは限らず、1,000社では赤字。全社高位利用では限界利益自体が負の条件が多く、現単価・原価条件のまま社数を増やすと損失が増える。まず容量・保存期間・DL回数・送信量の上限や超過対応を設計し、価格引上げと比較する。上限値は未決定。

## 契約数別の月額差引（標準混在・運用込み）

${t(['構成','配分','10社','30社','50社','100社','300社','1,000社'],Object.keys(names).flatMap(a=>[0,.2,.3,.4,.5].map(s=>[a,(s*100)+'%',...find(a,3,1,s).profits.map(y)])))}

全480ケースはExcelとJSONに収録（3構成×4プラン構成×4利用ケース×5配分率×運用有無）。モデルは段階ごとに利益を計算し、1〜1,000社の整数企業数で初回/継続黒字を検証した。初回黒字後に増強で再赤字となる例: Starter低位・Run・20%配分・運用費除外は10社で初回黒字、11社で再赤字、12社から継続黒字。単純な固定費÷平均限界利益だけを最終社数としない。

## 累積赤字と回収時期

Run・標準混在・30%配分・運用込み、開始契約0、解約0、各月冒頭に契約増・月額全額計上、36か月を例示。獲得速度は予測ではなく感応度。開発費/営業費/初期導入/税/入金時差は未計上なので、実際の投資額・必要手元資金とは異なる。

${t(['新規契約/月','単月黒字月','累積回収月','運営差引の最大累積赤字','12月累積差引','36月累積差引'],growths.map(g=>[g.pace,g.firstPositiveMonth??'36月内なし',g.cumulativeRecoveryMonth??'36月内なし',y(g.maxOperatingFunding),y(g.cumulativeAt12),y(g.cumulativeAt36)]))}

最大累積赤字は累積差引の最も深い谷、赤字月損失合計は赤字月だけの合計で、別指標としてExcelに表示。初期赤字許容額は入力・推奨していない。Excelの累積赤字シートでは比較ケース行、月間新規数、開始契約数、解約率を変更できる。

## 実測と未確認・判断事項

共有実請求: 7〜9月42,818円、Cloud Run5,388.88円・最小インスタンス関連5,315.57円。scan9月の約2,078円は配賦推計であり実請求ではない。今回の分岐試算は専用構成の予算と利用仮定に基づき、現行の少量利用実績を商用利用へ比例拡大したものではない。CSV・Monitoringの詳細と制約は実請求照合追補を参照。

比較提案: 標準混在・Run・30%なら期待値18社（同比率で20社）、20%なら15社（20社）、50%なら33社（40社）。標準単独30%はStarter28社、Business16社、Plus9社。Hybrid30%は35社、VM30%は74社。初期赤字を受容して契約拡大を検証する方針と整合するが、高位利用制限が前提。運用除外だけの数値で価格・配分を決めない。

統括へ: 利用上限と超過対応、比較配分率20〜30%を中心とするか、初期投資・赤字許容額、契約獲得ペース、専用DB/非同期scanのパイロット採用範囲。P0工数と約1か月目標の調整も未決定。料金・契約・正式提供範囲は本レーンで確定しない。

検証: 480ケースの初回/継続黒字を各1〜1,000社の整数走査と照合、既存9パターンの非計算変動費と照合、混在比率・獲得速度変更の再計算、数式エラー走査、追加3シート描画確認。ネイティブExcel再計算は未確認。Production/DB/インフラ変更なし、main未マージ。
`;
await fs.writeFile(root+'docs/secure-send-break-even-20261018.md',md);await fs.writeFile(root+'docs/infra-analysis/break-even-growth-scenarios.json',JSON.stringify(growths,null,2));
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');let html='';const lines=md.split('\n');for(let i=0;i<lines.length;i++){const l=lines[i];if(l.startsWith('| ')){const rows=[];while(i<lines.length&&lines[i].startsWith('| '))rows.push(lines[i++]);i--;html+='<div class="scroll"><table>'+rows.filter((_,j)=>j!==1).map((r,j)=>'<tr>'+r.split('|').slice(1,-1).map(v=>`<${j?'td':'th'}>${esc(v.trim())}</${j?'td':'th'}>`).join('')+'</tr>').join('')+'</table></div>';continue;}const h=l.match(/^(#{1,3}) (.*)/);if(h)html+=`<h${h[1].length}>${esc(h[2])}</h${h[1].length}>`;else if(l)html+='<p>'+esc(l)+'</p>';}
const full=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Secure Send 損益分岐評価</title><style>body{font-family:"Yu Gothic",Meiryo,sans-serif;background:#f8fafc;color:#203047;line-height:1.85;margin:0}main{max-width:1200px;margin:auto;padding:35px;background:white}h1{font-size:27px}h2{font-size:21px;border-bottom:2px solid #f28c38;margin-top:38px}p{font-size:14px}table{border-collapse:collapse;font-size:12px;width:100%}th{background:#1f3556;color:white}th,td{padding:9px;border-bottom:1px solid #dde3ea;text-align:left}tr:nth-child(even){background:#f1f5f9}.scroll{overflow:auto}</style><main>${html}</main></html>`;
await fs.writeFile(out+'/Secure_Send_Break_Even_Report.html',full);await fs.writeFile(root+'docs/infra-analysis/Secure_Send_Break_Even_Report.html',full);
for(const f of ['secure-send-billing-reconciliation-20261018.md','secure-send-infrastructure-evaluation-20261018.md']){const path=root+'docs/'+f;let text=await fs.readFile(path,'utf8');const marker='> 追加方針: 初期少数社の赤字は許容。[損益分岐・利益成長・累積赤字](secure-send-break-even-20261018.md)を経営判断の優先資料とする。\n\n';if(!text.startsWith(marker))await fs.writeFile(path,marker+text);}
console.log(JSON.stringify(growths.map(({months,...r})=>r),null,2));
