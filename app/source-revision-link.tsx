"use client";

import { useState } from "react";

import { apiRequest } from "./api-client";

function sourceRevisionAccessPath(revisionId: string): string {
  return `/api/source-revisions/${encodeURIComponent(revisionId)}/access`;
}

export async function openSourceRevision(input: {
  revisionId: string;
  page?: number;
  request?: (
    accessPath: string,
  ) => Promise<{ url: string; expiresAt: string }>;
  navigate(url: string): void;
}): Promise<void> {
  const request = input.request
    ?? ((accessPath: string) =>
      apiRequest<{ url: string; expiresAt: string }>(accessPath));
  const access = await request(sourceRevisionAccessPath(input.revisionId));
  input.navigate(`${access.url}${input.page ? `#page=${input.page}` : ""}`);
}

export function SourceRevisionLink({
  revisionId,
  page,
  children,
  ariaLabel,
}: {
  revisionId: string;
  page?: number;
  children?: React.ReactNode;
  ariaLabel?: string;
}) {
  const [error, setError] = useState("");
  const accessPath = sourceRevisionAccessPath(revisionId);

  async function openRevision(
    event: React.MouseEvent<HTMLAnchorElement>,
  ) {
    event.preventDefault();
    const pendingWindow = window.open("about:blank", "_blank");
    if (pendingWindow) pendingWindow.opener = null;
    setError("");
    try {
      await openSourceRevision({
        revisionId,
        page,
        navigate(url) {
          if (pendingWindow) pendingWindow.location.replace(url);
          else window.location.assign(url);
        },
      });
    } catch (accessError) {
      pendingWindow?.close();
      setError(
        accessError instanceof Error
          ? accessError.message
          : "Source Revision could not be opened.",
      );
    }
  }

  return (
    <span className="vsee-source-revision-link">
      <a
        aria-label={ariaLabel}
        href={`${accessPath}${page ? `#page=${page}` : ""}`}
        onClick={(event) => void openRevision(event)}
        target="_blank"
        rel="noreferrer"
      >
        {children ?? `Source Revision · ${revisionId} ↗`}
      </a>
      {error && <small role="alert">{error}</small>}
    </span>
  );
}
