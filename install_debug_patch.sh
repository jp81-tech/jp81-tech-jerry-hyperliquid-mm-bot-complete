set -e
cd /root/hyperliquid-mm-bot-complete

mkdir -p tools patches logs

if [ ! -f tools/patch-runner.js ]; then
cat > tools/patch-runner.js <<'EOF'
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
const file=process.argv[2]; if(!file){console.error('USAGE: node tools/patch-runner.js patches/patch.json');process.exit(2)}
apply(file)
EOF
fi

cat > patches/patch_debug_clip.json <<'EOF'
{
  "ops": [
    {
      "file": "src/mm_hl.ts",
      "pattern": "const\\s+quantResult\\s*=\\s*quantizeOrder\\([\\s\\S]*?\\);",
      "flags": "m",
      "replacement": "const quantResult = quantizeOrder(\n            pair,\n            side,\n            makerIntent,\n            roundedPrice,\n            sizeInCoins,\n            finalSpec\n          );\n{\n  const szDecimals = Number(finalSpec?.szDecimals ?? 6);\n  const minSz = Number(finalSpec?.minSize ?? 0);\n  const clipUsd = Number(process.env.CLIP_USD ?? '35');\n  const qPxRaw = Number((quantResult && (quantResult.price ?? quantResult.px)) ?? roundedPrice);\n  const qPx = (qPxRaw && qPxRaw > 0) ? qPxRaw : roundedPrice;\n  if (clipUsd > 0 && qPx > 0) {\n    let adj = clipUsd / qPx;\n    const pow10 = Math.pow(10, szDecimals);\n    adj = Math.floor(adj * pow10) / pow10;\n    if (adj < minSz) adj = minSz;\n    sizeInCoins = adj;\n  }\n  try {\n    // ultra-explicit logging for post-mortem analysis\n    console.log('[CLIPDBG]', JSON.stringify({\n      pair, side, clipUsd, roundedPrice, qPx, szDecimals, minSz, sizeInCoins\n    }));\n  } catch(_) {}\n}\n"
    }
  ]
}
EOF

tar --exclude='.env' --exclude='src/.env' --exclude='node_modules' --exclude='backups' -czf backups/snap/code_$(date -u +%Y%m%dT%H%M%SZ).tgz . || true

node tools/patch-runner.js patches/patch_debug_clip.json

pm2 restart hyperliquid-mm --update-env
sleep 6

pm2 logs hyperliquid-mm --lines 200 --nostream | tee logs/last200_$(date -u +%Y%m%dT%H%M%SZ).log
echo "DONE"
