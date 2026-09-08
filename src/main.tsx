// Decision notes: stage 0 mount plus the stage 4 #/dev route. The gallery is a dynamic import
// so the fixtures never sit in the main bundle. Service worker registration, tab lock and the
// update bar arrive with stage 5 (PLAN.md section 11).
import { render } from 'preact';
import './ui/tokens.css';
import './ui/ui.css';

function Shell() {
  return (
    <main class="shell">
      <h1>Wardbelt</h1>
    </main>
  );
}

const root = document.getElementById('app');
if (root === null) {
  throw new Error('Mount point #app is missing');
}

if (location.hash.startsWith('#/dev')) {
  import('./ui/DevGallery')
    .then(({ DevGallery }) => {
      render(<DevGallery />, root);
    })
    .catch(() => {
      render(
        <main class="shell">
          <p role="alert">The gallery could not be loaded.</p>
        </main>,
        root,
      );
    });
} else {
  render(<Shell />, root);
}
