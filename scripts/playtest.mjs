// 플레이테스트 실행기: API(플레이테스트 도구 ON) + 웹 개발 서버를 함께 띄운다.
// 사용: npm run playtest  → 브라우저에서 http://localhost:5173  (종료: Ctrl+C)
import { spawn } from 'node:child_process';

const children = [];

function start(name, args, extraEnv = {}) {
  const child = spawn('npm', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    env: { ...process.env, ...extraEnv },
  });
  const prefix = (line) => `[${name}] ${line}`;
  for (const stream of [child.stdout, child.stderr]) {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) console.log(prefix(line));
    });
  }
  child.on('exit', (code) => {
    console.log(prefix(`exited (${code})`));
    shutdown(code ?? 0);
  });
  children.push(child);
}

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (!c.killed) c.kill();
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

start('api', ['run', 'dev', '-w', '@company-life/api'], { PLAYTEST_TOOLS: '1' });
start('web', ['run', 'dev', '-w', '@company-life/web']);
console.log(
  '\n▶ 플레이테스트: 브라우저에서 http://localhost:5173 을 여세요. (휴대폰 화면 확인: 개발자도구 기기 모드 360px)\n',
);
