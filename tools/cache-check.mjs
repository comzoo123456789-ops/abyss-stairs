/* 캐시 무효화 빠짐 검사.
 * ⚠ public/js·css 를 고치고 index.html 의 ?v= 를 안 올리면 **이미 접속한 사람에게는
 *   옛 파일이 그대로 나간다.** 배포는 성공하고 화면 검사도 통과하는데(새 브라우저라)
 *   정작 쓰던 사람만 안 바뀐다 — 화면에 아무 단서가 없는 종류다. 실제로 한 번 빠뜨렸다.
 * 여기서는 ① 모든 js/css 참조에 ?v= 가 붙어 있는가 ② 값이 하나로 통일돼 있는가
 *   ③ (인자를 주면) 마지막 커밋 이후 public 이 바뀌었는데 ?v= 는 그대로인가 를 본다. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(REPO, "public", "index.html"), "utf8");

const refs = [...html.matchAll(/(?:src|href)="((?:js|css)\/[^"]+)"/g)].map(m => m[1]);
const missing = refs.filter(r => !/\?v=\d+/.test(r));
const vers = new Set(refs.map(r => (r.match(/\?v=(\d+)/) || [])[1]).filter(Boolean));

console.log("참조한 js/css :", refs.length + "개");
console.log("?v= 없는 것   :", missing.length ? "✘ " + missing.join(", ") : "✔ 없음");
console.log("버전 값       :", [...vers].join(", ") || "(없음)",
  vers.size === 1 ? "✔ 하나로 통일" : "✘ 섞여 있다");

/* 파일이 실제로 있는지도 본다 — 오타 난 경로는 404 로만 드러난다 */
const gone = refs.map(r => r.split("?")[0]).filter(p => !fs.existsSync(path.join(REPO, "public", p)));
console.log("없는 파일     :", gone.length ? "✘ " + gone.join(", ") : "✔ 전부 있음");

/* 마지막 커밋과 비교 — public 이 바뀌었는데 ?v= 가 그대로면 경고 */
let staleWarn = "";
const diff = spawnSync("git", ["diff", "--name-only", "HEAD", "--", "public"],
  { cwd: REPO, encoding: "utf8" });
if (diff.status === 0) {
  const changed = diff.stdout.split("\n").filter(Boolean);
  const assets = changed.filter(f => /public\/(js|css)\//.test(f));
  const htmlChanged = changed.some(f => f.endsWith("index.html"));
  if (assets.length && !htmlChanged) {
    staleWarn = "✘ js/css " + assets.length + "개가 바뀌었는데 index.html 은 그대로다 — ?v= 를 올릴 것";
  } else if (assets.length) {
    staleWarn = "✔ js/css " + assets.length + "개 변경 · index.html 도 함께 바뀜";
  } else {
    staleWarn = "✔ 커밋 이후 js/css 변경 없음";
  }
}
console.log("커밋 대비     :", staleWarn);

const bad = missing.length || vers.size !== 1 || gone.length || staleWarn.startsWith("✘");
console.log(bad ? "\n결과: 확인 필요" : "\n결과: 통과");
process.exit(bad ? 1 : 0);
