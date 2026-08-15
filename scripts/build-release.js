const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'release');
const ALLOWED_FILES = new Set([
  'server.js','db-adapter.js','package.json','package-lock.json','vercel.json','.env.example','README.md','CHANGELOG.md'
]);
const ALLOWED_DIRS = new Set(['api','public','scripts']);
const NEVER_COPY = ['database.db','.env','node_modules','.git','release'];
function copyRecursive(src,dst){
  const st=fs.statSync(src);
  if(st.isDirectory()){
    const base=path.basename(src);
    if (base === 'node_modules' || base === '.git' || base === 'release') return;
    fs.mkdirSync(dst,{recursive:true});
    for(const name of fs.readdirSync(src)) {
      if (/\.(backup|bak)$/.test(name) || /^diff[-_]/i.test(name) || /^backup[-_]/i.test(name) || /\.patch$/i.test(name) || /^smoke[-_]/i.test(name)) continue;
      copyRecursive(path.join(src,name),path.join(dst,name));
    }
  } else {
    fs.mkdirSync(path.dirname(dst),{recursive:true});
    fs.copyFileSync(src,dst);
  }
}
fs.rmSync(out,{recursive:true,force:true});
fs.mkdirSync(out,{recursive:true});
for(const name of ALLOWED_FILES) if(fs.existsSync(path.join(root,name))) copyRecursive(path.join(root,name),path.join(out,name));
for(const dir of ALLOWED_DIRS) if(fs.existsSync(path.join(root,dir))) copyRecursive(path.join(root,dir),path.join(out,dir));
for(const name of NEVER_COPY) if(fs.existsSync(path.join(out,name))) fs.rmSync(path.join(out,name),{recursive:true,force:true});
console.log(`Release V7.0 preparado em: ${out}`);
