import * as fs from 'node:fs'; import * as os from 'node:os'; import * as path from 'node:path';
import { getAllSymbols, loadLiveGraph } from '@a-company/premise-core';
import { computeEssences } from '../src/warp/essence-hash.js';
// One-giant-SCC shape (shared gate back-links every component) = this repo's shape.
const n = 25000, per = 5, root = fs.mkdtempSync(path.join(os.tmpdir(),'wl-bench-'));
try {
  for (let f=0; f<n/per; f++){ const d=path.join(root,'src',`m${f}`); fs.mkdirSync(d,{recursive:true});
    const L=[`name: m${f}`,'components:'];
    for(let s=0;s<per;s++){const i=f*per+s; L.push(`  n${i}:`,`    description: c${i}`,`    type: service`,`    gates: ["^authenticated"]`); if(i+1<n) L.push(`    references: ["#n${i+1}"]`);}
    fs.writeFileSync(path.join(d,'.purpose'),L.join('\n')+'\n'); }
  const g = await loadLiveGraph(root);
  const syms = getAllSymbols(g.index).map(s=>s.symbol);
  const t=Date.now(); const r=computeEssences(g.index,syms);
  console.log(`BENCH giant-SCC n=${n} ids=${r.contentIds.size} essenceMs=${Date.now()-t}`);
} finally { fs.rmSync(root,{recursive:true,force:true}); }
