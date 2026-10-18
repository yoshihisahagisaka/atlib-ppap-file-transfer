/* Additional controls for the existing audit screen. No customer files or raw audit detail. */
async function loadCommercialHistory() {
  const controls=document.createElement('form');controls.style.marginBottom='1rem';
  function field(label,type,value) {
    const wrapper=document.createElement('label');wrapper.textContent=label+' ';
    const input=document.createElement('input');input.type=type;input.value=value;input.required=true;
    wrapper.appendChild(input);controls.appendChild(wrapper);controls.append(' ');return input;
  }
  const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Tokyo'});
  const from=field('開始日（日本時間）','date',today),to=field('終了日（当日を含む）','date',today);
  const kind=document.createElement('select');
  for(const [value,label]of [['transfers','送信履歴'],['audit','監査ログ']]) {
    const option=document.createElement('option');option.value=value;option.textContent=label;kind.appendChild(option);
  }
  kind.setAttribute('aria-label','履歴種別');controls.appendChild(kind);
  function button(label,type='button'){const b=document.createElement('button');b.textContent=label;b.type=type;controls.append(' ',b);return b;}
  button('表示','submit');const download=button('CSV出力'),previous=button('前の100件'),next=button('次の100件');previous.disabled=true;next.disabled=true;
  const note=document.createElement('p');note.textContent='自社のみ。受信URL発行回数は送信グループ単位で、実ファイル取得の完了数ではありません。状態・宛先等は取得時点の記録です。企業への帰属を確定できない旧記録は含みません。CSVの日時はUTCです。';
  controls.appendChild(note);document.getElementById('status').before(controls);
  const cols=[['recordedAt','記録日時'],['sender','送信者'],['to','To'],['cc','CC'],['filename','ファイル名'],['bytes','記録容量(bytes)'],['status','取得時状態コード'],['event','監査イベント'],['groupIssuedCount','グループURL発行回数'],['auditId','監査ID'],['actor','操作主体']];
  const head=document.querySelector('#log-table thead tr');head.replaceChildren();
  for(const [,label]of cols){const th=document.createElement('th');th.textContent=label;head.appendChild(th);}
  let offset=0,lastRange=null;
  const range=()=>({kind:kind.value,from:new Date(from.value+'T00:00:00+09:00').toISOString(),
    to:new Date(Date.parse(to.value+'T00:00:00+09:00')+86400000).toISOString()});
  async function response(r){if(!r.ok){let e;try{e=await r.json();}catch{}throw Error(e?.error??`HTTP ${r.status}`);}return r;}
  async function list() {
    setStatus('読み込み中...');
    const r=await response(await fetch('/api/audit-logs?'+new URLSearchParams({...lastRange,offset:String(offset),limit:'100'})));
    const data=await r.json(),body=document.querySelector('#log-table tbody');body.replaceChildren();
    for(const row of data.entries){const tr=document.createElement('tr');for(const [key]of cols){const td=document.createElement('td');td.textContent=row[key]??'';tr.appendChild(td);}body.appendChild(tr);}
    document.getElementById('log-table-wrap').style.display='block';document.getElementById('empty-msg').style.display=data.entries.length?'none':'block';
    next.disabled=!data.hasMore;previous.disabled=offset===0;setStatus('');
  }
  controls.addEventListener('submit',async e=>{e.preventDefault();try{lastRange=range();offset=0;await list();}catch(err){setStatus(err.message);}});
  next.addEventListener('click',async()=>{try{offset+=100;await list();}catch(err){offset-=100;setStatus(err.message);}});
  previous.addEventListener('click',async()=>{try{offset=Math.max(0,offset-100);await list();}catch(err){setStatus(err.message);}});
  download.addEventListener('click',async()=>{
    download.disabled=true;try{
      const r=await response(await fetch('/api/audit-logs/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...range(),format:'csv'})}));
      const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download='secure-send-history.csv';a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);setStatus('CSVを生成しました。監査ID: '+r.headers.get('X-Audit-Id'));
    }catch(err){setStatus(err.message+'（期間を短くして再実行してください）');}finally{download.disabled=false;}
  });
  lastRange=range();await list();
}
