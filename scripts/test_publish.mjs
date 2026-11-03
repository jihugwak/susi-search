// 임시 Git 저장소와 가짜 GitHub로 업로드 처리를 검사한다.  node scripts/test_publish.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, readSite } from './publish_site.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const shell = readFileSync(join(here, '../api/v1/shell.html'), 'utf8');
const dirs = mkdtempSync(join(tmpdir(), 'susi-'));
const sh = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const bare = join(dirs, 'bare.git'), work = join(dirs, 'work');
sh(dirs, 'init', '-q', '--bare', '-b', 'main', bare);
sh(dirs, 'clone', '-q', bare, work);
sh(work, 'config', 'user.name', 't'); sh(work, 'config', 'user.email', 't@t');
writeFileSync(join(work, 'README.md'), 'x');
sh(work, 'add', '.'); sh(work, 'commit', '-qm', 'init'); sh(work, 'branch', '-M', 'main'); sh(work, 'push', '-q', 'origin', 'main');
process.chdir(work);

const page = (title, year = 2026) => {
  const cols = { 연도: [year] };
  for (const c of ['지역', '대학', '교과/종합', '전형', '학과', '인문/자연', '소계열']) cols[c] = [0];
  for (const c of ['모집인원', '경쟁률', '추합', '변환50', '변환70', '만점', '등급50', '등급70', '총지원지원', '합격인원', '실경쟁률']) cols[c] = [null];
  const dicts = Object.fromEntries(['지역', '대학', '교과/종합', '전형', '학과', '인문/자연', '소계열'].map(c => [c, ['값']]));
  return shell
    .replace('window.SITE_CONFIG=null;', () => `window.SITE_CONFIG=${JSON.stringify({ site_title: title, source: '진학부', note: '' })};`)
    .replace('window.ADIGA_DATA=null;', () => `window.ADIGA_DATA=${JSON.stringify({ n: 1, dicts, cols })};`);
};

const calls = [];
const files = {};
globalThis.fetch = async (url, init = {}) => {
  if (files[url] !== undefined) return new Response(files[url]);
  if (url.startsWith('https://github.com/')) return new Response('', { status: 404 });
  calls.push({ url, method: init.method, body: init.body && JSON.parse(init.body) });
  return new Response('{}');
};

process.env.GITHUB_REPOSITORY = 'owner/repo';
process.env.GITHUB_TOKEN = 't';
const eventPath = join(dirs, 'event.json');
process.env.GITHUB_EVENT_PATH = eventPath;
let number = 0;
async function submit(login, body) {
  calls.length = 0;
  writeFileSync(eventPath, JSON.stringify({
    issue: { number: ++number, body, user: { login } },
    repository: { default_branch: 'main', name: 'repo', owner: { login: 'owner' } },
  }));
  await run().catch(() => {});
  const comment = calls.find(c => c.url.endsWith('/comments'))?.body.body || '';
  return { comment, pages: calls.some(c => c.url.endsWith('/pages/builds')), close: calls.find(c => c.method === 'PATCH')?.body };
}
const form = (url, replace = '_No response_') => `### 사이트 파일\n\n[a.html](${url})\n\n### 바꿀 자료 번호\n\n${replace}\n\n### 확인\n\n- [X] 동의`;
const U = n => `https://github.com/user-attachments/files/${n}/a.html`;
const pushed = () => JSON.parse(sh(work, 'show', 'origin/main:s/index.json'));

files[U(1)] = page('가고');
let r = await submit('kim', form(U(1)));
assert.match(r.comment, /1번으로 올렸습니다/);
assert.match(r.comment, /https:\/\/owner\.github\.io\/repo\/\?s=1/);
assert.ok(r.pages); assert.equal(r.close.state_reason, 'completed');
assert.equal(pushed().sites[0].author, 'kim');

files[U(2)] = page('나고');
r = await submit('lee', form(U(2)));
assert.match(r.comment, /2번으로/);

files[U(3)] = page('가고 새자료', 2027);
r = await submit('lee', form(U(3), '1'));
assert.match(r.comment, /올린 사람만/);
assert.equal(r.close.state_reason, 'not_planned');
assert.equal(pushed().sites[0].title, '가고');

r = await submit('kim', form(U(3), '1'));
assert.match(r.comment, /1번으로/);
assert.equal(pushed().sites[0].title, '가고 새자료');
assert.equal(pushed().sites.length, 2);
assert.equal(JSON.parse(sh(work, 'show', 'origin/main:s/0001/site.json')).data.cols['연도'][0], 2027);

r = await submit('owner', form(U(1), '2'));
assert.match(r.comment, /2번으로/);

for (const [url, want] of [['https://evil.example/a.html', /찾지 못했습니다/], [U(99), /내려받지 못했습니다/]]) {
  r = await submit('kim', form(url));
  assert.match(r.comment, want);
}
files[U(4)] = '<html>아무 파일</html>';
assert.match((await submit('kim', form(U(4)))).comment, /입결 사이트 파일이 아닙니다/);
files[U(5)] = shell;
assert.match((await submit('kim', form(U(5)))).comment, /올리지 못했습니다/);
files[U(6)] = page('조작').replace(/"전형":\[0\]/, '"전형":["<img src=x>"]');
assert.match((await submit('kim', form(U(6)))).comment, /올리지 못했습니다/);
assert.match((await submit('kim', form(U(1), 'abc'))).comment, /숫자만/);
assert.equal(pushed().sites.length, 2);

for (let i = 0; i < 4; i++) await submit('park', form(U(1)));
assert.match((await submit('park', form(U(1)))).comment, /3번으로|4번으로|5번으로|6번으로|7번으로/);
assert.match((await submit('park', form(U(1)))).comment, /5개입니다/);

// 다른 작업이 먼저 푸시해도 번호가 겹치지 않아야 한다.
const other = join(dirs, 'other');
sh(dirs, 'clone', '-q', bare, other);
sh(other, 'config', 'user.name', 't'); sh(other, 'config', 'user.email', 't@t');
writeFileSync(join(other, 's/index.json'), JSON.stringify({ sites: [...pushed().sites, { id: 50, author: 'x' }] }));
sh(other, 'add', '.'); sh(other, 'commit', '-qm', 'race'); sh(other, 'push', '-q', 'origin', 'main');
r = await submit('choi', form(U(1)));
assert.match(r.comment, /51번으로/);

assert.ok(!sh(work, 'show', 'origin/main:s/0001/site.json').includes('addEventListener'));
assert.ok(readSite(page('확인')).config.site_title === '확인');
assert.ok(existsSync(here));
console.log('업로드 처리 테스트 통과');
