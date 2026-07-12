// settings.js — közös ViewForge beállítás-rendszer (minden oldal betölti)
// Hasznalat: az oldal sajat load handlerében, Clerk.load() UTAN hívd meg:
//   applySettings(vfMeta().settings || {});
//   initSettingsPanel();
// Feltetelezi, hogy a vfMeta() es saveVfMeta() fuggvenyek mar letexnek az oldal sajat scriptjeben.

const COLOR_PRESETS = {
  purple: { brand: '#9B5FFF', brandSoft: 'rgba(155,95,255,0.14)', hot: '#FF4D8D', label: 'Lila' },
  red:    { brand: '#FF5C5C', brandSoft: 'rgba(255,92,92,0.14)',  hot: '#FFB067', label: 'Piros' },
  yellow: { brand: '#E0B33C', brandSoft: 'rgba(224,179,60,0.16)', hot: '#FF8A5C', label: 'Sárga' },
  blue:   { brand: '#4C9AFF', brandSoft: 'rgba(76,154,255,0.14)', hot: '#5CE1E6', label: 'Kék' },
  green:  { brand: '#3DDC97', brandSoft: 'rgba(61,220,151,0.14)', hot: '#8CE05C', label: 'Zöld' },
};

const FONT_PRESETS = {
  default:   { display: "'Bebas Neue',sans-serif",       heading: "'Space Grotesk',sans-serif", body: "'Inter',sans-serif",         label: 'Alap' },
  classic:   { display: "'Playfair Display',serif",      heading: "'Playfair Display',serif",   body: "'Inter',sans-serif",         label: 'Klasszikus' },
  modern:    { display: "'Poppins',sans-serif",          heading: "'Poppins',sans-serif",       body: "'Poppins',sans-serif",       label: 'Modern' },
  playful:   { display: "'Fredoka',sans-serif",          heading: "'Fredoka',sans-serif",       body: "'Nunito',sans-serif",        label: 'Játékos' },
  technical: { display: "'JetBrains Mono',monospace",    heading: "'JetBrains Mono',monospace", body: "'Inter',sans-serif",         label: 'Technikai' },
  minimal:   { display: "'Inter',sans-serif",            heading: "'Inter',sans-serif",         body: "'Inter',sans-serif",         label: 'Minimál' },
};

const DEFAULT_SETTINGS = {
  color: 'purple',
  font: 'default',
  theme: 'dark',
  animations: true,
  animatedBg: true,
};

function applySettings(settings){
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const root = document.documentElement;

  const color = COLOR_PRESETS[s.color] || COLOR_PRESETS.purple;
  root.style.setProperty('--brand', color.brand);
  root.style.setProperty('--brand-soft', color.brandSoft);
  root.style.setProperty('--hot', color.hot);

  const font = FONT_PRESETS[s.font] || FONT_PRESETS.default;
  root.style.setProperty('--font-display', font.display);
  root.style.setProperty('--font-heading', font.heading);
  root.style.setProperty('--font-body', font.body);

  root.setAttribute('data-theme', s.theme === 'light' ? 'light' : 'dark');
  root.setAttribute('data-animations', s.animations === false ? 'off' : 'on');
  root.setAttribute('data-animated-bg', s.animatedBg ? 'on' : 'off');
}

async function initSettingsPanel(){
  const userBtn = document.getElementById('userButton');
  if (!userBtn || document.getElementById('settingsBtn')) return; // mar letezik, vagy nincs hova tenni

  const gear = document.createElement('div');
  gear.className = 'settings-btn';
  gear.id = 'settingsBtn';
  gear.title = 'Beállítások';
  gear.textContent = '⚙️';
  const navRightWrap = document.createElement('div');
  navRightWrap.style.display = 'flex';
  navRightWrap.style.alignItems = 'center';
  userBtn.parentNode.insertBefore(navRightWrap, userBtn);
  navRightWrap.appendChild(gear);
  navRightWrap.appendChild(userBtn);

  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.id = 'settingsOverlay';
  overlay.innerHTML = `
    <div class="settings-panel">
      <div class="settings-title">Megjelenés <span class="settings-close" id="settingsCloseBtn">✕</span></div>

      <div class="settings-group">
        <div class="settings-label">Szín</div>
        <div class="color-swatch-row" id="colorSwatchRow"></div>
      </div>

      <div class="settings-group">
        <div class="settings-label">Betűtípus</div>
        <select class="settings-select" id="fontSelect"></select>
      </div>

      <div class="settings-group">
        <div class="settings-label">Téma</div>
        <div class="theme-btn-row">
          <div class="theme-btn" data-theme="dark">🌙 Sötét</div>
          <div class="theme-btn" data-theme="light">☀️ Világos</div>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-toggle-row">
          <div class="st-label">Animációk</div>
          <div class="mini-toggle" id="animToggle"></div>
        </div>
        <div class="settings-toggle-row" style="margin-top:10px;">
          <div class="st-label">Animált háttér</div>
          <div class="mini-toggle" id="bgToggle"></div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Szín-választók feltöltése
  const colorRow = document.getElementById('colorSwatchRow');
  Object.entries(COLOR_PRESETS).forEach(([key, c]) => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch';
    sw.style.background = c.brand;
    sw.style.color = c.brand;
    sw.dataset.color = key;
    sw.title = c.label;
    colorRow.appendChild(sw);
  });

  // Betűtípus lista feltöltése
  const fontSelect = document.getElementById('fontSelect');
  Object.entries(FONT_PRESETS).forEach(([key, f]) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = f.label;
    fontSelect.appendChild(opt);
  });

  function refreshPanelUI(settings){
    const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
    colorRow.querySelectorAll('.color-swatch').forEach(sw => sw.classList.toggle('selected', sw.dataset.color === s.color));
    fontSelect.value = s.font;
    overlay.querySelectorAll('.theme-btn').forEach(btn => btn.classList.toggle('selected', btn.dataset.theme === s.theme));
    document.getElementById('animToggle').classList.toggle('on', s.animations !== false);
    document.getElementById('bgToggle').classList.toggle('on', !!s.animatedBg);
  }

  async function updateSetting(partial){
    const meta = vfMeta();
    const newSettings = { ...DEFAULT_SETTINGS, ...(meta.settings || {}), ...partial };
    applySettings(newSettings);
    refreshPanelUI(newSettings);
    await saveVfMeta({ settings: newSettings });
  }

  colorRow.addEventListener('click', (e) => {
    const sw = e.target.closest('.color-swatch');
    if (sw) updateSetting({ color: sw.dataset.color });
  });
  fontSelect.addEventListener('change', () => updateSetting({ font: fontSelect.value }));
  overlay.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => updateSetting({ theme: btn.dataset.theme }));
  });
  document.getElementById('animToggle').addEventListener('click', (e) => {
    updateSetting({ animations: !e.target.classList.contains('on') });
  });
  document.getElementById('bgToggle').addEventListener('click', (e) => {
    updateSetting({ animatedBg: !e.target.classList.contains('on') });
  });

  gear.addEventListener('click', () => {
    refreshPanelUI((vfMeta().settings) || {});
    overlay.classList.add('open');
  });
  document.getElementById('settingsCloseBtn').addEventListener('click', () => overlay.classList.remove('open'));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });

  refreshPanelUI(vfMeta().settings || {});
}

/** Elegáns toast-értesítés az alert() helyett. type: 'info' | 'success' | 'error' */
function showToast(message, type){
  type = type || 'info';
  let container = document.getElementById('toastContainer');
  if (!container){
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 300);
  }, 3800);
}
