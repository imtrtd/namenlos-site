import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { SiteShell } from "@/components/site-shell";
import { useI18n } from "@/lib/i18n";
import { FLASH } from "@/lib/catalog";
import { submitBooking, buildTelegramText, type BookingInput } from "@/lib/booking";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/utils";
import { useTelegramWebApp } from "@/lib/telegram-webapp";

type Search = {
  type?: "org" | "private";
  design?: string;
  ref?: string;
  event?: string;
};

export const Route = createFileRoute("/book")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    type: s.type === "org" ? "org" : s.type === "private" ? "private" : undefined,
    design: typeof s.design === "string" ? s.design : undefined,
    ref: typeof s.ref === "string" ? s.ref : undefined,
    event: typeof s.event === "string" ? s.event : undefined,
  }),
  component: Book,
});

function Book() {
  const { t, lang } = useI18n();
  const { isMini, displayName, handle, close } = useTelegramWebApp();
  const search = Route.useSearch();
  const flash = FLASH.find((d) => d.id === search.design);
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState<"private" | "org">(search.type === "org" ? "org" : "private");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    contact: "",
    instagram: "",
    placement: "",
    size: "",
    idea: flash
      ? `${flash.title} · ${flash.style} · ${flash.price}`
      : search.ref
        ? `Similar to ${search.ref}`
        : search.event
          ? "Blackout Yard walk-in / slot"
          : "",
    date: "",
    time: "",
    budget: "",
    orgName: "",
    orgFormat: "",
    people: "",
    city: "",
    terms: false,
    privacy: false,
    health: false,
    hp: "",
  });

  useEffect(() => {
    if (!displayName && !handle) return;
    setForm((f) => ({
      ...f,
      name: f.name || displayName,
      contact: f.contact || handle,
    }));
  }, [displayName, handle]);

  const whenLabel = useMemo(() => {
    if (!form.date) return "";
    return form.time ? `${form.date} ${form.time}` : form.date;
  }, [form.date, form.time]);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function send() {
    const contact = form.contact.trim() || form.instagram.trim();
    if (!form.name.trim() || !contact) {
      toast.error(t("book.err"));
      return;
    }
    if (!form.terms || !form.privacy) {
      toast.error(t("book.consent.terms"));
      return;
    }
    setSending(true);
    const payload: BookingInput = {
      kind,
      name: form.name.trim(),
      contact,
      instagram: form.instagram.trim(),
      email: "",
      placement: form.placement,
      size: form.size,
      styles: flash?.style ?? "",
      idea: form.idea,
      city: form.city,
      whenLabel,
      budget: form.budget,
      orgName: form.orgName,
      orgFormat: form.orgFormat,
      sessionFormat: "",
      people: form.people,
      flashId: flash?.id ?? "",
      lang,
      hp: form.hp,
    };
    try {
      await submitBooking({ data: payload });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg && !msg.includes("{") && !msg.includes("too_small")) {
        toast.error(msg);
      } else {
        toast.error(t("book.err"));
      }
    } finally {
      setDone(buildTelegramText(payload));
      setSending(false);
    }
  }

  const igHref = done ? SITE.igDm : null;

  function openDirect() {
    if (done && typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(done).catch(() => {});
    }
  }

  return (
    <SiteShell>
      <main className="mx-auto w-full max-w-lg flex-1 px-5 py-10">
        <h1 className="font-display text-5xl uppercase">{t("book.h")}</h1>
        <p className="mt-2 text-sm text-muted">{t("book.lead")}</p>
        {flash ? (
          <p className="card mt-3 px-3 py-2 text-sm text-yellow">
            {flash.title} · {flash.price}
          </p>
        ) : null}

        {done && igHref ? (
          <div className="panel mt-8 p-6">
            <h2 className="font-display text-2xl uppercase text-yellow">{t("book.ok")}</h2>
            <a
              href={igHref}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-block mt-5"
              onClick={openDirect}
            >
              {t("book.tg")}
            </a>
            {isMini ? (
              <button type="button" className="btn btn-outline btn-sm btn-block mt-3" onClick={close}>
                Close
              </button>
            ) : (
              <Link to="/" className="btn btn-outline btn-sm btn-block mt-3">
                {t("nav.site")}
              </Link>
            )}
          </div>
        ) : (
          <form
            className="mt-8"
            onSubmit={(e) => {
              e.preventDefault();
              if (step < 3) setStep(step + 1);
              else void send();
            }}
          >
            <div className="mb-6 flex gap-2">
              {[1, 2, 3].map((n) => (
                <span
                  key={n}
                  className={cn(
                    "h-1.5 flex-1",
                    n <= step ? "bg-yellow" : "bg-fg/15",
                  )}
                />
              ))}
            </div>
            <p className="mb-4 text-xs uppercase tracking-[0.16em] text-yellow">
              {t(`book.step${step}` as "book.step1")}
            </p>

            {step === 1 ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setKind("private")}
                    className={cn(
                      "h-16 border-2 text-xs font-bold uppercase tracking-[0.1em]",
                      kind === "private"
                        ? "border-yellow bg-yellow text-ink"
                        : "border-yellow/40 text-fg",
                    )}
                  >
                    {t("book.private")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setKind("org")}
                    className={cn(
                      "h-16 border-2 text-xs font-bold uppercase tracking-[0.1em]",
                      kind === "org"
                        ? "border-yellow bg-yellow text-ink"
                        : "border-yellow/40 text-fg",
                    )}
                  >
                    {t("book.org")}
                  </button>
                </div>
                <Field label={t("book.name")} value={form.name} onChange={(v) => set("name", v)} required />
                <Field label={t("book.contact")} value={form.contact} onChange={(v) => set("contact", v)} />
                <Field label={t("book.ig")} value={form.instagram} onChange={(v) => set("instagram", v)} />
                <input
                  className="hidden"
                  tabIndex={-1}
                  autoComplete="off"
                  value={form.hp}
                  onChange={(e) => set("hp", e.target.value)}
                  aria-hidden
                />
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-4">
                {kind === "private" ? (
                  <>
                    <Field label={t("book.place")} value={form.placement} onChange={(v) => set("placement", v)} />
                    <Field label={t("book.size")} value={form.size} onChange={(v) => set("size", v)} />
                    <Area label={t("book.idea")} value={form.idea} onChange={(v) => set("idea", v)} />
                  </>
                ) : (
                  <>
                    <Field label="Org" value={form.orgName} onChange={(v) => set("orgName", v)} />
                    <Field label="Format" value={form.orgFormat} onChange={(v) => set("orgFormat", v)} />
                    <Field label="City" value={form.city} onChange={(v) => set("city", v)} />
                    <Area label={t("book.idea")} value={form.idea} onChange={(v) => set("idea", v)} />
                  </>
                )}
              </div>
            ) : null}

            {step === 3 ? (
              <div className="space-y-4">
                <label className="block">
                  <span className="field-label">
                    {t("book.date")}
                  </span>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => set("date", e.target.value)}
                    className="field-input"
                  />
                </label>
                <label className="block">
                  <span className="field-label">
                    {t("book.time")}
                  </span>
                  <input
                    type="time"
                    value={form.time}
                    onChange={(e) => set("time", e.target.value)}
                    className="field-input"
                  />
                </label>
                <label className="block">
                  <span className="field-label">
                    {t("book.budget")}
                  </span>
                  <select
                    value={form.budget}
                    onChange={(e) => set("budget", e.target.value)}
                    className="field-input"
                  >
                    <option value="">—</option>
                    <option>70–150€</option>
                    <option>150–300€</option>
                    <option>300–500€</option>
                    <option>500€+</option>
                  </select>
                </label>
                <label className="flex items-start gap-2 text-sm text-muted">
                  <input
                    type="checkbox"
                    className="mt-1 accent-yellow"
                    checked={form.health}
                    onChange={(e) => set("health", e.target.checked)}
                  />
                  {t("book.consent.health")}
                </label>
                <label className="flex items-start gap-2 text-sm text-muted">
                  <input
                    type="checkbox"
                    required
                    className="mt-1 accent-yellow"
                    checked={form.terms}
                    onChange={(e) => set("terms", e.target.checked)}
                  />
                  <span>
                    {t("book.consent.terms")}{" "}
                    <Link to="/terms" className="text-yellow">
                      {t("footer.terms")}
                    </Link>
                  </span>
                </label>
                <label className="flex items-start gap-2 text-sm text-muted">
                  <input
                    type="checkbox"
                    required
                    className="mt-1 accent-yellow"
                    checked={form.privacy}
                    onChange={(e) => set("privacy", e.target.checked)}
                  />
                  <span>
                    {t("book.consent.privacy")}{" "}
                    <Link to="/privacy" className="text-yellow">
                      {t("footer.privacy")}
                    </Link>
                  </span>
                </label>
              </div>
            ) : null}

            <div className="mt-8 flex gap-3">
              {step > 1 ? (
                <button
                  type="button"
                  onClick={() => setStep(step - 1)}
                  className="btn btn-outline flex-1"
                >
                  {t("book.back")}
                </button>
              ) : null}
              <button
                type="submit"
                disabled={sending}
                className="btn btn-primary flex-1"
              >
                {step < 3 ? t("book.next") : sending ? "…" : t("book.send")}
              </button>
            </div>
          </form>
        )}
      </main>
    </SiteShell>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="field-label">
        {label}
      </span>
      <input
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="field-input"
      />
    </label>
  );
}

function Area({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="field-label">
        {label}
      </span>
      <textarea
        rows={5}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="field-input"
      />
    </label>
  );
}
