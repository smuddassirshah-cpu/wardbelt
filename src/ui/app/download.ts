// Decision notes: the `<a download>` blob path from PLAN.md section 8, used now for the raw
// record export and the plain export; the Share API and copyable-textarea fallbacks arrive
// with stage 6. Returns false rather than throwing so the caller can show a banner. The object
// URL is revoked after a grace period because Chrome starts the download asynchronously.
const REVOKE_DELAY_MS = 30_000;

interface UrlApi {
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}

export function downloadText(filename: string, text: string, doc: Document = document): boolean {
  const api: UrlApi = URL;
  if (api.createObjectURL === undefined || api.revokeObjectURL === undefined) {
    return false;
  }
  const { createObjectURL, revokeObjectURL } = api;
  try {
    const url = createObjectURL.call(URL, new Blob([text], { type: 'application/json' }));
    const anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.hidden = true;
    doc.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => {
      revokeObjectURL.call(URL, url);
    }, REVOKE_DELAY_MS);
    return true;
  } catch {
    return false;
  }
}
