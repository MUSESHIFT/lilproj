import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { readFile } from "node:fs/promises";
import { getCurrentUser, logout } from "~/lib/auth";
import { useState } from "react";

const getBusinessName = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const cfg = JSON.parse(await readFile("site.json", "utf8")) as {
      businessName?: string;
    };
    return cfg.businessName?.trim() ?? "thawline";
  } catch {
    return "thawline";
  }
});

export const Route = createFileRoute("/")({
  loader: async () => {
    const businessName = await getBusinessName();
    const { user } = await getCurrentUser();
    return { businessName, user };
  },
  component: Home,
});

/* ------------------------------------------------------------------ */
/*  Section components                                                 */
/* ------------------------------------------------------------------ */

function Nav({ user }: { user: { email: string } | null }) {
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    await logout();
    window.location.reload();
  };

  return (
    <nav className="fixed inset-x-0 top-0 z-50 border-b border-gray-100 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <a href="/" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
            tl
          </span>
          <span className="text-lg font-semibold tracking-tight text-gray-900">
            thawline
          </span>
        </a>
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <Link
                to="/dashboard"
                className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition hover:text-gray-900"
              >
                Dashboard
              </Link>
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
              >
                {loggingOut ? "..." : "Logout"}
              </button>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition hover:text-gray-900"
              >
                Login
              </Link>
              <Link
                to="/signup"
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700"
              >
                Sign Up
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden pt-32 pb-20 sm:pt-40 sm:pb-28">
      {/* Subtle background decoration */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 right-0 h-[500px] w-[500px] rounded-full bg-indigo-50 blur-3xl" />
        <div className="absolute -bottom-32 left-0 h-[400px] w-[400px] rounded-full bg-violet-50 blur-3xl" />
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          {/* Badge */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-sm font-medium text-indigo-700">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
            </span>
            AI-powered invoice tracking
          </div>

          <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
            Know exactly what
            <br />
            <span className="text-indigo-600">you&apos;re owed</span>
          </h1>

          <p className="mt-6 text-lg leading-relaxed text-gray-600 sm:text-xl">
            thawline connects to your email inbox, automatically finds every invoice and
            payment, cross-checks them for discrepancies, and sends you a simple weekly
            digest. No spreadsheets, no data entry, no missed payments.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <a
              href="#pricing"
              className="inline-flex w-full items-center justify-center rounded-xl bg-indigo-600 px-8 py-3.5 text-base font-semibold text-white shadow-md transition hover:bg-indigo-700 hover:shadow-lg sm:w-auto"
            >
              Start free trial
              <svg className="ml-2 h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </a>
            <a
              href="#how-it-works"
              className="inline-flex w-full items-center justify-center rounded-xl border border-gray-200 bg-white px-8 py-3.5 text-base font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50 sm:w-auto"
            >
              See how it works
            </a>
          </div>

          <p className="mt-4 text-sm text-gray-400">No credit card required · 14-day free trial</p>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      step: "1",
      title: "Connect your inbox",
      description:
        "Link your Gmail account with one click. thawline works in the background — no setup, no folder rules, no manual tagging.",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
        </svg>
      ),
    },
    {
      step: "2",
      title: "Auto-detect invoices & payments",
      description:
        "Our AI scans your inbox for invoices, bills, and payment confirmations. It extracts amounts, dates, and vendors automatically.",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
        </svg>
      ),
    },
    {
      step: "3",
      title: "Get your weekly digest",
      description:
        "Every week, receive a clear summary: what was invoiced, what was paid, and any discrepancies that need your attention.",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      ),
    },
  ];

  return (
    <section id="how-it-works" className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            How it works
          </h2>
          <p className="mt-4 text-lg text-gray-600">
            Three steps to reclaim your financial peace of mind.
          </p>
        </div>

        <div className="mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((s) => (
            <div
              key={s.step}
              className="group relative rounded-2xl border border-gray-100 bg-white p-8 shadow-sm transition hover:shadow-md"
            >
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 group-hover:bg-indigo-100 transition">
                {s.icon}
              </div>
              <div className="absolute right-6 top-6 text-4xl font-bold text-gray-100 group-hover:text-indigo-50 transition">
                {s.step}
              </div>
              <h3 className="text-lg font-semibold text-gray-900">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{s.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Features() {
  const features = [
    {
      title: "Invoice detection",
      description:
        "Our AI identifies invoices from any sender — PDFs, embedded links, plain-text emails. No templates or rules needed.",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      ),
    },
    {
      title: "Payment cross-checking",
      description:
        "Every payment confirmation is matched against its original invoice. We verify amounts, dates, and payers so you don't have to.",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
        </svg>
      ),
    },
    {
      title: "Discrepancy flags",
      description:
        "Underpayments, overdue invoices, amounts that don't match the quote — flagged automatically so nothing slips through.",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      ),
    },
    {
      title: "Weekly finance digest",
      description:
        "One email, every week, with everything you need to know: invoices sent, payments received, and items that need attention.",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
      ),
    },
    {
      title: "Zero data entry",
      description:
        "No forms, no uploads, no spreadsheets. thawline works entirely from your inbox — the data is already there.",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
        </svg>
      ),
    },
    {
      title: "Privacy-first",
      description:
        "Your email is processed securely and never stored. We only extract invoice data — your personal emails stay private.",
      icon: (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
      ),
    },
  ];

  return (
    <section className="bg-gray-50 py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Everything you need to stay on top
          </h2>
          <p className="mt-4 text-lg text-gray-600">
            Built for freelancers who&apos;d rather do the work than track the money.
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm transition hover:shadow-md"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
                {f.icon}
              </div>
              <h3 className="font-semibold text-gray-900">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  const tiers = [
    {
      name: "Individual",
      price: "$19",
      period: "/month",
      description: "Perfect for solo freelancers managing their own books.",
      features: [
        "1 connected inbox",
        "Unlimited invoice detection",
        "Payment cross-checking",
        "Weekly finance digest",
        "Discrepancy alerts",
        "Email support",
      ],
      cta: "Start free trial",
      highlighted: false,
    },
    {
      name: "Team",
      price: "$49",
      period: "/month",
      description: "For micro-agencies with multiple freelancers.",
      features: [
        "Up to 5 connected inboxes",
        "Everything in Individual",
        "Team-wide dashboard",
        "Consolidated weekly digest",
        "Priority support",
      ],
      cta: "Start free trial",
      highlighted: true,
    },
  ];

  return (
    <section id="pricing" className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            Simple, transparent pricing
          </h2>
          <p className="mt-4 text-lg text-gray-600">
            14-day free trial on every plan. No credit card required.
          </p>
        </div>

        <div className="mt-16 grid gap-8 lg:grid-cols-2 lg:max-w-4xl lg:mx-auto">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`relative rounded-2xl border p-8 shadow-sm transition hover:shadow-md ${
                tier.highlighted
                  ? "border-indigo-600 bg-white ring-1 ring-indigo-600"
                  : "border-gray-200 bg-white"
              }`}
            >
              {tier.highlighted && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-4 py-1 text-xs font-semibold text-white">
                  Most popular
                </span>
              )}
              <h3 className="text-xl font-semibold text-gray-900">{tier.name}</h3>
              <p className="mt-1 text-sm text-gray-500">{tier.description}</p>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-4xl font-bold tracking-tight text-gray-900">
                  {tier.price}
                </span>
                <span className="text-gray-500">{tier.period}</span>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                ${{ Individual: "15", Team: "39" }[tier.name]}/mo with annual billing (20% off)
              </p>
              <ul className="mt-8 space-y-3">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-gray-600">
                    <svg
                      className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-500"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              <a
                href="#"
                className={`mt-8 block rounded-xl px-6 py-3 text-center text-sm font-semibold transition ${
                  tier.highlighted
                    ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm"
                    : "bg-gray-900 text-white hover:bg-gray-800 shadow-sm"
                }`}
              >
                {tier.cta}
              </a>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-gray-400">
          All prices in USD. Cancel anytime. Annual billing saves 20%.
        </p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-gray-100 bg-white py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
              tl
            </span>
            <span className="text-sm font-semibold text-gray-900">thawline</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-gray-500">
            <a href="#" className="transition hover:text-gray-700">
              Privacy
            </a>
            <a href="#" className="transition hover:text-gray-700">
              Terms
            </a>
            <a href="#" className="transition hover:text-gray-700">
              Contact
            </a>
          </div>
          <p className="text-sm text-gray-400">
            &copy; {new Date().getFullYear()} thawline. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/*  Home page                                                          */
/* ------------------------------------------------------------------ */

function Home() {
  const { user } = Route.useLoaderData();

  return (
    <div className="min-h-dvh bg-white">
      <Nav user={user as { email: string } | null} />
      <Hero />
      <HowItWorks />
      <Features />
      <Pricing />
      <Footer />
    </div>
  );
}
