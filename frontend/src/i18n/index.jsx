import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import en from "./en.js";
import pt from "./pt.js";

const STORAGE_KEY = "promptera.locale";
const catalogs = { en, pt };

export const LOCALES = [
  { id: "en", labelKey: "lang.en" },
  { id: "pt", labelKey: "lang.pt" },
];

function readStoredLocale() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "en" || v === "pt") return v;
  } catch {}
  return "en";
}

function getByPath(obj, path) {
  return String(path)
    .split(".")
    .reduce((acc, key) => (acc && acc[key] != null ? acc[key] : null), obj);
}

function format(str, vars) {
  if (!vars) return str;
  return String(str).replace(/\{(\w+)\}/g, (_, k) =>
    vars[k] != null ? String(vars[k]) : `{${k}}`
  );
}

const LocaleContext = createContext(null);

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(readStoredLocale);

  const setLocale = useCallback((next) => {
    const id = next === "pt" ? "pt" : "en";
    setLocaleState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {}
    try {
      document.documentElement.lang = id === "pt" ? "pt-BR" : "en";
    } catch {}
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "pt" ? "pt-BR" : "en";
  }, [locale]);

  const t = useCallback(
    (key, vars) => {
      const cat = catalogs[locale] || en;
      const raw = getByPath(cat, key) ?? getByPath(en, key) ?? key;
      return format(raw, vars);
    },
    [locale]
  );

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t,
      dateLocale: locale === "pt" ? "pt-BR" : "en-US",
    }),
    [locale, setLocale, t]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    return {
      locale: "en",
      setLocale: () => {},
      t: (key, vars) => format(getByPath(en, key) ?? key, vars),
      dateLocale: "en-US",
    };
  }
  return ctx;
}

export function useT() {
  return useLocale().t;
}
