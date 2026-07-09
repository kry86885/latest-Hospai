/**
 * printViaIframe – shared print utility
 *
 * Uses a Blob URL loaded into a hidden <iframe> so that:
 *  - No popup blocker can interfere (no window.open)
 *  - Large base64 images (logo) are preserved in full (doc.write truncates them)
 *  - The browser's native print dialog is triggered reliably via iframe.contentWindow.print()
 */
export function printViaIframe(html: string, frameId = "__hospai_print_frame__"): void {
  const existing = document.getElementById(frameId);
  if (existing) existing.remove();

  const iframe = document.createElement("iframe");
  iframe.id = frameId;
  iframe.setAttribute(
    "style",
    "position:fixed;top:-9999px;left:-9999px;width:0;height:0;border:none;visibility:hidden;"
  );
  document.body.appendChild(iframe);

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  iframe.onload = () => {
    // Small delay lets fonts/images inside the blob document fully paint
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } finally {
        // Clean up after the user closes/submits the print dialog
        setTimeout(() => {
          try {
            iframe.remove();
            URL.revokeObjectURL(url);
          } catch {
            /* already removed */
          }
        }, 4000);
      }
    }, 400);
  };

  iframe.src = url;
}
