// 플레이테스트 실행기: API(플레이테스트 도구 ON) + 웹 개발 서버를 함께 띄운다.
// 사용: npm run playtest  → 브라우저에서 http://localhost:5173  (종료: Ctrl+C)
//       npm run playtest:lan → 같은 와이파이의 휴대폰에서 http://<PC IP>:5173 접속 (실제 기기 점검)
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';

// --lan: 웹 개발 서버만 공유기 내부망에 연다. API는 계속 127.0.0.1 (웹 서버가 /api를 대신 전달)
const lan = process.argv.includes('--lan');

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
start('web', ['run', 'dev', '-w', '@company-life/web', ...(lan ? ['--', '--host', '0.0.0.0'] : [])]);
console.log(
  '\n▶ 플레이테스트: 브라우저에서 http://localhost:5173 을 여세요. (휴대폰 화면 확인: 개발자도구 기기 모드 360px)\n',
);
if (lan) {
  // 사설 IPv4만 (192.168.x · 10.x · 172.16~31.x)
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address)
    .filter((ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip));
  console.log('▶ 휴대폰(같은 와이파이)에서 접속:');
  for (const ip of ips) console.log(`    http://${ip}:5173`);
  console.log('  접속이 안 되면 Windows 방화벽 설정을 확인하세요 (docs/DEVICE_CHECK.md).\n');
}
