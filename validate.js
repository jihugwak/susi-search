/* 번호별 자료(site.json) 검사기. 업로드 페이지와 사이트가 함께 쓴다.
   자료는 누구나 올릴 수 있는 외부 입력으로 취급한다. 화면 코드가 숫자로 믿고
   그대로 출력하는 칸이 있으므로, 형식이 조금이라도 다르면 통째로 거부한다. */
(function () {
  'use strict';
  const DICT_COLS = ['지역', '대학', '교과/종합', '전형', '학과', '인문/자연', '소계열'];
  const NUM_COLS = ['모집인원', '경쟁률', '추합', '변환50', '변환70', '만점', '등급50', '등급70',
    '총지원지원', '합격인원', '실경쟁률'];
  const MAX_ROWS = 500000, MAX_TEXT = 300;

  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isText = (v, max) => typeof v === 'string' && v.length <= (max || MAX_TEXT);
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const isWeb = v => {
    if (typeof v !== 'string' || v.length > 2000) return false;
    try { return ['http:', 'https:'].includes(new URL(v).protocol); } catch (e) { return false; }
  };

  function checkData(d) {
    if (!isObj(d) || !Number.isInteger(d.n) || d.n < 1 || d.n > MAX_ROWS) return '행 수가 올바르지 않습니다';
    if (!isObj(d.dicts) || !isObj(d.cols)) return '자료 구조가 올바르지 않습니다';
    for (const c of DICT_COLS) {
      const dict = d.dicts[c], col = d.cols[c];
      if (!Array.isArray(dict) || !dict.every(v => isText(v))) return `${c} 목록이 올바르지 않습니다`;
      if (!Array.isArray(col) || col.length !== d.n) return `${c} 열의 길이가 다릅니다`;
      if (!col.every(v => Number.isInteger(v) && v >= 0 && v < dict.length)) return `${c} 열의 값이 올바르지 않습니다`;
    }
    const years = d.cols['연도'];
    if (!Array.isArray(years) || years.length !== d.n
      || !years.every(v => Number.isInteger(v) && v >= 2000 && v <= 2100)) return '연도 열이 올바르지 않습니다';
    for (const c of NUM_COLS) {
      const col = d.cols[c];
      if (!Array.isArray(col) || col.length !== d.n) return `${c} 열의 길이가 다릅니다`;
      if (!col.every(v => v === null || isNum(v))) return `${c} 열에 숫자가 아닌 값이 있습니다`;
    }
    return null;
  }

  function checkConfig(c) {
    if (!isObj(c) || !isText(c.site_title, 100) || !c.site_title.trim()) return '사이트 이름이 없습니다';
    if (!isText(c.source, 300) || !c.source.trim()) return '자료 출처가 없습니다';
    if (c.note != null && !isText(c.note, 500)) return '안내 문구가 너무 깁니다';
    return null;
  }

  function checkLinks(l) {
    if (!isObj(l)) return '대학 링크가 올바르지 않습니다';
    for (const [name, entry] of Object.entries(l)) {
      if (!isText(name) || !isObj(entry)) return '대학 링크가 올바르지 않습니다';
      for (const [k, url] of Object.entries(entry)) {
        if (!isText(k) || !(url === null || url === '' || isWeb(url))) return `${name}의 링크가 올바르지 않습니다`;
      }
    }
    return null;
  }

  function checkGrade(g) {
    if (!Array.isArray(g) || g.length > 20000) return '등급 변환표가 올바르지 않습니다';
    const ok = g.every(r => Array.isArray(r) && r.length === 3 && r.every(v => v === null || isNum(v)));
    return ok ? null : '등급 변환표가 올바르지 않습니다';
  }

  /* 문제가 없으면 null, 있으면 사람이 읽을 메시지를 돌려준다. */
  window.checkSite = function (s) {
    if (!isObj(s)) return '자료 형식이 올바르지 않습니다';
    return checkConfig(s.config) || checkData(s.data) || checkLinks(s.links) || checkGrade(s.grade);
  };
})();
