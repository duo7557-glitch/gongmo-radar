// 채팅 설정 메뉴: 글씨 크기, 시간 표시, 내 마지막 메시지로 이동, 맨 아래로.
// app.js의 채팅 로직은 건드리지 않고 #messages 의 DOM만 바꾼다(메시지가 다시 그려져도 설정이 유지됨).
(function () {
  const KEY = 'gongmo-radar-chat-settings';
  const defaults = { size: 'normal', showTime: true };
  const read = () => { try { return { ...defaults, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; } catch { return { ...defaults }; } };
  let settings = read();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {} };

  const box = document.querySelector('#messages');
  const header = document.querySelector('.chat-box .chat-header');
  if (!box || !header) return;
  const chatBox = box.closest('.chat-box');

  // 설정 버튼과 메뉴 생성
  const button = document.createElement('button');
  button.type = 'button';
  button.id = 'chatSettingsBtn';
  button.className = 'chat-settings-btn';
  button.setAttribute('aria-label', '채팅 설정');
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');
  button.textContent = '⚙';
  header.appendChild(button);

  const menu = document.createElement('div');
  menu.className = 'chat-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <p class="chat-menu-title">글씨 크기</p>
    <div class="chat-menu-row" data-group="size">
      <button type="button" data-size="normal">기본</button>
      <button type="button" data-size="large">크게</button>
      <button type="button" data-size="xlarge">더 크게</button>
    </div>
    <p class="chat-menu-title">표시</p>
    <button type="button" class="chat-menu-item" data-toggle="showTime"><span>메시지 시간 보기</span><i aria-hidden="true"></i></button>
    <p class="chat-menu-title">이동</p>
    <button type="button" class="chat-menu-item" data-action="mine"><span>내 마지막 메시지로 이동</span></button>
    <button type="button" class="chat-menu-item" data-action="bottom"><span>맨 아래로 이동</span></button>
  `;
  chatBox.appendChild(menu);

  const sync = () => {
    chatBox.dataset.size = settings.size;
    chatBox.classList.toggle('hide-time', !settings.showTime);
    menu.querySelectorAll('[data-size]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.size === settings.size)));
    menu.querySelector('[data-toggle="showTime"]').setAttribute('aria-pressed', String(settings.showTime));
  };

  const setOpen = isOpen => { menu.hidden = !isOpen; button.setAttribute('aria-expanded', isOpen ? 'true' : 'false'); };
  button.addEventListener('click', event => { event.stopPropagation(); setOpen(menu.hidden); });
  document.addEventListener('click', event => { if (!menu.hidden && !menu.contains(event.target) && event.target !== button) setOpen(false); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) { setOpen(false); button.focus(); } });

  menu.addEventListener('click', event => {
    // chatBox에도 data-size가 있으므로 메뉴 안의 버튼만 고른다(바깥 요소와 혼동 방지).
    const sizeBtn = event.target.closest('.chat-menu [data-size]');
    if (sizeBtn) { settings.size = sizeBtn.dataset.size; save(); sync(); return; }
    const toggle = event.target.closest('.chat-menu [data-toggle]');
    if (toggle) { settings[toggle.dataset.toggle] = !settings[toggle.dataset.toggle]; save(); sync(); return; }
    const action = event.target.closest('.chat-menu [data-action]');
    if (!action) return;
    if (action.dataset.action === 'bottom') box.scrollTop = box.scrollHeight;
    if (action.dataset.action === 'mine') {
      const me = (localStorage.getItem('gongmo-radar-nickname') || document.querySelector('#chatName')?.value || '').trim();
      const mine = [...box.querySelectorAll('.message')].reverse().find(m => me && m.querySelector('.message-meta b')?.textContent.trim() === me);
      if (mine) { mine.scrollIntoView({ block: 'center', behavior: 'smooth' }); mine.classList.add('is-flash'); setTimeout(() => mine.classList.remove('is-flash'), 1400); }
      else { const status = document.querySelector('#chatStatus'); if (status) { const prev = status.textContent; status.textContent = '이 브라우저에서 보낸 메시지가 없습니다'; setTimeout(() => { status.textContent = prev; }, 1800); } }
    }
    setOpen(false);
  });

  sync();
})();
