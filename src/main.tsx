// Decision notes: stage 0 mount only. Service worker registration, tab lock and the update
// bar arrive with stage 5 (PLAN.md section 11).
import { render } from 'preact';

function Shell() {
  return (
    <main>
      <h1>Wardbelt</h1>
    </main>
  );
}

const root = document.getElementById('app');
if (root === null) {
  throw new Error('Mount point #app is missing');
}
render(<Shell />, root);
