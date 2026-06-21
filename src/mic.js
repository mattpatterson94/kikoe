function setupMicButton() {
  const menu = document.querySelector('div.character-header__menu-navigation');
  const item = document.createElement('div');
  item.classList.add('character-header__menu-navigation-link');
  item.style = 'margin-left: 10px;';
  const link = document.createElement('a');
  link.title = 'Toggle voice input';
  link.classList.add('summary-button');

  let state = true;
  link.onclick = function(e) {
    if (state) {
      icon.classList.remove('fa-solid');
      icon.classList.add('fa-light');
    } else {
      icon.classList.remove('fa-solid');
      icon.classList.add('fa-light');
    }
    state = !state;
  };

  const icon = document.createElement('i');
  icon.classList.add('wk-icon');
  icon.classList.add('fa-solid');
  icon.classList.add('fa-microphone');

  link.appendChild(icon);
  item.appendChild(link);
  menu.appendChild(item);
}
