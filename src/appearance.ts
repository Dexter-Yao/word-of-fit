// ABOUTME: Shares the Word of Fit palette, typography, and wordmark across app surfaces.
// ABOUTME: Pages use local system fonts so the demo renders without a font service.

export const theme = `
:root {
  color-scheme: light;
  --canvas: #f4f2ea;
  --paper: #fffefa;
  --ink: #192c25;
  --muted: #506057;
  --forest: #18382e;
  --line: #dedfd4;
  --soft: #eceee4;
  --selected: #e7efd9;
  --accent: #d4ed9c;
  --green: #3e7353;
  --green-dark: #24513b;
  --teal: #31717c;
  --rust: #a64632;
  --display: "Instrument Serif", Georgia, serif;
  --body: "Instrument Sans", system-ui, sans-serif;
}
.wof-brand { display:inline-flex; align-items:center; gap:10px; color:inherit; font-weight:750; text-decoration:none }
.wof-mark { display:inline-flex; align-items:end; gap:2px; transform:skew(-13deg) }
.wof-mark i { width:4px; height:7px; background:var(--accent) }
.wof-mark i:nth-child(2) { height:12px }
.wof-mark i:nth-child(3) { height:17px }
:focus-visible { outline:3px solid var(--teal); outline-offset:3px }
`;

export const wordmark = '<span class="wof-mark" aria-hidden="true"><i></i><i></i><i></i></span>Word of Fit';
