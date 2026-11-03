/* 주소에 ?s=번호가 있으면 그 번호의 자료를, 없으면 기본 자료를 불러온 뒤 앱을 시작한다. */
(function () {
  'use strict';
  function load(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src; el.onload = resolve; el.onerror = reject;
      document.body.appendChild(el);
    });
  }
  function fail(message) {
    document.body.textContent = '';
    const box = document.createElement('p');
    box.style.cssText = 'max-width:560px;margin:60px auto;padding:0 16px;line-height:1.7';
    box.textContent = message + ' ';
    const link = document.createElement('a');
    link.href = 's/'; link.textContent = '자료 목록 보기';
    box.appendChild(link);
    document.body.appendChild(box);
  }
  async function start() {
    const id = new URLSearchParams(location.search).get('s');
    if (id === null) {
      for (const src of ['data.js', 'links.js', 'grade.js', 'app.js']) await load(src);
      return;
    }
    if (!/^\d{1,6}$/.test(id)) return fail('번호가 올바르지 않습니다.');
    const res = await fetch(`s/${String(Number(id)).padStart(4, '0')}/site.json`);
    if (!res.ok) return fail(`${id}번 자료를 찾을 수 없습니다.`);
    let site;
    try { site = await res.json(); } catch (e) { return fail(`${id}번 자료가 손상되었습니다.`); }
    await load('validate.js');
    const problem = window.checkSite(site);
    if (problem) return fail(`${id}번 자료를 열 수 없습니다. (${problem})`);
    window.SITE_HOSTED = true;
    window.SITE_CONFIG = site.config;
    window.ADIGA_DATA = site.data;
    window.ADIGA_LINKS = site.links;
    window.ADIGA_GRADE = site.grade;
    document.title = site.config.site_title;
    await load('app.js');
  }
  start().catch(() => fail('자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'));
})();
