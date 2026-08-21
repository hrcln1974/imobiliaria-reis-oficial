const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'release');
const skip = new Set(['node_modules','.git','.env','release','*.log']);
function copy(src,dst){
  const st=fs.statSync(src);
  if(st.isDirectory()){
    if(skip.has(path.basename(src))) return;
    fs.mkdirSync(dst,{recursive:true});
    for(const name of fs.readdirSync(src)) copy(path.join(src,name),path.join(dst,name));
  } else {
    if(skip.has(path.basename(src)) || src.endsWith('.log')) return;
    fs.mkdirSync(path.dirname(dst),{recursive:true}); fs.copyFileSync(src,dst);
  }
}
fs.rmSync(out,{recursive:true,force:true});
fs.mkdirSync(out,{recursive:true});
for(const name of fs.readdirSync(root)) if(name!=='release' && name!=='node_modules' && name!=='.env' && name!=='.git') copy(path.join(root,name),path.join(out,name));
console.log(`Release preparado em: ${out}`);
