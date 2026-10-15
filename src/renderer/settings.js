'use strict';

// Uygulama ayarları penceresi, Gece/Gündüz düğmesi ve hesap durumu (ana pencere ve site penceresi ortak)

// --- Mastertool hesabı ve senkron durumu -------------------------------------------
let acct = { loggedIn: false };
const acctListeners = [];

function syncText(st) {
  if (!st.syncEnabled || st.state === 'off') return t('sync.off');
  if (st.state === 'syncing') return t('sync.syncing');
  if (st.state === 'offline') return t('sync.offline');
  if (st.state === 'error') {
    if (st.error === 'decrypt_failed') return t('sync.errDecrypt');
    if (st.error === 'too_large') return t('sync.errTooLarge');
    return t('sync.error', { msg: st.errorMessage || st.error });
  }
  return st.lastSyncAt ? t('acct.lastSync', { time: formatDate(st.lastSyncAt) }) : t('acct.never');
}

function onAcct(fn) { acctListeners.push(fn); fn(acct); }
function setAcct(st) {
  acct = st;
  const live = document.querySelector('#acct-status');
  if (live) live.textContent = syncText(acct);
  acctListeners.forEach((fn) => fn(acct));
}
window.api.onAccountStatus(setAcct);
window.api.accountState().then(setAcct);

async function logout() {
  const ok = await confirmBox(t('acct.logout'), esc(t('acct.logoutMsg')), { okText: t('acct.logout') });
  if (ok) window.api.logout();
}

// Hızlı tema düğmesi: Gece ↔ Gündüz
function themeButton(btn, getSettings) {
  const paint = () => {
    const dark = (getSettings().appTheme || 'dark') !== 'light' && !(getSettings().appTheme === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
    btn.innerHTML = icon(dark ? 'sun' : 'moon');
    btn.title = dark ? t('set.toLight') : t('set.toDark');
  };
  btn.onclick = async () => {
    const dark = !matchMedia('(prefers-color-scheme: light)').matches;
    await window.api.setSettings({ appTheme: dark ? 'light' : 'dark' });
  };
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', paint);
  paint();
  return paint;
}

const CONFLICT_OPTS = () => [['overwrite', t('opt.conflictOverwrite')], ['rename', t('opt.conflictRename')], ['skip', t('opt.conflictSkip')]];
const TRANSFER_TYPES = () => [['binary', t('type.binary')], ['ascii', t('type.ascii')], ['auto', t('type.auto')]];
const options = (list, v) => list.map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('');

async function openSettings(s, { focusSpeed = false } = {}) {
  let appTheme = s.appTheme || 'dark';
  const langOptions = Object.entries(I18N.LANGUAGES)
    .map(([code, l]) => `<option value="${code}" ${code === LANG ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
  const body = h(`<div style="display:grid;gap:16px">
    <div class="section-title" style="margin:0">${esc(t('acct.section'))}</div>
    <div class="acct-box">
      <div class="acct-who">${icon('user')}<span>${esc(t('acct.signedInAs', { email: (acct.user && acct.user.email) || acct.email || '' }))}</span></div>
      <label class="check"><input type="checkbox" id="s-sync" ${acct.syncEnabled ? 'checked' : ''}>
        <span>${esc(t('acct.syncToggle'))}<small>${esc(t('acct.syncHint'))}</small></span></label>
      <div class="acct-status">${icon('cloud')}<span id="acct-status">${esc(syncText(acct))}</span></div>
      <div class="acct-actions">
        <button class="btn sm" type="button" id="s-syncnow">${icon('refresh')}${esc(t('acct.syncNow'))}</button>
        <button class="btn sm" type="button" id="s-delremote">${icon('trash')}${esc(t('acct.deleteRemote'))}</button>
        <button class="btn sm" type="button" id="s-web">${icon('open')}${esc(t('acct.myAccount'))}</button>
        <span style="flex:1"></span>
        <button class="btn sm danger" type="button" id="s-logout">${icon('logout')}${esc(t('acct.logout'))}</button>
      </div>
    </div>

    <div class="section-title" style="margin:6px 0 0">${esc(t('set.appearance'))}</div>
    <div class="row c-1-1">
      <div class="field"><label>${esc(t('set.theme'))}</label>
        <div class="seg" id="s-theme">
          <button data-v="dark">${icon('moon')}${esc(t('set.themeDark'))}</button>
          <button data-v="light">${icon('sun')}${esc(t('set.themeLight'))}</button>
          <button data-v="system">${icon('monitor')}${esc(t('set.themeSystem'))}</button>
        </div></div>
      <div class="field"><label>${esc(t('set.language'))}</label><select class="input" id="s-lang">${langOptions}</select></div>
    </div>

    <div class="section-title" style="margin:6px 0 0">${esc(t('set.speed'))}</div>
    <label class="check"><input type="checkbox" id="s-limit" ${s.speedLimitOn ? 'checked' : ''}>
      <span>${esc(t('set.speedOn'))}<small>${esc(t('set.speedHint'))}</small></span></label>
    <div class="row c-1-1">
      <div class="field"><label>${esc(t('set.speedMax'))}</label>
        <div class="unit-wrap"><input class="input" id="s-kb" type="number" min="1" max="10000000" value="${esc(s.speedLimitKB || 1024)}"><span>KB/s</span></div></div>
      <div class="field"><label>&nbsp;</label><div class="chips" id="s-presets"></div></div>
    </div>

    <div class="section-title" style="margin:6px 0 0">${esc(t('set.transfers'))}</div>
    <div class="row c-1-1">
      <div class="field"><label>${esc(t('opt.maxConcurrent'))}</label><input class="input" id="s-conc" type="number" min="1" max="20" value="${esc(s.maxConcurrent || 4)}"></div>
      <div class="field"><label>${esc(t('type.transferType'))}</label><select class="input" id="s-ttype">${options(TRANSFER_TYPES(), s.transferType || 'binary')}</select></div>
    </div>
    <div class="row c-1-1">
      <div class="field"><label>${esc(t('opt.retry'))}</label><input class="input" id="s-retry" type="number" min="0" max="99" value="${esc(s.retryAttempts ?? 3)}"></div>
      <div class="field"><label>${esc(t('opt.retryDelay'))}</label><input class="input" id="s-delay" type="number" min="0" max="3600" value="${esc(s.retryDelay ?? 10)}"></div>
    </div>
    <div class="field"><label>${esc(t('opt.conflict'))}</label><select class="input" id="s-conflict">${options(CONFLICT_OPTS(), s.conflict || 'overwrite')}</select></div>
    <div class="about">${icon('info')} FTP Masters ${esc(window.api.version || '')}</div>
  </div>`);

  const q = (sel) => body.querySelector(sel);

  // Hesap bölümündeki işlemler anında uygulanır (Kaydet beklemez)
  q('#s-sync').onchange = async (e) => {
    const on = e.target.checked;
    const r = await window.api.setSyncEnabled(on);
    if (!r.ok) { e.target.checked = !on; toast(t('sync.error', { msg: r.code }), { type: 'err' }); }
  };
  q('#s-syncnow').onclick = () => window.api.syncNow();
  q('#s-web').onclick = () => window.api.openWeb('account');
  q('#s-delremote').onclick = async () => {
    const ok = await confirmBox(t('acct.deleteRemote'), esc(t('acct.deleteRemoteMsg')));
    if (!ok) return;
    const r = await window.api.deleteRemoteLibrary();
    if (r.ok) { q('#s-sync').checked = false; toast(t('acct.deleteRemoteDone'), { type: 'ok' }); }
    else toast(t('sync.error', { msg: r.code }), { type: 'err' });
  };
  q('#s-logout').onclick = logout;
  const syncLimit = () => q('#s-kb').disabled = !q('#s-limit').checked;
  q('#s-limit').onchange = syncLimit;
  syncLimit();
  for (const kb of [256, 512, 1024, 5120, 10240]) {
    const b = h(`<button type="button" class="chip">${kb >= 1024 ? kb / 1024 + ' MB/s' : kb + ' KB/s'}</button>`);
    b.onclick = () => { q('#s-limit').checked = true; syncLimit(); q('#s-kb').value = kb; };
    q('#s-presets').appendChild(b);
  }

  // Tema seçimi anında uygulanır (önizleme); İptal edilirse eski temaya döner
  const setTheme = (v) => {
    appTheme = v;
    body.querySelectorAll('#s-theme button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    window.api.setSettings({ appTheme: v });
  };
  body.querySelectorAll('#s-theme button').forEach((b) => (b.onclick = () => setTheme(b.dataset.v)));
  body.querySelectorAll('#s-theme button').forEach((b) => b.classList.toggle('on', b.dataset.v === appTheme));
  const originalTheme = appTheme;

  const clamp = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def; };
  const res = await openModal({
    title: t('set.title'), iconName: 'gear', width: 600, body,
    onMount: () => { if (focusSpeed) setTimeout(() => { q('#s-kb').focus(); q('#s-kb').select(); }, 60); },
    buttons: [
      { label: t('common.cancel'), value: null },
      {
        label: t('common.save'), cls: 'primary',
        onClick: () => ({
          appTheme,
          language: q('#s-lang').value,
          speedLimitOn: q('#s-limit').checked,
          speedLimitKB: clamp(q('#s-kb').value, 1, 10000000, 1024),
          maxConcurrent: clamp(q('#s-conc').value, 1, 20, 4),
          transferType: q('#s-ttype').value,
          retryAttempts: clamp(q('#s-retry').value, 0, 99, 3),
          retryDelay: clamp(q('#s-delay').value, 0, 3600, 10),
          conflict: q('#s-conflict').value,
        }),
      },
    ],
  });
  if (!res) {
    if (appTheme !== originalTheme) window.api.setSettings({ appTheme: originalTheme });
    return null;
  }
  const langChanged = res.language !== LANG;
  if (!langChanged) delete res.language; // dil değişmediyse pencereyi yeniden yükleme
  await window.api.setSettings(res);
  if (!langChanged) toast(t('set.saved'), { type: 'ok' });
  return res;
}
