/* 공격 모션이 **게임 중에** 실제로 도는가.
 *
 * ⚠ 스프라이트에 공격 프레임이 있다는 것과, 때릴 때 그 프레임이 쓰인다는 것은
 *   다른 얘기다. 렌더러가 안 골라 주면 그림만 있고 화면은 그대로다.
 *   그래서 **적을 옆에 세우고 때려서** 프레임이 바뀌는지 잰다.
 */
import { spawn } from "child_process";
import fs from "fs"; import os from "os"; import path from "path"; import http from "http";
import { fileURLToPath } from "node:url";
import { CHROME } from "./chrome.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const MIME = { ".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8" };
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split("?")[0]); if(p==="/")p="/index.html";
  const f=path.join(ROOT,p); if(!fs.existsSync(f)){r.writeHead(404);r.end();return;}
  r.writeHead(200,{"content-type":MIME[path.extname(f)]||"application/octet-stream"}); r.end(fs.readFileSync(f));});
await new Promise(r=>srv.listen(0,"127.0.0.1",r)); const port=srv.address().port;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"rl-atk-"));
const ch=spawn(CHROME,["--headless=new","--remote-debugging-port=0","--user-data-dir="+dir,"--no-first-run","--disable-gpu","--hide-scrollbars","about:blank"],{stdio:["ignore","pipe","pipe"]});
const wsUrl=await new Promise(res=>{let b="";ch.stderr.on("data",d=>{b+=d;const m=b.match(/ws:\/\/[^\s]+/);if(m)res(m[0]);});});
const ws=new WebSocket(wsUrl); await new Promise(r=>ws.addEventListener("open",r));
const errs=[]; let id=0; const w=new Map();
ws.addEventListener("message",e=>{const m=JSON.parse(e.data);
  if(m.method==="Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.text);
  if(m.id&&w.has(m.id)){w.get(m.id)(m);w.delete(m.id);}});
const send=(me,p,s)=>new Promise((res,rej)=>{const i=++id;w.set(i,x=>x.error?rej(new Error(x.error.message)):res(x.result));ws.send(JSON.stringify({id:i,method:me,params:p||{},sessionId:s}));});
const {targetId}=await send("Target.createTarget",{url:"about:blank"});
const {sessionId}=await send("Target.attachToTarget",{targetId,flatten:true});
const S=(m,p)=>send(m,p,sessionId);
await S("Page.enable"); await S("Runtime.enable");
const ev=async x=>(await S("Runtime.evaluate",{expression:x,returnByValue:true,awaitPromise:true})).result.value;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const OUT = process.env.RL_SHOTS || "";   /* 스크린샷은 요청할 때만 */

await S("Emulation.setDeviceMetricsOverride",{width:900,height:620,deviceScaleFactor:1,mobile:false});
await S("Page.navigate",{url:"http://127.0.0.1:"+port+"/index.html"});
await sleep(1100);

const out=[]; const add=(n,ok,note)=>out.push([n,!!ok,note]);

for (const cls of ["warrior","rogue","mage"]) {
  await ev(`window.__start("${cls}","free")`);
  await sleep(320);
  /* 옆 칸에 적을 세운다 */
  const put = await ev(`(()=>{
    const g = window.__peek();
    const r = window.__putMonster && window.__putMonster("rat");
    return r;
  })()`);
  /* 붙어 있는 적을 만들려면 바로 옆이어야 한다 — 직접 옮긴다 */
  const ready = await ev(`(()=>{
    const lv = window.__lvl();
    const p = window.__peek();
    /* 옆 칸 중 걸어갈 수 있는 곳을 찾아 거기로 몬스터를 옮긴다 */
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const [dx,dy] of dirs) {
      const x = p.x+dx, y = p.y+dy;
      if (lv.blocked(x,y)) continue;
      const mons = window.__monsters ? window.__monsters() : null;
      return { x, y, dx, dy };
    }
    return null;
  })()`);
  if (!ready) { add(cls + " 준비", false, "옆에 빈 칸이 없다"); continue; }

  /* 프레임을 계속 들여다본다 — 때리기 전 / 때리는 동안 */
  const before = await ev(`window.__pose ? window.__pose() : null`);
  await ev(`window.__moveMonsterNext && window.__moveMonsterNext()`);
  const seen = await ev(`(async()=>{
    const seq = [];
    /* 적을 옆으로 옮기고 그쪽으로 걸어 들어간다(= 공격) */
    const lv = window.__lvl(), p0 = window.__peek();
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    let dir = null;
    for (const [dx,dy] of dirs) if (!lv.blocked(p0.x+dx, p0.y+dy)) { dir = [dx,dy]; break; }
    if (!dir) return { err: "옆 칸 없음" };
    const mon = window.__putMonsterAt ? window.__putMonsterAt(p0.x+dir[0], p0.y+dir[1]) : null;
    if (!mon) return { err: "적을 못 놓음" };
    window.__move(dir[0], dir[1]);
    for (let i = 0; i < 14; i++) {
      seq.push(window.__pose());
      await new Promise(r => setTimeout(r, 20));
    }
    return { seq };
  })()`);
  if (seen && seen.err) { add(cls + " 공격", false, seen.err); continue; }
  const uniq = [...new Set(seen.seq)];
  const sawAttack = seen.seq.some(f => f === 3 || f === 4);
  add(cls + " 공격 프레임", sawAttack, "본 프레임 " + uniq.join(",") + " · " + seen.seq.join(""));
  if (OUT) {
    const { data } = await S("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, "atk-" + cls + ".png"), Buffer.from(data, "base64"));
  }
}

for (const [n,ok,note] of out) console.log(ok?"✔":"✘", n.padEnd(20), note);
console.log("\n콘솔 오류:", errs.length);
const bad = out.filter(o=>!o[1]).length + (errs.length?1:0);
console.log(bad ? "\n결과: 확인 필요" : "\n결과: 통과");
ch.kill(); srv.close(); process.exit(bad?1:0);
