const defaults = {
  apiToken: '',
  turbo: true,
  speed_show_info: true,
  ippatsu_meaning: false,
  ippatsu_reading: false,
  transcript: true,
  transcript_theme: 'system',
  transcript_position: 'top',
  show_help_button: true,
  debug: false,
  customCorrections: [],
};

const apiTokenPageUrl = 'https://www.wanikani.com/settings/personal_access_tokens';
const apiTokenPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

// Keys read/written via a same-id form element. customCorrections is edited
// through the dynamic row list below instead.
const fields = Object.keys(defaults).filter((k) => k !== 'customCorrections');

function get(id) { return document.getElementById(id); }

function setTokenStatus(message, state = '') {
  const status = get('tokenStatus');
  status.textContent = message;
  status.className = `status${state ? ` ${state}` : ''}`;
}

function extractApiToken(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const el of doc.querySelectorAll('input, textarea, code, samp, kbd, pre, span, td')) {
    const inputValue = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : '';
    const val = inputValue || el.getAttribute('value') || el.textContent || '';
    const match = val.match(apiTokenPattern);
    if (match) return match[0];
  }
  return '';
}

async function findApiToken() {
  const button = get('findApiToken');
  button.disabled = true;
  setTokenStatus('Checking WaniKani...');
  try {
    const resp = await fetch(apiTokenPageUrl, { credentials: 'include' });
    if (!resp.ok) {
      setTokenStatus('Could not open WaniKani token settings. Sign in, then try again.', 'error');
      return;
    }
    const token = extractApiToken(await resp.text());
    if (!token) {
      setTokenStatus('No token found. Create or copy a read-only token, then paste it here.', 'error');
      return;
    }
    get('apiToken').value = token;
    setTokenStatus('Token found. Save settings to use it.', 'ok');
  } catch {
    setTokenStatus('Could not fetch the WaniKani token page. Paste the token manually.', 'error');
  } finally {
    button.disabled = false;
  }
}

// ── custom corrections editor ─────────────────────────────────────────────────

function refreshCorrectionsChrome() {
  const hasRows = !!get('corrections').children.length;
  get('correctionHeader').hidden = !hasRows;
  get('correctionsEmpty').hidden = hasRows;
}

function correctionRow({ heard = '', intended = '' } = {}) {
  const row = document.createElement('div');
  row.className = 'correction-row';

  const heardInput = document.createElement('input');
  heardInput.type = 'text';
  heardInput.className = 'heard';
  heardInput.placeholder = 'what was heard';
  heardInput.value = heard;

  const intendedInput = document.createElement('input');
  intendedInput.type = 'text';
  intendedInput.className = 'intended';
  intendedInput.placeholder = 'what you meant';
  intendedInput.value = intended;

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove';
  remove.textContent = '✕';
  remove.title = 'Remove correction';
  remove.setAttribute('aria-label', 'Remove correction');
  remove.addEventListener('click', () => {
    row.remove();
    refreshCorrectionsChrome();
  });

  row.append(heardInput, intendedInput, remove);
  return row;
}

function renderCorrections(pairs) {
  get('corrections').replaceChildren(...(pairs || []).map(correctionRow));
  refreshCorrectionsChrome();
}

// Rows with either side blank are dropped on save rather than stored.
function readCorrections() {
  return [...get('corrections').querySelectorAll('.correction-row')]
    .map((row) => ({
      heard: row.querySelector('.heard').value.trim(),
      intended: row.querySelector('.intended').value.trim(),
    }))
    .filter((p) => p.heard && p.intended);
}

get('addCorrection').addEventListener('click', () => {
  const row = correctionRow();
  get('corrections').appendChild(row);
  refreshCorrectionsChrome();
  row.querySelector('.heard').focus();
});

get('findApiToken').addEventListener('click', findApiToken);

// ── form load/save ────────────────────────────────────────────────────────────

function readForm() {
  const values = {};
  for (const key of fields) {
    const el = get(key);
    if (!el) continue;
    if (el.type === 'checkbox') values[key] = el.checked;
    else if (el.type === 'number') values[key] = parseFloat(el.value);
    else values[key] = el.value;
  }
  values.customCorrections = readCorrections();
  return values;
}

function populateForm(settings) {
  for (const key of fields) {
    const el = get(key);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!settings[key];
    else el.value = settings[key] ?? defaults[key];
  }
  renderCorrections(settings.customCorrections);
}

async function load() {
  const stored = await chrome.storage.sync.get(Object.keys(defaults));
  populateForm({ ...defaults, ...stored });
}

get('save').addEventListener('click', async () => {
  const values = readForm();
  await chrome.storage.sync.set(values);
  // Reflect what was actually stored (e.g. half-filled rows are dropped).
  renderCorrections(values.customCorrections);
  const save = get('save');
  save.textContent = 'Saved.';
  save.disabled = true;
  setTimeout(() => { save.textContent = 'Save settings'; save.disabled = false; }, 2000);
});

load();
