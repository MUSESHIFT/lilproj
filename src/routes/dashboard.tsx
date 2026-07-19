import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useCallback, useEffect } from "react";
import { getCurrentUser, logout } from "~/lib/auth";
import {
  getGmailConnection,
  disconnectGmail,
  fetchRecentEmails,
  getEmailCount,
} from "~/lib/gmail";
import { processInbox, getPipelineStats } from "~/lib/pipeline";
import { generateDigest } from "~/lib/digest";
import type { User } from "~/lib/auth";
import type { GmailConnection } from "~/lib/gmail";
import type { PipelineStats } from "~/lib/pipeline";
import type { DigestData } from "~/lib/digest";

export const Route = createFileRoute("/dashboard")({
  validateSearch: (
    params: Record<string, unknown>,
  ): { error?: string; connected?: string } => {
    return {
      error: typeof params.error === "string" ? params.error : undefined,
      connected:
        typeof params.connected === "string" ? params.connected : undefined,
    };
  },
  loader: async ({ search }) => {
    const { user } = await getCurrentUser();
    const gmailConnection = user ? await getGmailConnection() : { connected: false };
    const emailCount = user ? await getEmailCount() : { count: 0 };
    const pipelineStats = user ? await getPipelineStats() : null;
    return { user, gmail: gmailConnection, emailCount: emailCount.count, pipelineStats, search };
  },
  component: DashboardPage,
});

function DashboardPage() {
  const { user, gmail: initialGmail, emailCount: initialEmailCount, pipelineStats: initialPipelineStats, search } =
    Route.useLoaderData();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  const [gmail, setGmail] = useState<GmailConnection>(initialGmail);
  const [emailCount, setEmailCount] = useState(initialEmailCount);
  const [pipelineStats, setPipelineStats] = useState<PipelineStats | null>(initialPipelineStats);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchResult, setFetchResult] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  const [processResult, setProcessResult] = useState<string | null>(null);
  const [digest, setDigest] = useState<DigestData | null>(null);
  const [digesting, setDigesting] = useState(false);
  const [digestError, setDigestError] = useState<string | null>(null);

  // Show status messages based on search params
  useEffect(() => {
    if (search.connected === "gmail") {
      setStatusMessage("Gmail account connected successfully!");
    } else if (search.error) {
      const messages: Record<string, string> = {
        google_not_configured:
          "Google OAuth is not configured. Please set up your Google Cloud credentials.",
        google_auth_denied: "Gmail connection was cancelled.",
        google_auth_missing_code:
          "Authorization code was missing. Please try again.",
        google_auth_state_mismatch:
          "Security check failed. Please try connecting again.",
        google_token_exchange_failed:
          "Failed to complete Gmail authentication. Please try again.",
        google_profile_failed:
          "Could not fetch your Gmail profile. Please try again.",
        google_unknown_error:
          "An unexpected error occurred. Please try again.",
      };
      setStatusMessage(
        messages[search.error] ??
          `Error: ${search.error}. Please try again.`,
      );
    }
  }, [search]);

  // Redirect if not logged in
  if (!user) {
    navigate({ to: "/login", replace: true });
    return null;
  }

  const u = user as User;

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      navigate({ to: "/", replace: true });
    } catch {
      setLoggingOut(false);
    }
  };

  const handleFetchEmails = useCallback(async () => {
    setFetching(true);
    setFetchError(null);
    setFetchResult(null);
    try {
      const result = await fetchRecentEmails();
      if (result.error) {
        setFetchError(result.error);
      } else {
        setFetchResult(
          result.count > 0
            ? `Fetched ${result.count} new email${result.count !== 1 ? "s" : ""}!`
            : "No new emails found in the last 7 days.",
        );
        setEmailCount((prev) => prev + result.count);
      }
    } catch (err) {
      setFetchError(
        err instanceof Error ? err.message : "Failed to fetch emails",
      );
    } finally {
      setFetching(false);
    }
  }, []);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnectGmail();
      setGmail({ connected: false });
      setEmailCount(0);
      setStatusMessage("Gmail account disconnected.");
    } catch {
      setStatusMessage("Failed to disconnect Gmail. Please try again.");
    } finally {
      setDisconnecting(false);
    }
  };

  const handleConnectGmail = () => {
    // Navigate to the OAuth initiation route
    window.location.href = "/api/auth/google";
  };

  const handleProcessInbox = useCallback(async () => {
    setProcessing(true);
    setProcessError(null);
    setProcessResult(null);
    try {
      const result = await processInbox();
      if (!result.success || result.error) {
        setProcessError(result.error || "Processing failed");
      } else {
        // Build result message
        const parts: string[] = [];
        if (result.classified > 0) {
          parts.push(`${result.classified} emails classified`);
        }
        const details: string[] = [];
        if (result.invoices > 0) details.push(`${result.invoices} invoices`);
        if (result.paymentsReceived > 0) details.push(`${result.paymentsReceived} payments received`);
        if (result.billsSent > 0) details.push(`${result.billsSent} bills sent`);
        if (result.paymentsMade > 0) details.push(`${result.paymentsMade} payments made`);
        if (details.length > 0) {
          parts.push(`Found: ${details.join(", ")}`);
        }
        if (result.discrepancies.length > 0) {
          parts.push(`${result.discrepancies.length} discrepancies flagged`);
        } else if (result.classified > 0) {
          parts.push("No discrepancies found");
        }
        setProcessResult(parts.join(" • ") || "No new emails to process.");
        // Refresh stats
        const stats = await getPipelineStats();
        setPipelineStats(stats);
      }
    } catch (err) {
      setProcessError(
        err instanceof Error ? err.message : "Failed to process inbox",
      );
    } finally {
      setProcessing(false);
    }
  }, []);

  const handleGenerateDigest = useCallback(async () => {
    setDigesting(true);
    setDigestError(null);
    setDigest(null);
    try {
      const result = await generateDigest();
      if ("error" in result) {
        setDigestError(result.error);
      } else {
        setDigest(result);
      }
    } catch (err) {
      setDigestError(
        err instanceof Error ? err.message : "Failed to generate digest",
      );
    } finally {
      setDigesting(false);
    }
  }, []);

  return (
    <div className="min-h-dvh bg-gray-50">
      {/* Nav */}
      <nav className="border-b border-gray-100 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
              IS
            </span>
            <span className="text-lg font-semibold tracking-tight text-gray-900">
              InvoiceSleuth
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">{u.email}</span>
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
            >
              {loggingOut ? "Logging out..." : "Logout"}
            </button>
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        {/* Status message banner */}
        {statusMessage && (
          <div className="mb-6">
            <div
              className={`rounded-xl border p-4 ${
                search.error
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-green-200 bg-green-50 text-green-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{statusMessage}</p>
                <button
                  onClick={() => setStatusMessage(null)}
                  className="ml-4 text-sm opacity-70 hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome, {u.email}
          </h1>
          <p className="mt-2 text-gray-500">
            {!gmail.connected
              ? "Connect your Gmail inbox to get started."
              : pipelineStats && pipelineStats.totalEmails === 0
                ? "Fetch your emails to start detecting invoices."
                : pipelineStats && pipelineStats.processedEmails > 0
                  ? "Here's your financial overview."
                  : "Process your inbox to find invoices and payments."}
          </p>

          {/* Gmail Connection Card */}
          <div className="mt-8">
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                      gmail.connected
                        ? "bg-green-100 text-green-600"
                        : "bg-gray-200 text-gray-400"
                    }`}
                  >
                    <svg
                      className="h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
                      />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      {gmail.connected
                        ? "Gmail Connected"
                        : "Connect Your Inbox"}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {gmail.connected
                        ? `Connected as ${gmail.gmailEmail}`
                        : "Link your Gmail to start detecting invoices automatically."}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {gmail.connected ? (
                    <>
                      {/* Email count badge */}
                      {emailCount > 0 && (
                        <span className="inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
                          {emailCount} email{emailCount !== 1 ? "s" : ""} fetched
                        </span>
                      )}

                      {/* Fetch Emails button */}
                      <button
                        onClick={handleFetchEmails}
                        disabled={fetching}
                        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {fetching ? "Fetching..." : "Fetch Emails"}
                      </button>

                      {/* Process Invoices button */}
                      <button
                        onClick={handleProcessInbox}
                        disabled={processing}
                        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {processing ? "Processing..." : "Process Invoices"}
                      </button>

                      {/* Disconnect button */}
                      <button
                        onClick={handleDisconnect}
                        disabled={disconnecting}
                        className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                      >
                        {disconnecting ? "..." : "Disconnect"}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={handleConnectGmail}
                      className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700"
                    >
                      Connect Gmail
                    </button>
                  )}
                </div>
              </div>

              {/* Fetch result / error messages */}
              {fetchError && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-sm text-red-700">{fetchError}</p>
                </div>
              )}
              {fetchResult && (
                <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3">
                  <p className="text-sm text-green-700">{fetchResult}</p>
                </div>
              )}
              {processError && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
                  <p className="text-sm text-red-700">{processError}</p>
                </div>
              )}
              {processResult && (
                <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3">
                  <p className="text-sm text-green-700">{processResult}</p>
                </div>
              )}
            </div>
          </div>

          {/* Pipeline Stats & Discrepancies */}
          {pipelineStats && pipelineStats.processedEmails > 0 ? (
            <div className="mt-6 space-y-6">
              {/* Stats cards */}
              <div className="grid gap-6 sm:grid-cols-3">
                <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                  </div>
                  <h3 className="mt-4 text-2xl font-bold text-gray-900">{pipelineStats.invoicesFound}</h3>
                  <p className="mt-1 text-sm text-gray-500">Invoices found</p>
                </div>

                <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 text-green-600">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3 className="mt-4 text-2xl font-bold text-gray-900">{pipelineStats.paymentsMatched}</h3>
                  <p className="mt-1 text-sm text-gray-500">Payments matched</p>
                </div>

                <div className={`rounded-xl border shadow-sm p-6 ${pipelineStats.discrepanciesCount > 0 ? "border-red-200 bg-red-50" : "border-gray-100 bg-white"}`}>
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${pipelineStats.discrepanciesCount > 0 ? "bg-red-100 text-red-600" : "bg-gray-100 text-gray-400"}`}>
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                  </div>
                  <h3 className="mt-4 text-2xl font-bold text-gray-900">{pipelineStats.discrepanciesCount}</h3>
                  <p className="mt-1 text-sm text-gray-500">Discrepancies flagged</p>
                </div>
              </div>

              {/* Discrepancies list */}
              {pipelineStats.discrepancies.length > 0 && (
                <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
                  <div className="border-b border-gray-100 px-6 py-4">
                    <h3 className="font-semibold text-gray-900">Discrepancies</h3>
                    <p className="mt-0.5 text-sm text-gray-500">Issues that need your attention</p>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {pipelineStats.discrepancies.map((d, i) => {
                      const typeStyles: Record<string, { bg: string; text: string; label: string }> = {
                        underpayment: { bg: "bg-amber-100", text: "text-amber-700", label: "Underpayment" },
                        overpayment: { bg: "bg-blue-100", text: "text-blue-700", label: "Overpayment" },
                        missing_payment: { bg: "bg-red-100", text: "text-red-700", label: "Missing Payment" },
                        overdue: { bg: "bg-red-200", text: "text-red-800", label: "Overdue" },
                      };
                      const style = typeStyles[d.type] || { bg: "bg-gray-100", text: "text-gray-700", label: d.type };
                      return (
                        <div key={i} className="px-6 py-4">
                          <div className="flex items-start gap-3">
                            <span className={`mt-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}>
                              {style.label}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-gray-700">{d.description}</p>
                              {d.amountDiff !== null && (
                                <p className="mt-1 text-xs text-gray-400">
                                  Amount difference: ${d.amountDiff.toFixed(2)}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Weekly Digest Section */}
            <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-6 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">Weekly Digest</h3>
                    <p className="mt-0.5 text-sm text-gray-500">
                      Auto-generated finance summary from your pipeline data
                    </p>
                  </div>
                  <button
                    onClick={handleGenerateDigest}
                    disabled={digesting}
                    className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {digesting ? "Generating..." : "Generate Digest"}
                  </button>
                </div>
              </div>

              {/* Digest error */}
              {digestError && (
                <div className="border-b border-red-100 bg-red-50 px-6 py-3">
                  <p className="text-sm text-red-700">{digestError}</p>
                </div>
              )}

              {/* Digest output */}
              {digest && (
                <div className="divide-y divide-gray-50">
                  {/* Date range badge */}
                  <div className="px-6 py-3">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                      </svg>
                      {digest.dateRange.start} → {digest.dateRange.end}
                    </span>
                  </div>

                  {/* Summary cards */}
                  <div className="grid grid-cols-2 gap-4 px-6 py-4 sm:grid-cols-4">
                    <div>
                      <p className="text-xs text-gray-500">Invoiced</p>
                      <p className="mt-0.5 text-lg font-bold text-gray-900">
                        {digest.summary.currency} {digest.summary.totalInvoiced.toFixed(2)}
                      </p>
                      <p className="text-xs text-gray-400">{digest.summary.invoiceCount} invoice{digest.summary.invoiceCount !== 1 ? "s" : ""}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Paid</p>
                      <p className="mt-0.5 text-lg font-bold text-green-600">
                        {digest.summary.currency} {digest.summary.totalPaid.toFixed(2)}
                      </p>
                      <p className="text-xs text-gray-400">{digest.summary.paymentCount} payment{digest.summary.paymentCount !== 1 ? "s" : ""}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Outstanding</p>
                      <p className={`mt-0.5 text-lg font-bold ${digest.summary.outstandingBalance > 0 ? "text-red-600" : "text-green-600"}`}>
                        {digest.summary.currency} {digest.summary.outstandingBalance.toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Discrepancies</p>
                      <p className={`mt-0.5 text-lg font-bold ${digest.summary.discrepancyCount > 0 ? "text-red-600" : "text-gray-900"}`}>
                        {digest.summary.discrepancyCount}
                      </p>
                    </div>
                  </div>

                  {/* Invoices list */}
                  {digest.invoices.length > 0 && (
                    <div className="px-6 py-4">
                      <h4 className="text-sm font-semibold text-gray-700">Recent Invoices</h4>
                      <div className="mt-2 space-y-2">
                        {digest.invoices.map((inv, i) => (
                          <div key={i} className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {inv.sender || "Unknown"}
                                {inv.invoiceNumber && (
                                  <span className="ml-1.5 text-xs text-gray-400">#{inv.invoiceNumber}</span>
                                )}
                              </p>
                              <p className="text-xs text-gray-500 truncate">{inv.subject}</p>
                            </div>
                            <span className="ml-3 shrink-0 text-sm font-semibold text-gray-900">
                              {inv.currency || digest.summary.currency} {inv.amount?.toFixed(2) ?? "—"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Payments list */}
                  {digest.payments.length > 0 && (
                    <div className="px-6 py-4">
                      <h4 className="text-sm font-semibold text-gray-700">Recent Payments</h4>
                      <div className="mt-2 space-y-2">
                        {digest.payments.map((pay, i) => (
                          <div key={i} className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-900 truncate">{pay.sender || "Unknown"}</p>
                              <p className="text-xs text-gray-500 truncate">{pay.subject}</p>
                            </div>
                            <span className="ml-3 shrink-0 text-sm font-semibold text-green-600">
                              {pay.currency || digest.summary.currency} {pay.amount?.toFixed(2) ?? "—"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Discrepancies in digest */}
                  {digest.discrepancies.length > 0 && (
                    <div className="px-6 py-4">
                      <h4 className="text-sm font-semibold text-red-600">Discrepancies</h4>
                      <div className="mt-2 space-y-2">
                        {digest.discrepancies.map((d, i) => {
                          const typeStyles: Record<string, { bg: string; text: string; label: string }> = {
                            underpayment: { bg: "bg-amber-100", text: "text-amber-700", label: "Underpayment" },
                            overpayment: { bg: "bg-blue-100", text: "text-blue-700", label: "Overpayment" },
                            missing_payment: { bg: "bg-red-100", text: "text-red-700", label: "Missing" },
                            overdue: { bg: "bg-red-200", text: "text-red-800", label: "Overdue" },
                          };
                          const style = typeStyles[d.type] || { bg: "bg-gray-100", text: "text-gray-700", label: d.type };
                          return (
                            <div key={i} className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
                              <span className={`mt-0.5 shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}>
                                {style.label}
                              </span>
                              <div>
                                <p className="text-sm text-gray-700">{d.description}</p>
                                {d.amountDiff !== null && (
                                  <p className="mt-0.5 text-xs text-gray-400">
                                    Difference: {digest.summary.currency} {d.amountDiff.toFixed(2)}
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Empty state */}
                  {digest.invoices.length === 0 && digest.payments.length === 0 && (
                    <div className="px-6 py-8 text-center">
                      <p className="text-sm text-gray-400">No invoices or payments found in the last 7 days.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          ) : pipelineStats && pipelineStats.totalEmails > 0 ? (
            <div className="mt-6 grid gap-6 sm:grid-cols-3">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                </div>
                <h3 className="mt-4 font-semibold text-gray-900">Invoices</h3>
                <p className="mt-1 text-sm text-gray-500">
                  {pipelineStats.unprocessedEmails > 0
                    ? `${pipelineStats.unprocessedEmails} emails waiting to be processed. Click "Process Invoices" above.`
                    : "View and manage all detected invoices in one place."}
                </p>
              </div>

              <div className="rounded-xl border border-gray-100 bg-gray-50 p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                  </svg>
                </div>
                <h3 className="mt-4 font-semibold text-gray-900">Weekly Digest</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Your finance summary delivered every week via email.
                </p>
              </div>

              <div className="rounded-xl border border-gray-100 bg-gray-50 p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </div>
                <h3 className="mt-4 font-semibold text-gray-900">Alerts</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Underpayments and discrepancies flagged automatically.
                </p>
              </div>
            </div>
          ) : (
            <div className="mt-6 grid gap-6 sm:grid-cols-3">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                </div>
                <h3 className="mt-4 font-semibold text-gray-900">Invoices</h3>
                <p className="mt-1 text-sm text-gray-500">
                  View and manage all detected invoices in one place.
                </p>
              </div>

              <div className="rounded-xl border border-gray-100 bg-gray-50 p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                  </svg>
                </div>
                <h3 className="mt-4 font-semibold text-gray-900">Weekly Digest</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Your finance summary delivered every week via email.
                </p>
              </div>

              <div className="rounded-xl border border-gray-100 bg-gray-50 p-6">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </div>
                <h3 className="mt-4 font-semibold text-gray-900">Alerts</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Underpayments and discrepancies flagged automatically.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
