/**
 * BhoomiIQ — Language Context
 * Provides lang + setLang + t() helper to all components.
 * Language preference is persisted to localStorage.
 */
import React, { createContext, useContext, useState, useCallback } from 'react';
import { translations, t as _t } from './i18n';

const LangContext = createContext(null);

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try {
      return localStorage.getItem('bhoomiq_lang') || 'en';
    } catch {
      return 'en';
    }
  });

  const setLang = useCallback((l) => {
    setLangState(l);
    try { localStorage.setItem('bhoomiq_lang', l); } catch {}
  }, []);

  /** Translate a key using the current language */
  const t = useCallback((key) => _t(lang, key), [lang]);

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  );
}

/** Hook: const { lang, setLang, t } = useLang(); */
export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be inside LangProvider');
  return ctx;
}
