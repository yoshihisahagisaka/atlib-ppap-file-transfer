// OFFLINE ONLY. Reads Git objects; no DB/.env/config. --prepare writes a NEW review bundle only.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'docs/secure-send-validation-migration-manifest-20261018.json'),'utf8'));
function hash(b){return crypto.createHash('sha256').update(b).digest('hex');}
function check(m){
 if(m.entries.length!==8 || new Set(m.entries.map(e=>e.ledgerName)).size!==8)throw Error('INVALID_MANIFEST');
 return m.entries.map(e=>{
  const b=cp.execFileSync('git',['show',m.sourceCommit+':'+e.path],{cwd:root});
  const blob=crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+b.length+'\0'),b])).digest('hex');
  if(b.length!==e.bytes||hash(b)!==e.sha256||blob!==e.gitBlob)throw Error('GIT_SOURCE_MISMATCH:'+e.path);
  // Compare worktree semantics without changing bytes or adding/removing trailing newline.
  const local=fs.readFileSync(path.join(root,e.path),'utf8').replace(/\r\n/g,'\n');
  if(hash(Buffer.from(local,'utf8'))!==e.sha256)throw Error('WORKTREE_MISMATCH:'+e.path);
  return {ledgerName:e.ledgerName,path:e.path,gitBytes:b.length,sha256:e.sha256};
 });
}
function prepare(m,dir){
 const target=path.resolve(dir);
 if(fs.existsSync(target))throw Error('NEW_BUNDLE_DIRECTORY_REQUIRED');
 const aclText=fs.readFileSync(path.join(root,m.acl.path),'utf8').replace(/\r\n/g,'\n');
 const acl=Buffer.from(aclText,'utf8');
 if(acl.length!==m.acl.bytes||hash(acl)!==m.acl.sha256)throw Error('ACL_HASH_MISMATCH');
 fs.mkdirSync(target,{recursive:true});
 for(const e of m.entries)fs.writeFileSync(path.join(target,e.ledgerName),cp.execFileSync('git',['show',m.sourceCommit+':'+e.path],{cwd:root}));
 fs.writeFileSync(path.join(target,m.acl.ledgerName),acl);
 const head=[
 '\\set ON_ERROR_STOP on',
 'DO $$ BEGIN',
 "IF current_database()<>'send_commercial_usage_test' OR current_user<>'send_migrator' THEN RAISE EXCEPTION 'WRONG_TARGET'; END IF;",
 "IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')) THEN RAISE EXCEPTION 'EMPTY_DATABASE_REQUIRED'; END IF;",
 'END $$;',
 'BEGIN;',
 "SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';",
 'CREATE TABLE public.schema_migrations(filename TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT now());',
 'COMMIT;'
 ];
 for(const e of [...m.entries,m.acl])head.push('BEGIN;', "SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'; SET LOCAL search_path=public,pg_catalog;",
 '\\ir '+e.ledgerName,
 "INSERT INTO public.schema_migrations(filename) VALUES ('"+e.ledgerName+"');",'COMMIT;');
 fs.writeFileSync(path.join(target,'apply-approved.sql'),head.join('\n')+'\n','utf8');
 fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify(m,null,2)+'\n');
 return target;
}
try{const rows=check(manifest);
if(process.argv[2]==='--prepare'){
 if(!process.argv[3])throw Error('DIRECTORY_REQUIRED');
 console.log(JSON.stringify({status:'BUNDLE_PREPARED_OFFLINE',path:prepare(manifest,process.argv[3]),databaseConnected:false}));
}else console.log(JSON.stringify({status:'OFFLINE_MANIFEST_VERIFIED',databaseConnected:false,rows},null,2));}
catch{console.error('MANIFEST_VERIFICATION_FAILED');process.exitCode=1;}
