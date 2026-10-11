import React, { useEffect, useRef } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import GeofenceScene from './GeofenceScene';
import ShiftTour from './ShiftTour';
import LanguageSwitcher from '../components/LanguageSwitcher';
import Intro from '../components/Intro';
import ProblemsSection from '../components/ProblemsSection';
import useScrolled from '../hooks/useScrolled';
import { useLang } from '../i18n/LanguageContext';
import { warmUp } from '../utils/warmUp';
import './Home.css';
import './Home.motion.css'; // must stay after Home.css

const APP_NAME = 'CareSync';
const TRUST = ['t1', 't2', 't3'];
const FAQ = ['f1', 'f2', 'f3', 'f4'];
const SECTIONS = [
  { id: 'problems', key: 'problems.title' },
  { id: 'views', key: 'views.title' },
  { id: 'trust', key: 'trust.title' },
  { id: 'faq', key: 'faq.title' },
];

// A heartbeat line that draws itself as it scrolls into view
function EcgLine() {
  const ref = useRef(null);
  useEffect(() => {
    const svg = ref.current;
    const path = svg.querySelector('path');
    const len = path.getTotalLength();
    path.style.strokeDasharray = len;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      path.style.strokeDashoffset = 0;
      return undefined;
    }
    path.style.strokeDashoffset = len;
    let raf;
    const update = () => {
      const top = svg.getBoundingClientRect().top;
      const vh = window.innerHeight;
      const p = Math.min(1, Math.max(0, (vh - top) / (vh * 0.8)));
      path.style.strokeDashoffset = len * (1 - p);
    };
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <svg ref={ref} className="ecg" viewBox="0 0 1200 80" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 40 H380 L410 40 L430 12 L455 68 L480 2 L505 62 L525 40 H700 L720 40 L735 24 L750 40 H1200" />
    </svg>
  );
}

function ScrollProgress() {
  const ref = useRef(null);
  useEffect(() => {
    const root = document.querySelector('.home');
    const update = () => {
      if (!root || !ref.current) return;
      const r = root.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      ref.current.style.transform = `scaleX(${span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 0})`;
    };
    update();
    window.addEventListener('scroll', update, { passive: true, capture: true });
    return () => window.removeEventListener('scroll', update, { capture: true });
  }, []);
  return <div className="scroll-progress" ref={ref} aria-hidden="true" />;
}

export default function Home() {
  const rootRef = useRef(null);
  const { loginWithRedirect, isLoading, error } = useAuth0();
  const { t, lang } = useLang();
  const scrolled = useScrolled(24);

  // Reveal sections as they scroll into view (skipped for reduced-motion users)
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !('IntersectionObserver' in window)) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    root.classList.add('has-reveal');
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); }
      }),
      { threshold: 0.15 }
    );
    root.querySelectorAll('.reveal, .home-section > h2, .home-cta > h2, .home-view').forEach((el) => io.observe(el));
    return () => { io.disconnect(); root.classList.remove('has-reveal'); };
  }, []);

  // warmUp() wakes the backend and database while the visitor is on Auth0's login page.
  // ui_locales asks Auth0's login screen to use the same language (if enabled in Auth0)
  const logIn = () => {
    warmUp();
    loginWithRedirect({ authorizationParams: { ui_locales: lang } });
  };
  const signUp = () => {
    warmUp();
    loginWithRedirect({ authorizationParams: { screen_hint: 'signup', ui_locales: lang } });
  };

  // Footer helpers. Text falls back to English until the keys are added to translations.js
  const tr = (key, fallback) => {
    const v = t(key);
    return v && v !== key ? v : fallback;
  };
  const behavior = () =>
    (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
  const goTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: behavior(), block: 'start' });
  };
  const toTop = () => window.scrollTo({ top: 0, behavior: behavior() });

  const buttons = (
    <div className="home-actions">
      <button type="button" className="home-btn" onClick={logIn} disabled={isLoading}>
        {t('btn.login')}
      </button>
      <button type="button" className="home-btn home-btn-ghost" onClick={signUp} disabled={isLoading}>
        {t('btn.create')}
      </button>
    </div>
  );

  return (
    <div className="home" ref={rootRef}>
      <Intro />
      <ScrollProgress />
      <header className={`home-header${scrolled ? ' is-scrolled' : ''}`}>
        <div className="home-brand">
          <span className="home-brand-mark" aria-hidden="true" />
          {APP_NAME}
        </div>
        <nav className="home-nav" aria-label="Account">
          <LanguageSwitcher />
          <button type="button" className="home-link" onClick={logIn} disabled={isLoading}>
            {t('nav.login')}
          </button>
          <button type="button" className="home-btn home-btn-small" onClick={signUp} disabled={isLoading}>
            {t('nav.signup')}
          </button>
        </nav>
      </header>

      <main>
        <GeofenceScene>
          <h1>{t('hero.title')}</h1>
          <p>{t('hero.text')}</p>
          {error && <p className="home-error" role="alert">{error.message}</p>}
          {buttons}
        </GeofenceScene>

        <EcgLine />

        <ShiftTour />

        <ProblemsSection />

        <section id="views" className="home-section">
          <h2>{t('views.title')}</h2>
          <p className="home-lead">{t('views.lead')}</p>
          <div className="home-grid-2">
            <div className="home-view">
              <h3>{t('views.workers.title')}</h3>
              <p>{t('views.workers.text')}</p>
              <div className="mini" role="img" aria-label={t('mini.workerAria')}>
                <div className="mini-top">
                  <strong>Priya Sharma</strong>
                  <span className="mini-pill is-in">{t('mini.clockedIn')}</span>
                </div>
                <div className="mini-row"><span>07:58 - 16:04</span><span>8:06</span></div>
                <div className="mini-row"><span>08:01 - 15:59</span><span>7:58</span></div>
                <div className="mini-btn">{t('shift.endTitle')}</div>
              </div>
            </div>
            <div className="home-view">
              <h3>{t('views.managers.title')}</h3>
              <p>{t('views.managers.text')}</p>
              <div className="mini" role="img" aria-label={t('mini.managerAria')}>
                <div className="mini-top"><strong>{t('mini.today')}</strong><span>{t('mini.onDuty')}</span></div>
                <div className="mini-row"><span>Priya Sharma</span><span className="mini-pill is-in">{t('mini.onShift')}</span></div>
                <div className="mini-row"><span>Rahul Mehta</span><span className="mini-pill is-late">{t('mini.late')}</span></div>
                <div className="mini-row"><span>Anita Rao</span><span className="mini-pill">{t('mini.left')}</span></div>
              </div>
            </div>
          </div>
          <p className="home-note">{t('views.note')}</p>
        </section>

        <section id="trust" className="home-section home-band">
          <h2>{t('trust.title')}</h2>
          <div className="home-grid-3">
            {TRUST.map((id, i) => (
              <div key={id} className="home-item reveal" style={{ '--i': i }}>
                <h3>{t(`${id}.title`)}</h3>
                <p>{t(`${id}.text`)}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="faq" className="home-section home-faq">
          <h2>{t('faq.title')}</h2>
          {FAQ.map((id, i) => (
            <details key={id} className="reveal" style={{ '--i': i }}>
              <summary>{t(`${id}.q`)}</summary>
              <p>{t(`${id}.a`)}</p>
            </details>
          ))}
        </section>

        <section className="home-cta">
          <h2>{t('cta.title')}</h2>
          {buttons}
        </section>
      </main>

      <footer className="site-footer">
        <div className="sf-grid">
          <div className="sf-brand-col">
            <div className="sf-brand">
              <span className="sf-mark" aria-hidden="true" />
              {APP_NAME}
            </div>
            <p className="sf-tag">{t('hero.title')}</p>
            <div className="sf-pills">
              {TRUST.map((id) => (
                <span key={id} className="sf-pill">{t(`${id}.title`)}</span>
              ))}
            </div>
          </div>

          <nav aria-label={tr('footer.explore', 'Explore')}>
            <h2 className="sf-title">{tr('footer.explore', 'Explore')}</h2>
            <ul className="sf-list">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <button type="button" className="sf-link" onClick={() => goTo(s.id)}>
                    {t(s.key)}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h2 className="sf-title">{tr('footer.start', 'Get started')}</h2>
            <ul className="sf-list">
              <li>
                <button type="button" className="sf-link" onClick={logIn} disabled={isLoading}>
                  {t('nav.login')}
                </button>
              </li>
              <li>
                <button type="button" className="sf-link" onClick={signUp} disabled={isLoading}>
                  {t('nav.signup')}
                </button>
              </li>
            </ul>
          </div>
        </div>

        <svg className="sf-ecg" viewBox="0 0 1200 40" preserveAspectRatio="none" aria-hidden="true">
          <path className="sf-base" d="M0 20 H380 L410 20 L430 6 L455 34 L480 1 L505 31 L525 20 H700 L720 20 L735 12 L750 20 H1200" />
          <path className="sf-pulse" pathLength="1" d="M0 20 H380 L410 20 L430 6 L455 34 L480 1 L505 31 L525 20 H700 L720 20 L735 12 L750 20 H1200" />
        </svg>

        <div className="sf-bottom">
          <span>&copy; {new Date().getFullYear()} {APP_NAME}</span>
          <span>{t('footer.location')}</span>
          <button type="button" className="sf-top" onClick={toTop} aria-label={tr('footer.top', 'Back to top')}>
            &uarr;
          </button>
        </div>
      </footer>
    </div>
  );
}