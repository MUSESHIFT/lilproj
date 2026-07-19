import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useCallback, useEffect } from "react";
import { getCurrentUser, logout } from "~/lib/auth";
import {
  getGmailConnection,
  disconnectGmail,
  fetchRecentEmails,
  getEmailCount,
} from "~/lib/gmail";
import type { User } from "~/lib/auth";
import type { GmailConnection } from "~/lib/gmail";

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
    return { user, gmail: gmailConnection, emailCount: emailCount.count, search };
  },
  component: DashboardPage,
});

function DashboardPage() {
  const { user, gmail: initialGmail, emailCount: initialEmailCount, search } =
    Route.useLoaderData();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  const [gmail, setGmail] = useState<GmailConnection>(initialGmail);
  const [emailCount, setEmailCount] = useState(initialEmailCount);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchResult, setFetchResult] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

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
            Your dashboard is coming soon. We&apos;ll build out invoice tracking,
            payment cross-checking, and your weekly digest here.
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
            </div>
          </div>

          {/* Placeholder cards for future features */}
          <div className="mt-6 grid gap-6 sm:grid-cols-3">
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
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
                    d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                  />
                </svg>
              </div>
              <h3 className="mt-4 font-semibold text-gray-900">Invoices</h3>
              <p className="mt-1 text-sm text-gray-500">
                View and manage all detected invoices in one place.
              </p>
            </div>

            <div className="rounded-xl border border-gray-100 bg-gray-50 p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
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
                    d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
                  />
                </svg>
              </div>
              <h3 className="mt-4 font-semibold text-gray-900">
                Weekly Digest
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                Your finance summary delivered every week via email.
              </p>
            </div>

            <div className="rounded-xl border border-gray-100 bg-gray-50 p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
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
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                  />
                </svg>
              </div>
              <h3 className="mt-4 font-semibold text-gray-900">Alerts</h3>
              <p className="mt-1 text-sm text-gray-500">
                Underpayments and discrepancies flagged automatically.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
