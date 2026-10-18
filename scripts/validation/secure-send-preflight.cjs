// Read-only validation DB preparation. Never reads .env, application DATABASE_URL, secrets or customer values.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function validateTarget(value) {
 if(!value)throw Object.assign(new Error('VALIDATION_DB_NOT_CONFIGURED'),{skip:true});
 let u;try{u=new URL(value);}catch{throw Error('INVALID_VALIDATION_TARGET');}
 if(!['postgres:','postgresql:'].includes(u.protocol)||!['localhost','127.0.0.1'].includes(u.hostname)||
    !/^\/[A-Za-z0-9_]*commercial_usage_test$/.test(u.pathname)||u.search)throw Error('DEDICATED_LOCAL_VALIDATION_DB_REQUIRED');
 return value;
}
async function collect(connectionString) {
 const {Pool}=require('pg'),pool=new Pool({connectionString:validateTarget(connectionString),max:1,connectionTimeoutMillis:5000});
 let c;
 try {
  c=await pool.connect();await c.query('BEGIN READ ONLY');await c.query("SET LOCAL statement_timeout='10s'");await c.query("SET LOCAL lock_timeout='2s'");
  const tables=['schema_migrations','organizations','users','user_identities','memberships','transfer_groups','transfers','audit_logs','transfer_group_recipients','send_usage_periods','send_usage_reservations'];
  const meta=(await c.query(`SELECT current_database() AS database,current_user AS role,current_setting('transaction_read_only') AS read_only`)).rows[0];
  const columns=(await c.query(`SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name=ANY($1::text[]) ORDER BY table_name,ordinal_position`,[tables])).rows;
  const has=t=>columns.some(x=>x.table_name===t),hasColumn=(t,col)=>columns.some(x=>x.table_name===t&&x.column_name===col);
  const ledger=has('schema_migrations')?(await c.query('SELECT filename,applied_at FROM public.schema_migrations ORDER BY filename')).rows:null;
  const constraints=(await c.query(`SELECT t.relname AS table_name,k.conname,k.contype,pg_get_constraintdef(k.oid) AS definition
    FROM pg_constraint k JOIN pg_class t ON t.oid=k.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname=ANY($1::text[]) ORDER BY t.relname,k.conname`,[tables])).rows;
  const indexes=(await c.query(`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public'
    AND tablename=ANY($1::text[]) ORDER BY tablename,indexname`,[tables])).rows;
  const acl=(await c.query(`SELECT t.relname AS table_name,has_table_privilege(t.oid,'SELECT') AS can_select,
    has_table_privilege(t.oid,'INSERT') AS can_insert,has_table_privilege(t.oid,'UPDATE') AS can_update,
    has_table_privilege(t.oid,'DELETE') AS can_delete FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relkind='r' AND t.relname=ANY($1::text[]) ORDER BY t.relname`,[tables])).rows;
  const counts={};for(const t of ['transfers','transfer_groups','audit_logs'])if(has(t)) {
    counts[t]=(await c.query(`SELECT count(*)::text AS total FROM public.${t}`)).rows[0].total;
    if(hasColumn(t,'organization_id'))counts[t+'_unassigned']=(await c.query(`SELECT count(*)::text AS total FROM public.${t} WHERE organization_id IS NULL`)).rows[0].total;
  }
  if(hasColumn('audit_logs','group_id')&&hasColumn('transfers','group_id')&&has('transfer_groups')) {
    counts.audit_unattributable=(await c.query(`SELECT count(*)::text AS total FROM public.audit_logs a
      LEFT JOIN public.transfers t ON t.id=a.transfer_id LEFT JOIN public.transfer_groups g ON g.id=COALESCE(a.group_id,t.group_id)
      WHERE a.event<>'history_exported' AND (g.id IS NULL OR (a.transfer_id IS NOT NULL AND t.id IS NULL)
        OR (t.id IS NOT NULL AND a.group_id IS NOT NULL AND a.group_id<>t.group_id))`)).rows[0].total;
  }
  await c.query('ROLLBACK');
  const root=path.resolve(__dirname,'../..'),drafts={};
  for(const f of ['tenant-foundation-schema.draft.sql','commercial-transfer-connection-schema.draft.sql','commercial-usage-schema.draft.sql'])
    drafts[f]=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'docs',f),'utf8').replace(/\r\n/g,'\n')).digest('hex');
  return {status:'READ_ONLY_COLLECTED',meta,ledger,columns,constraints,indexes,acl,counts,draftSha256: drafts,
    migrationApplied:false,customerValuesCollected:false};
 }finally{if(c){try{await c.query('ROLLBACK');}catch{}c.release();}await pool.end();}
}
if(require.main===module) {
 collect(process.env.SECURE_SEND_VALIDATION_DB_URL).then(r=>process.stdout.write(JSON.stringify(r,null,2)+'\n')).catch(e=>{
  // Never echo raw connection/driver errors: they may contain credentials or identifiers.
  process.stdout.write(JSON.stringify({status:e.skip?'SKIP':'ERROR',reason:e.skip?'VALIDATION_DB_NOT_CONFIGURED':'VALIDATION_PREFLIGHT_FAILED',migrationApplied:false})+'\n');
  process.exitCode=e.skip?3:1;
 });
}
module.exports={validateTarget,collect};
