import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from './vendor/makefun-board.ts';

const root = import.meta.dirname, out = process.argv[2] || '/tmp/tr-out';
const snapshot = JSON.parse(readFileSync(join(root, 'snapshot.json')));
const board = JSON.parse(readFileSync(join(out, 'board.json'))).rows;
const index = new Map(snapshot.protocols.map(p => [p.slug,p]));
assert.ok(board.length >= 100 && board.length <= 4000);
assert.equal(new Set(board.map(p => p.slug)).size, board.length);
assert.ok(snapshot.watchlist.every(slug => board.some(p => p.slug === slug)));
const lowestWatch = Math.min(...board.filter(p=>p.watchlist).map(p=>p.implied_value_usd));
for (const [i,p] of board.entries()) {
  assert.equal(p.rank, i+1);
  assert.equal(p.name, index.get(p.slug).name);
  assert.ok(Number.isSafeInteger(p.implied_value_usd) && p.implied_value_usd > 0);
  if(i) assert.ok(p.implied_value_usd <= board[i-1].implied_value_usd);
  if(!p.watchlist) assert.ok(p.implied_value_usd <= lowestWatch);
  assert.ok(!p.gecko_id && !p.symbol && !p.mcap_usd);
  assert.ok(p.farm_steps.length >= 3 && p.farm_steps.length <= 12);
  assert.ok(p.farm_steps.every(s=>typeof s==='string' && s.trim().length>=20 && s.length<=600 && /\$\d/.test(s) && /Time:/.test(s)));
  assert.equal(p.token_status,'pre-token');
  assert.equal(p.implied_value_usd, Math.round(Math.exp(p.model.inputs.reduce((s,x,j)=>s+x*p.model.coefficients[j],0))*p.model.haircut));
}
// Independent normal-equation residual check: an OLS solution must make X' residual approximately zero.
const m = board[0].model;
const script = readFileSync(join(out,'data.js'),'utf8');
assert.ok(script.startsWith('window.RADAR=') && script.trimEnd().endsWith(';'));
const radar = JSON.parse(script.slice('window.RADAR='.length).trim().slice(0,-1));
assert.equal(radar.rows.length,board.length);
for(const [i,p] of radar.rows.entries()) {
  assert.equal(p.slug,board[i].slug);
  assert.equal(p.implied_value_usd,board[i].implied_value_usd);
  assert.equal(p.token_status,'pre-token');
  assert.equal(p.implied_value_usd,Math.round(Math.exp(p.model_inputs.reduce((sum,x,j)=>sum+x*radar.model.coefficients[j],0))*radar.model.haircut));
}
assert.ok(radar.live.every(p=>p.token_status==='listed'));
assert.ok(!/category_weight|chain_breadth|maturity_multiplier|curve_value_usd|value_note/.test(script));
const comps = snapshot.protocols.filter(p=>p.tvl_usd>0 && p.mcap_usd>0);
const x = p => [1,Math.log(p.tvl_usd),p.change_7d??0,Math.log(p.listed_at ? Math.max(1,Math.floor((Date.parse(snapshot.as_of)-Date.parse(p.listed_at))/86400000)) || 1 : 1), ...(m.feature_set==='chains' ? [Math.log(Math.max(1,p.chains.length))] : [])];
const predict = (p,b) => x(p).reduce((s,v,j)=>s+v*b[j],0);
const gradient = [0,0,0,0];
for(const j of x(comps[0]).keys()) gradient[j]=0;
const retained = comps.filter(p=>!m.trimmed_slugs.includes(p.slug));
for(const p of retained) x(p).forEach((v,j)=>gradient[j]+=v*(Math.log(p.mcap_usd)-predict(p,m.coefficients)));
assert.ok(gradient.every(v=>Math.abs(v)<1e-6), `OLS residual gradient ${gradient}`);
const mean = retained.reduce((sum,p)=>sum+Math.log(p.mcap_usd),0)/retained.length;
const rSquared = 1-retained.reduce((sum,p)=>sum+(Math.log(p.mcap_usd)-predict(p,m.coefficients))**2,0)/retained.reduce((sum,p)=>sum+(Math.log(p.mcap_usd)-mean)**2,0);
assert.ok(Math.abs(rSquared-m.r_squared)<1e-12);
const held = comps.filter(p=>m.test_slugs.includes(p.slug));
assert.equal(held.length,Math.ceil(comps.length*.2));
const errors = held.map(p=>Math.abs(Math.exp(predict(p,m.holdout_coefficients))-p.mcap_usd)/p.mcap_usd).sort((a,b)=>a-b);
const median = errors[Math.floor((errors.length-1)*.5)]*100;
const central = errors.slice(Math.floor(errors.length*.05),Math.ceil(errors.length*.95));
const trimmed = central.reduce((s,p)=>s+p,0)/central.length*100;
assert.ok(Math.abs(median-m.oos_median_relative_error_pct)<1e-8);
assert.ok(Math.abs(trimmed-m.oos_trimmed_mape_pct)<1e-8);
const dashboardFiles = readdirSync(join(out,'dashboard'));
const dashboardBytes = dashboardFiles.reduce((s,f)=>s+statSync(join(out,'dashboard',f)).size,0);
assert.ok(dashboardBytes<65536);
for(const name of dashboardFiles) assert.ok(!/https?:\/\//i.test(readFileSync(join(out,'dashboard',name),'utf8')));
const shots = readdirSync(join(out,'screenshots'));
assert.equal(shots.length,3);
const imageInfo=[];
for(const name of shots){
  const b=readFileSync(join(out,'screenshots',name));
  assert.ok(/\.jpg$/.test(name) && b.length<=524288 && b.readUInt16BE(0)===0xffd8);
  let at=2, width, height;
  while(at<b.length){
    assert.equal(b[at++],255);
    const marker=b[at++], size=b.readUInt16BE(at);
    if([0xc0,0xc1,0xc2].includes(marker)){height=b.readUInt16BE(at+3);width=b.readUInt16BE(at+5);break;}
    at+=size;
  }
  assert.equal(width,1280); assert.equal(height,800);
  imageInfo.push({name,width,height,bytes:b.length});
}
const dossier = readFileSync(join(out,'dossier.json'),'utf8');
assert.ok(Buffer.byteLength(dossier)<=1.5*1024*1024);
assert.equal(dossier,buildDossier(out,{text_max_bytes:65536,screenshots:{max:4,max_bytes:524288},dashboard:{max_files:400,max_bytes:65536}}));
console.log(JSON.stringify({passed:true,rows:board.length,watchlist:snapshot.watchlist.length,coefficients:m.coefficients,r_squared:m.r_squared,median_oos_error_pct:m.oos_median_relative_error_pct,oos_trimmed_mape_pct:m.oos_trimmed_mape_pct,haircut:m.haircut,top_3:board.slice(0,3).map(p=>({rank:p.rank,slug:p.slug,name:p.name,tvl_usd:p.tvl_usd,change_7d:p.change_7d,age_days:p.age_days,implied_value_usd:p.implied_value_usd})),dashboard_bytes:dashboardBytes,dossier_bytes:Buffer.byteLength(dossier),screenshots:imageInfo},null,2));
