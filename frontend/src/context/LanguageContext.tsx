import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Language = 'en' | 'hi';

const STORAGE_KEY = 'khaao_shop_lang';

interface LanguageContextValue {
  language: Language;
  toggleLanguage: () => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

/**
 * Shopkeeper-only UI language (English/Hindi). Mounted in Layout so it
 * covers every shop page + shared shop components. Student pages never read
 * this — they're English-only by design regardless of what's stored here.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() =>
    localStorage.getItem(STORAGE_KEY) === 'hi' ? 'hi' : 'en',
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, language);
  }, [language]);

  function toggleLanguage() {
    setLanguage((prev) => (prev === 'en' ? 'hi' : 'en'));
  }

  return <LanguageContext.Provider value={{ language, toggleLanguage }}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
