import { createFileRoute, redirect } from "@tanstack/react-router";
import { completeGmailAuth } from "~/lib/gmail";

export const Route = createFileRoute("/api/auth/google/callback")({
  loader: async ({ location }) => {
    const url = new URL(location.href);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      throw redirect({
        to: "/dashboard",
        search: { error: "google_auth_denied" },
        statusCode: 302,
      });
    }

    if (!code) {
      throw redirect({
        to: "/dashboard",
        search: { error: "google_auth_missing_code" },
        statusCode: 302,
      });
    }

    const result = await completeGmailAuth({
      data: { code, state: state ?? "" },
    });

    if (result.success) {
      throw redirect({
        to: "/dashboard",
        search: { connected: "gmail" },
        statusCode: 302,
      });
    }

    throw redirect({
      to: "/dashboard",
      search: { error: result.error ?? "google_unknown_error" },
      statusCode: 302,
    });
  },
  component: CallbackPage,
});

function CallbackPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
        <p className="mt-4 text-sm text-gray-500">
          Connecting your Gmail account...
        </p>
      </div>
    </div>
  );
}
