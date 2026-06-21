const defaults = {
  apiToken: '',
  lightning: false,
  lightning_delay: 0.1,
  mistake_delay: 0.1,
  speed_show_info: true,
  transcript: true,
  transcript_background: '#ffd700',
  transcript_foreground: '#000000',
  transcript_position: 'top',
  transcript_delay: 5,
  transcript_count: 1,
  transcript_clear: false,
};

const fields = Object.keys(defaults);

function get(id) { return document.getElementById(id); }

function readForm() {
  const values = {};
  for (const key of fields) {
    const el = get(key);
    if (!el) continue;
    if (el.type === 'checkbox') values[key] = el.checked;
    else if (el.type === 'number') values[key] = parseFloat(el.value);
    else values[key] = el.value;
  }
  return values;
}

function populateForm(settings) {
  for (const key of fields) {
    const el = get(key);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!settings[key];
    else el.value = settings[key] ?? defaults[key];
  }
}

async function load() {
  const stored = await chrome.storage.sync.get(fields);
  populateForm({ ...defaults, ...stored });
}

get('save').addEventListener('click', async () => {
  const values = readForm();
  await chrome.storage.sync.set(values);
  const status = get('status');
  status.textContent = 'Saved.';
  setTimeout(() => { status.textContent = ''; }, 2000);
});

load();
