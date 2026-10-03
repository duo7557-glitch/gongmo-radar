// 채팅 방 선택: 공모주 라운지 또는 상장 종목별 토론방(room = stock:코드).
(function () {
  const header = document.querySelector('.chat-box .chat-header');
  if (!header) return;
  const select = document.createElement('select');
  select.id = 'chatRoomSelect';
  select.className = 'chat-room-select';
  select.setAttribute('aria-label', '채팅 방 선택');
  select.innerHTML = '<option value="lobby">공모주 라운지</option><optgroup label="상장 종목 토론방" id="chatRoomGroup"></optgroup>';
  header.insertBefore(select, header.querySelector('#chatStatus'));

  const fill = () => {
    const items = (window.PriceHistory?.items || []).slice().sort((a, b) => b.listedAt.localeCompare(a.listedAt));
    const group = document.querySelector('#chatRoomGroup');
    if (!items.length || !group || group.childElementCount) return;
    group.innerHTML = items.map(item => `<option value="stock:${item.code}" data-label="${item.name}">${item.name}</option>`).join('');
  };
  setTimeout(fill, 600);

  select.addEventListener('change', () => {
    const option = select.selectedOptions[0];
    const name = select.value === 'lobby' ? 'lobby' : select.value;
    const label = select.value === 'lobby' ? '공모주 라운지' : `${option.dataset.label || option.textContent} 토론방`;
    window.gongmoChat?.switchRoom(name, label);
  });
})();
