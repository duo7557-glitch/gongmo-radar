// 종목토론방(게시판): 상장 종목별 글 목록 → 글 상세(댓글) → 글쓰기. 네이버 종목토론방과 같은 게시판 형식.
(function () {
  const config = window.GONGMO_CONFIG || {};
  const key = config.supabasePublishableKey || config.supabaseAnonKey;
  if (!window.supabase || !config.supabaseUrl || !key) return;
  const db = window.supabase.createClient(config.supabaseUrl, key, { auth: { persistSession: false } });
  const anchor = document.querySelector('#live') || document.querySelector('#performance');
  if (!anchor) return;

  // 섹션과 메뉴를 만든다(index.html을 건드리지 않도록 스크립트에서 삽입)
  const section = document.createElement('section');
  section.className = 'board';
  section.id = 'board';
  section.innerHTML = `
    <div class="section-heading"><div><p class="eyebrow"><span></span> STOCK BOARD</p><h2>종목 토론방</h2></div>
      <div class="board-controls"><select id="boardStock" aria-label="종목 선택"></select><button type="button" class="view-button" id="boardWrite">글쓰기</button></div></div>
    <div id="boardBody" class="board-body"></div>
    <p class="chart-caption">토론방은 이용자가 쓴 글입니다. 투자 판단의 근거로 삼기 전에 공시 원문을 확인하세요. 허위 정보나 매수·매도 권유 글은 운영자가 숨길 수 있습니다.</p>`;
  anchor.parentNode.insertBefore(section, anchor);
  const nav = document.querySelector('.topbar nav');
  if (nav) { const link = document.createElement('a'); link.href = '#board'; link.textContent = '종목토론'; nav.insertBefore(link, nav.children[2] || null); }

  const body = section.querySelector('#boardBody');
  const stockSelect = section.querySelector('#boardStock');
  const escape = s => String(s ?? '');
  const fmt = iso => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const el = (tag, attrs = {}, text) => { const node = document.createElement(tag); Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v)); if (text !== undefined) node.textContent = text; return node; };
  const errorText = error => {
    const m = String(error?.message || '');
    if (m.includes('rate_limited')) return '잠시 후 다시 올려 주세요. (도배 방지)';
    if (m.includes('empty_')) return '내용을 입력해 주세요.';
    return '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  };

  let stock = null;
  function stocks() {
    const items = (window.PriceHistory?.items || []).slice().sort((a, b) => b.listedAt.localeCompare(a.listedAt));
    stockSelect.innerHTML = items.map(item => `<option value="${escape(item.code)}" data-name="${escape(item.name)}">${escape(item.name)}</option>`).join('');
    return items;
  }

  async function showList() {
    stock = stockSelect.value;
    const name = stockSelect.selectedOptions[0]?.dataset.name || '';
    body.innerHTML = '';
    const head = el('div', { class: 'board-head' }); head.append(el('b', {}, `${name} 토론방`));
    body.append(head);
    const loading = el('p', { class: 'board-empty' }, '글을 불러오는 중…'); body.append(loading);
    const { data, error } = await db.from('stock_posts').select('id,title,nickname,views,created_at').eq('stock_code', stock).eq('moderation_status', 'visible').order('created_at', { ascending: false }).limit(50);
    loading.remove();
    if (error) { body.append(el('p', { class: 'board-empty' }, '글 목록을 불러오지 못했습니다.')); return; }
    const ids = (data || []).map(row => row.id);
    const counts = {};
    if (ids.length) {
      const { data: comments } = await db.from('stock_comments').select('post_id').in('post_id', ids).eq('moderation_status', 'visible');
      (comments || []).forEach(c => { counts[c.post_id] = (counts[c.post_id] || 0) + 1; });
    }
    const table = el('table', { class: 'board-table' });
    table.innerHTML = '<thead><tr><th>제목</th><th>글쓴이</th><th>작성일</th><th>조회</th><th>댓글</th></tr></thead>';
    const tbody = el('tbody');
    for (const row of data || []) {
      const tr = el('tr', { class: 'board-row', tabindex: '0' });
      const title = el('td', { class: 'board-title' }); title.append(el('span', {}, row.title)); if (counts[row.id]) title.append(el('em', {}, ` [${counts[row.id]}]`));
      tr.append(title, el('td', {}, row.nickname), el('td', {}, fmt(row.created_at)), el('td', {}, String(row.views)), el('td', {}, String(counts[row.id] || 0)));
      tr.addEventListener('click', () => showPost(row.id));
      tr.addEventListener('keydown', e => { if (e.key === 'Enter') showPost(row.id); });
      tbody.append(tr);
    }
    if (!data?.length) { const tr = el('tr'); const td = el('td', { colspan: '5', class: 'board-empty' }, '아직 글이 없습니다. 첫 글을 남겨 보세요.'); tr.append(td); tbody.append(tr); }
    table.append(tbody);
    body.append(table);
  }

  async function showPost(id) {
    body.innerHTML = '';
    const back = el('button', { type: 'button', class: 'view-button board-back' }, '← 목록');
    back.addEventListener('click', showList);
    body.append(back);
    const { data: post, error } = await db.from('stock_posts').select('id,title,nickname,body,views,created_at').eq('id', id).eq('moderation_status', 'visible').maybeSingle();
    if (error || !post) { body.append(el('p', { class: 'board-empty' }, '글을 찾을 수 없습니다. 숨겨졌거나 삭제된 글일 수 있습니다.')); return; }
    db.rpc('bump_post_view', { post: id }).then(() => {}, () => {});
    const article = el('article', { class: 'board-post' });
    article.append(el('h3', {}, post.title), el('p', { class: 'board-meta' }, `${post.nickname} · ${fmt(post.created_at)} · 조회 ${post.views + 1}`), el('div', { class: 'board-text' }, post.body));
    body.append(article);

    const { data: comments } = await db.from('stock_comments').select('id,nickname,body,created_at').eq('post_id', id).eq('moderation_status', 'visible').order('created_at');
    const list = el('ul', { class: 'board-comments', 'aria-label': '댓글' });
    for (const c of comments || []) { const li = el('li'); li.append(el('b', {}, c.nickname), el('span', {}, ' ' + c.body), el('small', {}, ' ' + fmt(c.created_at))); list.append(li); }
    body.append(el('h4', {}, `댓글 ${comments?.length || 0}`), list);

    const form = el('form', { class: 'board-form' });
    form.innerHTML = `<input name="nickname" maxlength="12" placeholder="닉네임" aria-label="닉네임" value="${escape(localStorage.getItem('gongmo-radar-nickname') || '')}" /><input name="body" maxlength="300" placeholder="댓글을 입력하세요" aria-label="댓글" required /><button type="submit" class="primary-button">댓글 달기</button><p class="board-feedback" role="status"></p>`;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const nickname = (form.nickname.value || '').trim().slice(0, 12) || '익명';
      const text = form.body.value.trim();
      const feedback = form.querySelector('.board-feedback');
      if (!text) return;
      localStorage.setItem('gongmo-radar-nickname', nickname);
      const { error: insertError } = await db.from('stock_comments').insert({ post_id: id, nickname, body: text });
      if (insertError) { feedback.textContent = errorText(insertError); return; }
      showPost(id);
    });
    body.append(form);
  }

  function writeForm() {
    body.innerHTML = '';
    const back = el('button', { type: 'button', class: 'view-button board-back' }, '← 목록');
    back.addEventListener('click', showList);
    body.append(back, el('h3', {}, `${stockSelect.selectedOptions[0]?.dataset.name || ''} 글쓰기`));
    const form = el('form', { class: 'board-form board-write' });
    form.innerHTML = `<input name="nickname" maxlength="12" placeholder="닉네임" aria-label="닉네임" value="${escape(localStorage.getItem('gongmo-radar-nickname') || '')}" /><input name="title" maxlength="60" placeholder="제목 (2~60자)" aria-label="제목" required /><textarea name="body" maxlength="1000" rows="6" placeholder="내용 (2~1000자). 근거가 되는 공시가 있으면 함께 적어 주세요." aria-label="내용" required></textarea><button type="submit" class="primary-button">등록</button><p class="board-feedback" role="status"></p>`;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const feedback = form.querySelector('.board-feedback');
      const nickname = (form.nickname.value || '').trim().slice(0, 12) || '익명';
      localStorage.setItem('gongmo-radar-nickname', nickname);
      const { error } = await db.from('stock_posts').insert({ stock_code: stock || stockSelect.value, nickname, title: form.title.value.trim(), body: form.body.value.trim() });
      if (error) { feedback.textContent = errorText(error); return; }
      showList();
    });
    body.append(form);
  }

  stocks();
  stockSelect.addEventListener('change', showList);
  section.querySelector('#boardWrite').addEventListener('click', writeForm);
  setTimeout(() => { stocks(); showList(); }, 700);
})();
