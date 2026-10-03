import { CONFIG } from '../config.js';
import { t } from '../i18n.js';

const $ = (id) => document.getElementById(id);

export class Overlay {
  constructor() {
    this.caption = $('caption');
    this.hint = $('hint');
    this.progress = $('progress');
    this.fill = $('progress-fill');
    this.mute = $('mute');
    this.credits = $('credits');
    this.current = null;
    this.swapTimer = 0;
    this.creditsOn = false;
    $('author').textContent = CONFIG.author;
    const gh = $('github');
    gh.href = CONFIG.github;
    gh.textContent = CONFIG.githubLabel;
  }

  loading(p, label) {
    $('loader-fill').style.width = `${Math.round(p * 100)}%`;
    $('loader-text').textContent = label;
  }

  ready(onStart) {
    this.loading(1, t('ready'));
    const btn = $('start');
    btn.disabled = false;
    btn.classList.add('ready');
    $('loader').style.display = 'none';
    btn.addEventListener('click', () => {
      $('intro').classList.add('gone');
      setTimeout(() => { $('intro').style.display = 'none'; }, 1700);
      this.progress.classList.add('on');
      this.mute.classList.add('on');
      onStart();
    }, { once: true });
  }

  skip() {
    $('intro').style.display = 'none';
    this.progress.classList.add('on');
    this.mute.classList.add('on');
  }

  noGL() {
    $('intro').style.display = 'none';
    $('nogl').hidden = false;
  }

  update(u, total, idle, captions) {
    this.fill.style.width = `${(u / total) * 100}%`;
    this.hint.classList.toggle('on', idle > 3.5 && u < 968 && !this.creditsOn);

    let c = null;
    for (const cap of captions) if (u >= cap[0] && u <= cap[1]) { c = cap; break; }
    if (c !== this.current) {
      this.current = c;
      this.caption.classList.remove('on');
      clearTimeout(this.swapTimer);
      this.swapTimer = setTimeout(() => {
        if (!this.current) return;
        this.caption.textContent = t('captions')[this.current[2]];
        this.caption.classList.toggle('mono', this.current[3] === 'mono');
        this.caption.classList.add('on');
      }, this.caption.textContent ? 650 : 0);
    }
  }

  showCredits(stats) {
    if (this.creditsOn) return;
    this.creditsOn = true;
    this.credits.hidden = false;
    requestAnimationFrame(() => this.credits.classList.add('on'));
    $('gpu-name').textContent = stats.gpu;
    const loc = t('locale');
    const fmt = (n) => Math.round(n).toLocaleString(loc);
    const count = (id, target, f) => {
      const el = $(id);
      const t0 = performance.now();
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / 2200);
        const e = 1 - Math.pow(1 - k, 3);
        el.textContent = f(target * e);
        if (k < 1) setTimeout(step, 16);
      };
      step();
    };
    count('st-particles', stats.particles, fmt);
    count('st-tris', stats.triangles, (n) => (n > 1e9 ? `${(n / 1e9).toLocaleString(loc, { maximumFractionDigits: 1 })} ${t('billion')}` : `${(n / 1e6).toLocaleString(loc, { maximumFractionDigits: 0 })} ${t('million')}`));
    count('st-frames', stats.frames, fmt);
    const m = Math.floor(stats.seconds / 60), s = Math.floor(stats.seconds % 60);
    $('st-time').textContent = `${m}min ${String(s).padStart(2, '0')}s`;
  }

  hideCredits() {
    if (!this.creditsOn) return;
    this.creditsOn = false;
    this.credits.classList.remove('on');
    setTimeout(() => { if (!this.creditsOn) this.credits.hidden = true; }, 2000);
  }
}
