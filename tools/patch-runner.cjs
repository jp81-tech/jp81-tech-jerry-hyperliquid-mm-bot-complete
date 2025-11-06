const fs=require('fs');
function ts(){return new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14)}
function apply(p){const spec=JSON.parse(fs.readFileSync(p,'utf8'));let ok=0,fail=0;
 for(const op of spec.ops){let src;try{src=fs.readFileSync(op.file,'utf8')}catch(e){console.error('FILE_MISSING',op.file);fail++;continue}
  const re=new RegExp(op.pattern,op.flags||'m'); if(!re.test(src)){console.error('PATTERN_NOT_FOUND',op.file);fail++;continue}
  const bak=op.file+'.bak.'+ts(); fs.copyFileSync(op.file,bak);
  const out=src.replace(re,op.replacement); fs.writeFileSync(op.file,out);
  console.log('PATCHED',op.file,'->',bak); ok++;
 }
 console.log('DONE',`ok=${ok}`,`fail=${fail}`); process.exit(fail?1:0)
}
const file=process.argv[2]; if(!file){console.error('USAGE: node tools/patch-runner.cjs patches/patch.json');process.exit(2)}
apply(file)
