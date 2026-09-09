// Decision notes: plain-English reasons for the banner. Duck-typed on name and message because
// a DOMException is not an instanceof Error across realms.
export function describeError(e: unknown): string {
  if (typeof e === 'string' && e !== '') {
    return e;
  }
  if (typeof e === 'object' && e !== null) {
    const name = 'name' in e && typeof e.name === 'string' ? e.name : '';
    const message = 'message' in e && typeof e.message === 'string' ? e.message : '';
    if (name !== '' && message !== '') {
      return `${name}: ${message}`;
    }
    if (name !== '' || message !== '') {
      return name === '' ? message : name;
    }
  }
  return 'Unknown error';
}
