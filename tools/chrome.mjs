/* 크롬이 어디 있는가 — **한 곳에서만** 정한다.
 *
 * 경로가 검사 파일마다 박혀 있었다(여덟 군데). 컴퓨터를 옮기면 여덟 개를
 * 다 고쳐야 하는데, README 에는 "check.mjs 의 CHROME 을 바꾼다" 고만 적혀
 * 있어서 하나만 고치고 나머지 일곱이 죽는다. 게다가 두 파일은 `MB_CHROME`
 * 환경변수를 보고 여섯 파일은 안 봤다 — 같은 저장소 안에서 규칙이 둘이었다.
 *
 * ⚠ **찾아서 쓴다.** 경로를 손으로 적게 하면 옮길 때마다 막힌다. 흔한
 *   자리를 뒤져 있는 것을 쓰고, 없으면 무엇을 어떻게 하라고 말해 준다.
 * ⚠ 환경변수 이름은 `AS_CHROME` 이다(abyss-stairs). 옛 `MB_CHROME` 도
 *   그대로 받는다 — 그걸 써 온 사람이 갑자기 막히면 안 된다.
 * ⚠ 못 찾으면 **조용히 기본값을 돌려주지 않는다.** 그러면 "Chrome 이
 *   30초 안에 안 떴다" 로 죽고, 진짜 원인(경로가 틀렸다)이 안 보인다.
 */
import fs from "node:fs";

const ENV = process.env.AS_CHROME || process.env.MB_CHROME || "";

const GUESSES = [
  /* 윈도우 */
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  (process.env.LOCALAPPDATA || "") + "/Google/Chrome/Application/chrome.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  /* macOS */
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  /* 리눅스 */
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium"
];

function find() {
  if (ENV) {
    if (fs.existsSync(ENV)) return ENV;
    throw new Error(
      "AS_CHROME 이 가리키는 곳에 크롬이 없다: " + ENV
    );
  }
  for (const p of GUESSES) {
    if (p && fs.existsSync(p)) return p;
  }
  throw new Error(
    "크롬을 못 찾았다. 흔한 자리 " + GUESSES.filter(Boolean).length + "곳을 뒤졌다.\n" +
    "  이 컴퓨터의 크롬 경로를 알려 주면 된다:\n" +
    "    Windows  set AS_CHROME=D:\\경로\\chrome.exe\n" +
    "    mac/리눅스 export AS_CHROME=/경로/chrome\n" +
    "  화면 검사만 크롬을 쓴다 — 로직 검사(verify.mjs 앞부분)는 크롬 없이 돈다."
  );
}

export const CHROME = find();
export default CHROME;
