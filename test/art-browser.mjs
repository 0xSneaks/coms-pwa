// Optional browser QA: Playwright required; no production dependencies.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../public/',import.meta.url));
const docs=fileURLToPath(new URL('../docs/',import.meta.url));
const roster=JSON.parse(await readFile(path.join(root,'crew.json'),'utf8'));
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');const f=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
 if(!f.startsWith(root)){res.writeHead(403);res.end();return;}
 try{res.setHeader('Content-Type',mime[path.extname(f)]||'text/plain');res.end(await readFile(f));}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
const report={browser:browser.version(),layouts:[],checks:[]},errors=[],badResponses=[];
await mkdir(docs,{recursive:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1050},deviceScaleFactor:1});
 const page=await context.newPage();
 async function closeDialog(id){await page.evaluate(id=>{window.__qaClosed=false;document.querySelector(id).addEventListener('close',()=>{window.__qaClosed=true},{once:true});},id);await page.keyboard.press('Escape');await page.waitForFunction(()=>window.__qaClosed);}
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)badResponses.push(r.status()+' '+new URL(r.url()).pathname);});
 await page.goto(base);await page.waitForSelector('.crew-member');
 assert.deepEqual(await page.locator('.crew-member').evaluateAll(es=>es.map(e=>e.dataset.agent)),roster.agents.map(a=>a.id));
 assert.ok(await page.evaluate(()=>document.getAnimations().some(a=>a.playState==='running')));
 await page.locator('#motion-toggle').click();assert.equal(await page.locator('#motion-toggle').getAttribute('aria-pressed'),'true');
 assert.ok(await page.evaluate(()=>document.getAnimations().every(a=>a.playState==='paused')));
 report.checks.push('Roster IDs match; all decorative animations run and pause.');
 for(const [width,height,label] of [[1440,1050,'desktop'],[1024,768,'laptop'],[768,1024,'tablet'],[390,844,'phone'],[360,800,'small-phone'],[320,568,'narrow-phone']]){
  await page.setViewportSize({width,height});
  const l=await page.evaluate(()=>{const rect=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom}};return{scrollWidth:document.documentElement.scrollWidth,crew:[...document.querySelectorAll('.crew-member')].map(rect),consoleTop:document.querySelector('.console').getBoundingClientRect().top,buttons:[...document.querySelectorAll('[data-command]')].map(rect)};});
  assert.ok(l.scrollWidth<=width,`${label} overflow`);
  for(const c of l.crew){assert.ok(c.x>=0&&c.x+c.w<=width&&c.w>=44&&c.h>=44);assert.ok(c.bottom<l.consoleTop);}
  for(const b of l.buttons)assert.ok(b.x>=0&&b.x+b.w<=width&&b.h>=44);
  for(let i=0;i<l.crew.length;i++)for(let j=i+1;j<l.crew.length;j++){const a=l.crew[i],b=l.crew[j];assert.ok(a.x+a.w<=b.x+.5||b.x+b.w<=a.x+.5||a.bottom<=b.y+.5||b.bottom<=a.y+.5,`${label} crew overlap`);}
  if(label==='phone')assert.ok(l.buttons.every(b=>b.bottom<=height),'phone buttons below fold');
  if(['desktop','phone','narrow-phone'].includes(label))await page.screenshot({path:path.join(docs,`art-${label}.png`),fullPage:true});
  report.layouts.push({viewport:`${width}×${height}`,crew:l.crew.length,horizontalOverflow:false,commandsInInitialViewport:l.buttons.every(b=>b.bottom<=height)});
 }
 await page.setViewportSize({width:390,height:844});
 for(let i=0;i<roster.agents.length;i++){
  const target=page.locator('.crew-member').nth(i);await target.focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('#crew-title').textContent(),roster.agents[i].name);assert.match(await page.locator('#crew-status').textContent(),/Activity: unknown/);
  await closeDialog('#crew-dialog');assert.ok(await target.evaluate(e=>e===document.activeElement));
 }
 await page.locator('[data-command="review"]').click();assert.ok(await page.locator('#app-message').textContent());assert.ok(await page.locator('#command-input').evaluate(e=>e===document.activeElement));
 await page.locator('#command-input').fill('Review the glass room <script>alert(1)</script> & all agents.');
 for(const kind of ['check','react','review']){
  await page.locator(`[data-command="${kind}"]`).click();assert.ok(await page.locator('#command-dialog').evaluate(e=>e.open));assert.match(await page.locator('#command-output').inputValue(),/glass room/);
  await page.locator('#copy-command').click();await page.waitForFunction(()=>document.querySelector('#copy-status').textContent.length>0);assert.match(await page.locator('#copy-status').textContent(),/Copied|selected/);await closeDialog('#command-dialog');
 }
 await page.locator('#install-help').click();assert.match(await page.locator('#install-dialog').textContent(),/Safari/);await closeDialog('#install-dialog');
 report.checks.push('All crew keyboard dialogs, unknown status, Escape/focus restoration; 3 commands preserve input; validation, copy/fallback and install help pass.');
 await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await page.waitForSelector('.crew-member');assert.equal(await page.evaluate(()=>document.getAnimations().length),0);
 await page.locator('#motion-toggle').click();assert.equal(await page.evaluate(()=>document.getAnimations().length),0);
 report.checks.push('Reduced motion: zero animations, including after Resume.');
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 await context.setOffline(true);await page.reload();await page.waitForSelector('.crew-member');assert.equal(await page.locator('.crew-member').count(),roster.agents.length);assert.match(await page.locator('#connection-state').textContent(),/Offline/);
 await page.locator('[data-command="check"]').click();assert.ok((await page.locator('#command-output').inputValue()).length>0);
 report.checks.push('Localhost offline reload: cached artwork, all roster members and commands work. Physical installation and production HTTPS not tested.');
 await context.close();
 const dynamic=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});const next=await dynamic.newPage();
 await next.route('**/crew.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({...roster,agents:[...roster.agents.map((a,i)=>({...a,activity:i%2?'idle':'active'})),{id:'future-guest',name:'Future Guest',role:'Fixture only',sources:['ROLLCALL.md'],activity:'idle'}]})}));
 await next.goto(base);await next.waitForSelector('[data-agent="future-guest"]');assert.equal(await next.locator('.crew-member').count(),roster.agents.length+1);assert.ok(await next.locator('[data-agent="future-guest"]').isVisible());assert.ok(await next.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await dynamic.close();report.checks.push('10-member active/idle fixture: every member rendered, including future-ID fallback artwork.');
 assert.deepEqual(errors,[]);assert.deepEqual(badResponses,[]);report.checks.push('Zero JavaScript page errors and HTTP 4xx/5xx responses.');
 await writeFile(path.join(docs,'art-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await browser.close();await new Promise(r=>server.close(r));}
