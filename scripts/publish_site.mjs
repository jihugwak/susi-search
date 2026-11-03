#!/usr/bin/env node
/* 이슈에 첨부된 사이트 파일에서 자료만 뽑아 s/<번호>/site.json으로 커밋한다.
   이슈 본문과 첨부 파일은 누구나 쓸 수 있는 외부 입력이다. 올린 HTML의 코드는
   저장하지 않으며, 자료는 validate.js를 통과한 것만 받는다. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 26 * 1024 * 1024;
const MAX_SITES_PER_AUTHOR = 5;
const FILE_URL = /https:\/\/github\.com\/(?:user-attachments\/files|[\w.-]+\/[\w.-]+\/files)\/[^\s)<>"]+/;

class UserError extends Error {}

globalThis.window = globalThis.window || {};
createRequire(import.meta.url)('../validate.js');

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function extract(html, id, name) {
  const m = html.match(new RegExp(`<script id="${id}">window\\.${name}=([\\s\\S]*?);</script>`));
  if (!m) throw new UserError('Claude가 만든 입결 사이트 파일이 아닙니다.');
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    throw new UserError('파일이 손상되었습니다.');
  }
}

export function readSite(html) {
  const config = extract(html, 'susi-config', 'SITE_CONFIG');
  const site = {
    config: { site_title: config?.site_title, source: config?.source, note: config?.note || '' },
    data: extract(html, 'susi-data', 'ADIGA_DATA'),
    links: extract(html, 'susi-links', 'ADIGA_LINKS'),
    grade: extract(html, 'susi-grade', 'ADIGA_GRADE'),
  };
  const problem = window.checkSite(site);
  if (problem) throw new UserError(problem);
  return site;
}

function metaOf(site) {
  const years = site.data.cols['연도'];
  const lo = years.reduce((a, b) => Math.min(a, b)), hi = years.reduce((a, b) => Math.max(a, b));
  return {
    title: site.config.site_title,
    source: site.config.source,
    years: lo === hi ? `${hi}학년도` : `${lo}~${hi}학년도`,
    rows: site.data.n,
  };
}

async function download(body) {
  const url = (body || '').match(FILE_URL)?.[0];
  if (!url) throw new UserError('첨부 파일을 찾지 못했습니다. 파일을 칸에 끌어다 놓고 링크가 보인 뒤에 올려 주세요.');
  const res = await fetch(url);
  if (!res.ok) throw new UserError('첨부 파일을 내려받지 못했습니다. 다시 올려 주세요.');
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) throw new UserError('파일이 너무 큽니다.');
  return new TextDecoder().decode(bytes);
}

function replaceId(body) {
  const m = (body || '').match(/### 바꿀 자료 번호\s+(\S+)/);
  if (!m || m[1] === '_No') return 0;
  if (!/^\d{1,6}$/.test(m[1])) throw new UserError('바꿀 자료 번호는 숫자만 적어 주세요.');
  return Number(m[1]);
}

function readIndex() {
  return existsSync('s/index.json') ? JSON.parse(readFileSync('s/index.json', 'utf8')) : { sites: [] };
}

function place(index, meta, login, owner, editId) {
  const today = new Date().toISOString().slice(0, 10);
  if (editId) {
    const entry = index.sites.find(s => s.id === editId);
    if (!entry) throw new UserError(`${editId}번 자료가 없습니다.`);
    if (entry.author !== login && login !== owner) throw new UserError('자료를 올린 사람만 바꿀 수 있습니다.');
    Object.assign(entry, meta, { updated: today });
    return editId;
  }
  if (login !== owner && index.sites.filter(s => s.author === login).length >= MAX_SITES_PER_AUTHOR) {
    throw new UserError(`한 계정이 올릴 수 있는 자료는 ${MAX_SITES_PER_AUTHOR}개입니다. 기존 번호를 적어 자료를 바꿔 주세요.`);
  }
  const id = index.sites.reduce((max, s) => Math.max(max, s.id), 0) + 1;
  index.sites.push({ id, ...meta, author: login, created: today, updated: today });
  return id;
}

function commit(site, meta, login, owner, editId, branch) {
  // 동시에 올린 사람이 있으면 푸시가 거부되므로, 최신 상태에서 번호를 다시 정한다.
  for (let attempt = 0; attempt < 8; attempt++) {
    git('fetch', 'origin', branch);
    git('reset', '--hard', `origin/${branch}`);
    const index = readIndex();
    const id = place(index, meta, login, owner, editId);
    const folder = String(id).padStart(4, '0');
    mkdirSync(`s/${folder}`, { recursive: true });
    writeFileSync(`s/${folder}/site.json`, JSON.stringify(site));
    writeFileSync('s/index.json', `${JSON.stringify(index, null, 1)}\n`);
    git('add', 's');
    git('commit', '-m', `${editId ? '자료 갱신' : '자료 추가'}: ${folder}번`);
    try {
      git('push', 'origin', `HEAD:${branch}`);
      return id;
    } catch (e) {
      if (attempt === 7) throw e;
    }
  }
  throw new Error('unreachable');
}

function api(token, method, path, body) {
  return fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'susi-search' },
    body: body && JSON.stringify(body),
  });
}

export async function run() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const { issue, repository } = event;
  const token = process.env.GITHUB_TOKEN;
  const branch = repository.default_branch;
  const siteUrl = `https://${repository.owner.login}.github.io/${repository.name}/`;
  const reply = async (body, reason) => {
    await api(token, 'POST', `/issues/${issue.number}/comments`, { body });
    await api(token, 'PATCH', `/issues/${issue.number}`, { state: 'closed', state_reason: reason });
  };

  try {
    git('config', 'user.name', 'github-actions[bot]');
    git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
    const editId = replaceId(issue.body);
    const site = readSite(await download(issue.body));
    const meta = metaOf(site);
    const id = commit(site, meta, issue.user.login, repository.owner.login, editId, branch);
    // 이 작업이 푸시한 커밋은 Pages 배포를 일으키지 않을 수 있어 직접 요청한다.
    await api(token, 'POST', '/pages/builds').catch(() => {});
    await reply([
      `**${id}번으로 올렸습니다.** ${meta.rows.toLocaleString('ko-KR')}건, ${meta.years}`,
      '',
      `학생들에게 보낼 주소: ${siteUrl}?s=${id}`,
      '',
      `공개되기까지 몇 분 걸릴 수 있습니다. 나중에 자료를 바꾸려면 새 글을 쓰면서 "바꿀 자료 번호"에 \`${id}\`을 적으세요.`,
    ].join('\n'), 'completed');
  } catch (e) {
    if (e instanceof UserError) {
      await reply(`올리지 못했습니다. ${e.message}`, 'not_planned');
      return;
    }
    await reply('처리 중 오류가 났습니다. 잠시 후 다시 올려 주세요.', 'not_planned');
    throw e;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await run();
