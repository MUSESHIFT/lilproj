import { createFileRoute, redirect } from "@tanstack/react-router";
import { getGoogleOAuthUrl } from "~/lib/gmail";

export const Route = createFileRoute("/api/auth/google")({
  loader: async () => {
    const result = await getGoogleOAuthUrl();

    if (result.error || !result.authUrl) {
      throw redirect({
        to: "/dashboard",
        search: { error: result.error ?? "unknown_error" },
        statusCode: 302,
      });
    }

    throw redirect({ href: result.authUrl, statusCode: 302 });
  },
});
