// 실시간 공모주 뉴스: 제목(원문 링크)·언론사·시간·짧은 요약. 기사 본문은 가져오지 않는다.
(function () {
  const config = window.GONGMO_CONFIG || {};
  if (!config.supabaseUrl) return;
  const anchor = document.querySelector('#board') || document.querySelector('#performance');
  if (!anchor) return;

  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'news.css?v=20261004-footer-fixed';
  document.head.appendChild(css);

  const section = document.createElement('section');
  section.className = 'news';
  section.id = 'news';
  section.innerHTML = `
    <div class="section-heading"><div><p class="eyebrow"><span></span> LIVE NEWS</p><h2>공모주 뉴스</h2></div>
      <div class="news-controls"><span class="news-status" id="newsStatus" role="status"></span><button type="button" class="view-button" id="newsRefresh">새로고침</button></div></div>
    <ol class="news-list" id="newsList" aria-live="polite"><li class="news-empty">뉴스를 불러오는 중…</li></ol>
    <p class="chart-caption">뉴스는 구글 뉴스 검색 결과를 모았습니다. 제목을 누르면 언론사 원문으로 이동합니다. 기사 내용은 원문에서 확인하세요.</p>`;
  anchor.insertAdjacentElement('afterend', section);

  const list = section.querySelector('#newsList');
  const status = section.querySelector('#newsStatus');
  const fmt = iso => iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
  const el = (tag, attrs = {}, text) => { const node = document.createElement(tag); Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v)); if (text !== undefined) node.textContent = text; return node; };

  function render(items) {
    list.innerHTML = '';
    if (!items.length) { list.append(el('li', { class: 'news-empty' }, '최근 공모주 뉴스가 없습니다.')); return; }
    for (const item of items) {
      const li = el('li', { class: 'news-item' });
      const link = el('a', { class: 'news-title', href: item.link, target: '_blank', rel: 'noopener noreferrer' }, item.title);
      const meta = el('p', { class: 'news-meta' }, [item.source, fmt(item.published)].filter(Boolean).join(' · '));
      li.append(link, meta);
      if (item.summary) li.append(el('p', { class: 'news-summary' }, item.summary));
      list.append(li);
    }
  }

  async function load() {
    status.textContent = '';
    try {
      const response = await fetch(config.supabaseUrl.replace(/\/$/, '') + '/functions/v1/news');
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || 'failed');
      render(data.items || []);
      status.textContent = '갱신 ' + fmt(data.fetchedAt);
    } catch {
      list.innerHTML = '';
      list.append(el('li', { class: 'news-empty' }, '뉴스를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.'));
    }
  }

  section.querySelector('#newsRefresh').addEventListener('click', load);
  load();
  setInterval(() => { if (!document.hidden) load(); }, 10 * 60 * 1000);
})();
