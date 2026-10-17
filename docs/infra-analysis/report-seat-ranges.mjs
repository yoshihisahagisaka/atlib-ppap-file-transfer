import fs from 'node:fs/promises';
const root='secure-send-infra-analysis/',out='outputs/secure-send-seat-ranges-20261018';
const general=JSON.parse(await fs.readFile(root+'docs/infra-analysis/seat-range-results.json','utf8'));
const pira=JSON.parse(await fs.readFile(root+'docs/infra-analysis/pira-seat-range-results.json','utf8'));
const dist=JSON.parse(await fs.readFile(root+'docs/infra-analysis/pira-sender-distribution.json','utf8'));
const tariffs=JSON.parse(await fs.readFile(root+'docs/infra-analysis/seat-range-tariffs.json','utf8'));
const y=n=>Math.round(n).toLocaleString('ja-JP'),pct=n=>(100*n).toFixed(1)+'%',be=r=>r.firstBE===r.sustainedBE?r.firstBE:`${r.firstBE} / ${r.sustainedBE}`;
const t=(h,rs)=>'| '+h.join(' | ')+' |\n| '+h.map(()=>'---').join(' | ')+' |\n'+rs.map(r=>'| '+r.join(' | ')+' |').join('\n');
const find=(a,sc=1,u=1,share=1)=>pira.find(r=>r.a===a&&r.sc===sc&&r.u===u&&r.share===share);
const boundaries=[];for(let a=0;a<5;a++)for(let n=2;n<=50;n++){const prev=tariffs[n-2],now=tariffs[n-1];if(now[1+a]!==prev[1+a])boundaries.push({a,from:n-1,to:n,basicDelta:now[1+a]-prev[1+a],old:prev[6+a],new:now[6+a],delta:now[6+a]-prev[6+a],ratio:(now[6+a]-prev[6+a])/prev[6+a]});}
const md=`# Secure Send 人数レンジ料金比較・PIRA市場仮説との統合（2026-10-18）

## 結論と推奨候補

**検証候補はCの4段階（1〜5名1,000円、6〜10名1,500円、11〜30名2,500円、31〜50名4,000円）＋送信者200円/名月。** 基本料金のみ20〜30%配分を比較の中心とする。受信者はアカウント不要・無料。価格・配分・正式提供範囲は未決定。人数上限・価格は設定で変更可能とし、今回コードやProduction料金を変更していない。

Cは小規模の入口をBと同額に保ち、6名時の増額をBの1,200円から700円へ、最大境界増額をBの2,200円から1,700円へ抑える。Aは最も説明しやすく利益が大きいが、1〜5名で基本料金がCより500円高く、10→11名で月額48.6%増になる。Cは境界が3つあり、契約画面と「基本料金＋有効送信者数×200円」の合計表示が必要。価格への反応や成約率は未計測なので、Cが成約を増やすとは断定しない。

PIRA実態に最適と確定する根拠はまだない。PR14にPIRA傘下企業の業種・従業員規模の実分布がなく、以下の人数分布は全国企業ベンチマークによる仮説。基準ケースでCとBの平均月額差は約${y(find(1).revenue-find(2).revenue)}円/社、最低契約数はB${be(find(1))}社に対しC${be(find(2))}社で、境界負担軽減を比較する余地がある。利益最大化だけを優先すればAだが、その追加料金に対する支払意向は未確認。

## 既存PR #14の確認結果

参照: https://github.com/yoshihisahagisaka/atlib-corporate-site/pull/14 、head SHA40b7610f78e4e92702150cc73633688795bed459、未マージ。公表されたPIRA正会員74団体、傘下約10,000社等と、全国統計・Windows PCシナリオを分離した記録である。約10,000社の集計範囲・重複・正会員別内訳は未確認で、契約母数や販売予測にそのまま使わない。

業種別・従業員規模別のPIRA実分布は未公表。会員団体名から読み取れる製造、農業、介護、物流等は傘下企業の業種構成比ではない。業種構成の重み付けは未実施。現場作業中心なら送信職務比率が低く、事務/営業/設計等が多ければ高くなる、という感度を置くにとどめる。

従業員数は就業者規模、Windows PC台数は保護対象端末数、Secure Send有料送信者数は外部送信の権限を持つ人で別の数量。Mac等からの送信や共用端末もあるため、PC→送信者の換算は行わない。PR14のWindows仮定はExcelに独立した参照表として保持し、送信者の算式から参照していない。

## 送信者分布の作り方と母集団

PR14引用の令和3年経済センサス全国企業等: 1〜4人2,256,386、5〜9人581,301、10〜19人323,929、20〜49人202,148、50〜99人65,941、100人以上64,887。計3,494,592企業等。PIRA標本ではなく、これを規模構成の仮置きに用いた。

従業者代表値3/7/14/34/74/150人、外部送信を担う人の割合を低位10%・基準25%・高位50%、人数は切上げ・最低1名と仮定。契約企業に少なくとも1人送信者がいるという条件付きで、送信需要ゼロの企業比率や採用率は未推計。「送信者数シナリオ」と「1人当たり利用頻度の低位/標準/高位」は独立に組み合わせる。

${t(['有料送信者帯','送信者低位','送信者基準','送信者高位'],[0,1,2,3,4].map(i=>[['1〜5名','6〜10名','11〜20名','21〜50名','51名以上'][i],...dist.map(d=>pct(d.shares[i]))]))}

1〜50名の条件付平均送信者は低位${dist[0].averagePricedSenders.toFixed(2)}名、基準${dist[1].averagePricedSenders.toFixed(2)}名、高位${dist[2].averagePricedSenders.toFixed(2)}名。高位の51名以上${pct(dist[2].shares[4])}は要見積であり、50名へ丸めず、価格0円としても計上しない。以下の平均単価・差引・損益分岐は1〜50名企業に限定して再正規化。全PIRA企業の平均売上と誤認しない。

この代表点近似は6/11/21/31名の料金境界に敏感。各帯内の実人数、100人以上の裾、PIRA特有の規模偏りは未確認。Excelで代表従業者と送信者率を変更可能。全国の小規模企業優位がPIRAにも成立するかは別途確認する。

## 1〜50名の月額料金（税別）

基本料金＋全有効送信者数×200円。送信者部分は配分対象外。51名以上は今回未設定。

${t(['送信者名','A 2段階','B 3段階','C 4段階'],tariffs.map(r=>[r[0],y(r[6]),y(r[7]),y(r[8])]))}

## 境界人数での負担

${t(['案','人数増','前月額→新月額','基本料金増','総増額','上昇率'],boundaries.filter(b=>b.a<3).map(b=>[['A','B','C'][b.a],b.from+'→'+b.to,y(b.old)+'→'+y(b.new),y(b.basicDelta),y(b.delta),pct(b.ratio)]))}

通常の1名追加200円と、基本料金の段差を分けた。短期的に課金送信者を減らす誘因やアカウント共有を避けるため、有効送信者の定義・増減の反映時期・日割りの扱いは統括で判断する。受信者は人数へ加えない。

## 想定顧客構成別の平均月額（PIRAとは別の比較用分布）

${t(['仮分布','平均送信者','A','B','C'],[0,1,2,3].map(p=>{const r=general.find(r=>r.a===0&&r.p===p&&r.u===1&&r.k===1);return[['小規模型','既存比較型','中規模型','1〜50均等'][p],r.seats.toFixed(2),...[0,1,2].map(a=>y(general.find(r=>r.a===a&&r.p===p&&r.u===1&&r.k===1).revenue))];}))}

小規模型は1/3/5/10/20/50名を20/25/25/20/8/2%、既存比較型は5/20/50名を50/30/20%、中規模型は5/10/20/30/50名を10/10/20/30/30%。いずれも仮分布。全国ベンチマークによるPIRAシナリオとも混同しない。

## PIRA感応度・平均単価と損益分岐（標準利用、運用込み）

${t(['送信者分布','案','平均月額/社','基本料金原資/社','30%配分/社','限界利益/社・30%','BE20%','BE30%','BE40%'],[0,1,2].flatMap(sc=>[0,1,2].map(a=>{const r=find(a,sc);return[['低位','基準','高位'][sc],['A','B','C'][a],y(r.revenue),y(r.base),y(r.distribution),y(r.contribution),...[0,1,2].map(k=>be(find(a,sc,1,k)))];})))}

損益分岐は1〜1,000社の整数で検証。「初回 / 継続」の場合、増強で再赤字になり、後者から1,000社まで黒字を維持する。継続黒字の社数を契約目標の比較に優先する。価格反応、プラン構成、獲得速度で実際の社数は変わる。

売上配分の算式は **基本料金×配分率**。差引は月額全体に決済3.6%、基本配分、変動インフラ、サポート、固定インフラ、固定運用を控除。原資は基本料金の売上総額であり、費用控除後の利益ではない。

## 月額売上・差引の成長（送信者基準、標準利用、基本30%配分）

${t(['案','指標','10社','30社','50社','100社','300社','1,000社'],[0,1,2].flatMap(a=>{const r=find(a);return[[['A','B','C'][a],'売上',...[10,30,50,100,300,1000].map(n=>y(n*r.revenue))],[['A','B','C'][a],'差引',...r.profits.map(y)],[['A','B','C'][a],'基本料金原資',...[10,30,50,100,300,1000].map(n=>y(n*r.base))]];}))}

基準Cの100社は売上約${y(find(2).revenue100)}円、基本料金原資約${y(find(2).sharePool100)}円、30%配分約${y(find(2).distribution*100)}円、差引約${y(find(2).profits[3])}円。開発・営業・初期導入・税・事故対応を除く。営業利益ではない。

## 利用量と容量上限

${t(['案・送信者基準','利用頻度','変動infra/社','サポート/社','限界利益/社・30%','BE 初回/継続','100社差引','1,000社差引'],[0,1,2].flatMap(a=>[0,1,2,3].map(u=>{const r=find(a,1,u);return[['A','B','C'][a],['低位','標準','高位','高位・容量上限'][u],y(r.infra),y(r.support),y(r.contribution),be(r),y(r.profits[3]),y(r.profits[5])];})))}

容量上限例は送信者1人当たり月UL1GiB・DL予算2GiBを企業内でプール。5名なら5/10GiB、20名なら20/40GiB、50名なら50/100GiB。平均保存は21日＋soft-delete7日の従来仮定。標準要求はUL0.391GiB/DL0.586GiB/名月で上限内、高位要求はUL11.719GiB/DL23.438GiB/名月。高位の取扱量を約8.53%へ抑える近似であり、上限を入れるだけで同じ大量利用を安く処理できるという意味ではない。

サポートは高位の20分/社＋0.1分/送信者のまま維持し、送信者別予備費2円も減らさない。制限を超える送信の抑制、追加枠/上位プラン、保存期限・DL回数制限が別途必要。既に通知済みの受信者DLを突然遮断する実装は提案していない。DL予算を安全に制御する方式、GCS実通信と認可回数の差、顧客の利便性は未検証。

1ファイル上限だけでは月間通信原価を抑えきれない。月間送信量、保存日数、DL倍率が主要因。利用上限の具体値はこの財務感度から業務適合性を確認して決め、今回確定しない。容量による独立原価管理を人数課金と併用する。

## Aの境界価格差を緩和する代替

${t(['案','10→11名の増額','特徴','PIRA基準ARPU','30%配分BE'],[0,3,4].map(a=>{const b=boundaries.find(b=>b.a===a&&b.to===11),r=find(a);return[['A 原案','A2 上位基本2500','A3 11〜15名移行'][[0,3,4].indexOf(a)],y(b.delta)+'円（'+pct(b.ratio)+'）',['2段階・上位3000','2段階を維持し上位500円減','上位基本料金を300円ずつ増。月額は500円ずつ増'][[0,3,4].indexOf(a)],y(r.revenue),be(r)];}))}

A2は上位の売上が下がる分、費用を抑える仕組みや送信者料金で吸収できるか確認する。A3は11→15名で基本料金を1800/2100/2400/2700/3000円とする移行控除方式で、大きな一段差を抑えるが純粋な2段階より説明が複雑。小規模1〜5名のAの基本料金1500円は残る。どちらも比較候補で正式価格ではない。

## 原価・構成の出典と不確実性

原価は901b4ccまでのCloud Run中心モデルを再利用: 専用project/専用SQL、API＋GCS直接転送、非同期scan/min=0/4GiB・warm scan0.3仮定。現行Productionは同期・min=1であり、移行未実施。固定インフラ1〜10社22,011円、11〜100社26,511円、101〜500社48,511円、501〜1,000社78,511円に固定運用8,000円/月を加算する。境界・専用SQL予算・性能は未実測の計画値。

7〜9月共有請求42,818円、Cloud Run5,388.88円・最小関連5,315.57円は実レポート。scan9月約2,078円は配賦推計。これらを専用商用環境の確定費用や各顧客の実測利用と扱わない。Run/E2概算単価の校正以外、容量・利用頻度・運用・サポートは仮定を保持した。

## 統括へ戻す推奨と次の確認

検証順はC4段階＋送信者200円、基本料金20〜30%配分、容量枠を伴う標準利用。PIRA仮説基準・標準利用のC最低契約数は20% ${be(find(2,1,1,0))}社、30% ${be(find(2,1,1,1))}社、40% ${be(find(2,1,1,2))}社。送信者低位の30%では${be(find(2,0,1,1))}社で、初回黒字後の増強による再赤字を見込む。初期赤字を許容する方針のまま、継続黒字に必要な規模と獲得ペースで判断する。

PIRAの実態に基づく最終選択には、同意を得た企業別の業種、従業員数、Windows PC数、有効送信者数、月間送信件数/容量、保存・DL倍率、料金提示への反応が必要。PR14の方針に沿い100社程度を検証の目安とするが、新規調査や連絡は今回行っていない。特に人数境界5/6・10/11・20/21・30/31近辺は帯内代表値で判断しない。

料金/配分率、51名以上の提供条件、容量超過時対応、送信者定義/休止/日割り、検証環境の構成・追加工数は統括判断。Production/DB/料金設定の変更なし。既存Guard PR14や他開発レーンは変更せず、Secure Send PR3へ参照付きで記録する。

検証: 1〜50名×5料金案の算式を独立照合、一般分布240ケース・PIRA仮説180ケースの初回/継続黒字を1〜1,000社で走査。送信者料金・容量上限・送信者率変更の再計算、数式エラー走査、追加5シートを描画確認。ネイティブExcel再計算は未検証。以前の価格案・比較は履歴として残し、本追補を現在の料金感度分析として優先する。
`;
await fs.writeFile(root+'docs/secure-send-seat-range-pira-pricing-20261018.md',md);await fs.writeFile(root+'docs/infra-analysis/seat-range-boundaries.json',JSON.stringify(boundaries,null,2));
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');let html='';const lines=md.split('\n');for(let i=0;i<lines.length;i++){const l=lines[i];if(l.startsWith('| ')){const rows=[];while(i<lines.length&&lines[i].startsWith('| '))rows.push(lines[i++]);i--;html+='<div class="scroll"><table>'+rows.filter((_,j)=>j!==1).map((r,j)=>'<tr>'+r.split('|').slice(1,-1).map(v=>`<${j?'td':'th'}>${esc(v.trim())}</${j?'td':'th'}>`).join('')+'</tr>').join('')+'</table></div>';continue;}const h=l.match(/^(#{1,3}) (.*)/);if(h)html+=`<h${h[1].length}>${esc(h[2])}</h${h[1].length}>`;else if(l)html+='<p>'+esc(l).replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')+'</p>';}
const full=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Secure Send 人数料金・PIRA統合評価</title><style>body{font-family:"Yu Gothic",Meiryo,sans-serif;background:#f8fafc;color:#203047;line-height:1.85;margin:0}main{max-width:1250px;margin:auto;background:white;padding:36px}h1{font-size:27px}h2{font-size:21px;border-bottom:2px solid #f28c38;margin-top:40px}p{font-size:14px}table{font-size:12px;border-collapse:collapse;width:100%}th{background:#1f3556;color:white}th,td{padding:9px;text-align:left;border-bottom:1px solid #dde3ea}tr:nth-child(even){background:#f1f5f9}.scroll{overflow:auto}</style><main>${html}</main></html>`;
await fs.writeFile(out+'/Secure_Send_PIRA_Pricing_Report.html',full);await fs.writeFile(root+'docs/infra-analysis/Secure_Send_PIRA_Pricing_Report.html',full);
for(const f of ['secure-send-break-even-20261018.md','secure-send-cost-analysis-20261017.md']){const path=root+'docs/'+f,text=await fs.readFile(path,'utf8'),marker='> 現在の料金感度分析: [人数レンジ・基本料金のみ配分・PIRA仮説統合](secure-send-seat-range-pira-pricing-20261018.md)。以下は旧人数パック/売上全体配分の履歴比較。正式価格は未決定。\n\n';if(!text.startsWith(marker))await fs.writeFile(path,marker+text);}
console.log(JSON.stringify({baseline:pira.filter(r=>r.a<3&&r.sc===1&&r.u===1),lowC:find(2,0),boundaries:boundaries.filter(b=>b.a<3)},null,2));
