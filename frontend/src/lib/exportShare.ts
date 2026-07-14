import { API_BASE } from "./constants";
import { getAuthHeaders, getHospitalCode } from "./api";

export type ShareExportOptions = {
  blob: Blob;
  filename: string;
  title: string;
  text?: string;
};

export type ShareExportResult = "shared" | "downloaded" | "cancelled";

export function downloadExportBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

export function filenameFromContentDisposition(headerValue: string | null, fallback: string) {
  if (!headerValue) return fallback;

  const utf8Match = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].replace(/['"]/g, "")).trim() || fallback;
    } catch {
      return utf8Match[1].replace(/['"]/g, "").trim() || fallback;
    }
  }

  const filenameMatch = headerValue.match(/filename="?([^";]+)"?/i);
  return filenameMatch?.[1]?.trim() || fallback;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function buildEmailFallback(title: string, text: string | undefined, filename: string) {
  const subject = encodeURIComponent(title);
  const body = encodeURIComponent(
    `${text || title}\n\nThe exported file was downloaded to this device as ${filename}. Attach it from your Downloads folder to share through Email, Outlook, Gmail, WhatsApp, Teams, Telegram, or any other available application.`,
  );
  return `mailto:?subject=${subject}&body=${body}`;
}

export async function shareOrDownloadExport({ blob, filename, title, text }: ShareExportOptions): Promise<ShareExportResult> {
  const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData & { files?: File[] }) => boolean;
    share?: (data: ShareData & { files?: File[] }) => Promise<void>;
  };

  const hasNativeShare = typeof nav.share === "function";
  const canShareFile = hasNativeShare && (typeof nav.canShare !== "function" || nav.canShare({ files: [file] }));

  // 1. Try native Web Share API for files (primarily mobile)
  if (canShareFile) {
    try {
      await nav.share({ title, text, files: [file] });
      return "shared";
    } catch (error) {
      if (isAbortError(error)) return "cancelled";
      // Continue to modal sharing if native share throws an error
    }
  }

  // 2. Upload file to backend to generate shareable link (primarily desktop fallback)
  let shareUrl = "";
  try {
    const formData = new FormData();
    formData.append("file", blob, filename);
    const response = await fetch(`${API_BASE}/api/share/upload`, {
      method: "POST",
      headers: { "X-Hospital-Code": getHospitalCode(), ...getAuthHeaders() },
      credentials: "include",
      body: formData,
    });
    if (response.ok) {
      const data = await response.json();
      // Prefer share URL on same origin as the app so shared links work externally
      const returned = String(data.share_url || "");
      const tokenMatch = returned.match(/\/api\/share\/view\/([^\/?#]+)/);
      if (tokenMatch && typeof window !== "undefined" && window.location && window.location.origin) {
        shareUrl = `${window.location.origin}/api/share/view/${tokenMatch[1]}`;
      } else {
        shareUrl = returned;
      }
    }
  } catch (error) {
    console.error("Failed to upload report for sharing:", error);
  }

  // 3. Trigger global custom sharing modal if hook is registered
  if (shareUrl && typeof window !== "undefined" && typeof window.__hospai_share__ === "function") {
    window.__hospai_share__({ blob, filename, title, text, shareUrl });
    return "shared";
  }

  // 4. Default graceful fallback: File download + mailto template
  downloadExportBlob(blob, filename);
  if (shareUrl) {
    window.setTimeout(() => {
      try {
        const subject = encodeURIComponent(title);
        const body = encodeURIComponent(`${text || title}\n\nView online: ${shareUrl}\n\nDownloaded to device as ${filename}.`);
        window.location.href = `mailto:?subject=${subject}&body=${body}`;
      } catch (err) {
        // Blocked by browser shell
      }
    }, 250);
  } else {
    window.setTimeout(() => {
      try {
        window.location.href = buildEmailFallback(title, text, filename);
      } catch {
        // Blocked by browser shell
      }
    }, 250);
  }
  return "downloaded";
}

declare global {
  interface Window {
    __hospai_share__?: (options: {
      blob: Blob;
      filename: string;
      title: string;
      text?: string;
      shareUrl: string;
    }) => void;
  }
}
