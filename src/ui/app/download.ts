// Decision notes: the `<a download>` blob path from PLAN.md section 8, used for the raw
// record export and as the middle step of the export chain in ./transfer. Returns false rather
// than throwing so the caller can fall back. The anchor is removed and the object URL released
// in a finally block so a throwing click leaks neither a DOM node nor a Blob: after a click the
// revoke waits a grace period because Chrome starts the download asynchronously; when the click
// never happened nothing is in flight and the URL is revoked at once.
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
  let url: string | undefined;
  let anchor: HTMLAnchorElement | undefined;
  let clicked = false;
  try {
    url = createObjectURL.call(URL, new Blob([text], { type: 'application/json' }));
    anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.hidden = true;
    doc.body.appendChild(anchor);
    anchor.click();
    clicked = true;
    return true;
  } catch {
    return false;
  } finally {
    anchor?.remove();
    if (url !== undefined) {
      const created = url;
      if (clicked) {
        setTimeout(() => {
          revokeObjectURL.call(URL, created);
        }, REVOKE_DELAY_MS);
      } else {
        revokeObjectURL.call(URL, created);
      }
    }
  }
}
