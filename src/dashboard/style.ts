// ABOUTME: Styles the founder report shell, controls and account evidence.
// ABOUTME: AG Studio owns the styles inside its report. This palette is scoped to founder pages.

import { theme } from '../appearance.ts';

export const style = `${theme}
:root {
  --canvas: #fff;
  --paper: #fff;
  --ink: #171717;
  --muted: #525252;
  --forest: #171717;
  --line: #e5e5e5;
  --soft: #fafafa;
  --selected: #f0f0f0;
  --accent: #13765d;
  --green-dark: #155f4c;
  --teal: #13765d;
  --rust: #9f2722;
  --body: Geist, Inter, system-ui, sans-serif;
  font: 15px/1.5 var(--body);
  color: var(--ink);
  background: var(--canvas);
}
@scope (body) to (#studio-report) {
* { box-sizing: border-box }
[hidden] { display: none !important }
:scope { margin: 0 }
a { color: var(--green-dark); text-underline-offset: .2em }
a:hover { text-decoration-thickness: 2px }
button,input,select { font: inherit }
:scope > header { border-bottom: 1px solid var(--line); background: var(--paper) }
.bar,main { max-width: 1480px; margin-inline: auto; padding-inline: clamp(16px, 3vw, 44px) }
.bar { min-height: 56px; display: flex; gap: 10px 24px; align-items: center }
.bar .wof-brand { font-size: 16px; flex-shrink: 0; white-space: nowrap }
#sign-out { margin-left: auto; white-space: nowrap }
main { padding-block: clamp(24px, 2.4vw, 32px) 48px }
h1,h2,h3 { margin: 0; line-height: 1.2; overflow-wrap: anywhere }
h1 { font-size: clamp(1.8rem, 3vw, 2.4rem); font-weight: 650; letter-spacing: -.043em }
h2 { font-size: clamp(1.07rem, 2vw, 1.3rem); letter-spacing: -.026em }
p { margin: .45rem 0 .8rem }
.muted,small { color: var(--muted) }
small { font-size: .8rem }
code { font: .84em ui-monospace, monospace; overflow-wrap: anywhere }
.page-heading,.hero { margin-bottom: 14px; display: flex; justify-content: space-between; gap: 10px 20px; align-items: center; flex-wrap: wrap }
.hero p,.workspace-label { margin-bottom: 0; font-size: .86rem }
.actions,.filters { display: flex; gap: 8px; align-items: end; flex-wrap: wrap }
button,input,select {
  color: inherit;
  background: var(--paper);
  border: 1px solid #d4d4d4;
  border-radius: 6px;
  min-height: 36px;
  padding: 5px 10px;
  max-width: 100%;
}
button {
  font-size: .86rem;
  font-weight: 600;
  cursor: pointer;
}
button:hover { background: #f4f4f4 }
button.primary,#studio-edit[aria-pressed="true"] {
  background: var(--forest); color: var(--paper); border-color: var(--forest);
}
button.primary:hover,#studio-edit[aria-pressed="true"]:hover { background: #383838 }
button:disabled { opacity: .5; cursor: default }
.report-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 16px; margin: 14px 0 10px }
.grouping-control { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: .88rem; font-weight: 600 }
.grouping-control select { font-size: .88rem; font-weight: 500 }
.report-settings { font-size: .86rem }
.report-settings summary strong { margin-left: 5px; color: var(--ink); font-weight: 650 }
.report-settings[open] { order: 1; width: 100%; border-block: 1px solid var(--line) }
.report-settings[open] .filters { margin-top: 4px }
#studio-filter-toggle { margin-left: auto }
#studio-filter-toggle[aria-pressed="true"] { border-color: #a8cbbf; color: var(--green-dark); background: #f1f7f4 }
.status,#studio-status { margin: 0 }
.status:not(:empty),#studio-status:not([hidden]) { margin-bottom: 12px; padding: 8px 12px; background: var(--soft); border-radius: 6px }
.error,.negative { color: var(--rust) }
.panel { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; margin: 1rem 0; padding: clamp(13px, 1.8vw, 24px); min-width: 0 }
.filters { gap: 8px 12px }
.filters label,.signin label { display: grid; gap: 4px; font-size: .8rem; font-weight: 600; min-width: 0 }
.filters input,.filters select { font-size: .88rem; font-weight: 450 }
input[type=number] { width: 5.5rem }
.signin { max-width: 29rem }
.signin label { margin-bottom: 14px }
summary { cursor: pointer; font-weight: 600; padding-block: 8px }
details+details { border-top: 1px solid var(--line) }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; font-size: .88rem }
th,td { text-align: left; padding: .62rem; border-bottom: 1px solid var(--line); vertical-align: top }
thead th { background: var(--soft); font-size: .8rem; font-weight: 650 }
tbody tr:last-child > * { border-bottom: 0 }
th[scope=row] { font-weight: 600 }
.numeric { text-align: right; white-space: nowrap }
thead th.numeric { white-space: normal }
.table-scroll { max-width: 100%; overflow: auto; border-radius: 4px }
.table-scroll small { display: block; margin-top: 3px }
.facts { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(100%,137px),1fr)); gap: 12px; margin: 13px 0 }
.facts div { border: 1px solid var(--line); border-radius: 6px; padding: 8px 12px }
dt { color: var(--muted); font-size: .82rem }
dd { margin: 3px 0 0; font-size: 1.15rem; line-height: 1.2; font-weight: 650; overflow-wrap: anywhere; font-variant-numeric: tabular-nums }
.timeline time { white-space: nowrap }
.timeline small { display: block; overflow-wrap: anywhere }
.timeline td:last-child { min-width: 10rem }
.timeline th:first-child { width: 23% }
.timeline th:nth-child(2) { width: 32% }
.record-details summary { font-size: .77rem; color: var(--muted); padding: 2px 0; font-weight: 550 }
.record-details[open] { margin-bottom: 4px }
.timeline h2,#credits-heading { margin-bottom: 12px }
.back { margin: 0 0 10px; font-size: .86rem; font-weight: 600 }
.account-id { overflow-wrap: anywhere }
.studio-shell { min-width: 0 }
@media (max-width: 580px) {
  .bar { gap: 0 12px }
  .actions button { min-height: 40px }
  .page-heading { align-items: start; gap: 6px 12px }
  .workspace-label { margin-top: 4px; font-size: .79rem }
  .grouping-control select { max-width: 143px }
  .facts { grid-template-columns: repeat(2,minmax(0,1fr)) }
  .filters label { max-width: 100% }
}
}
#studio-report { width: 100%; height: 2010px; position: relative }
@media (max-width: 790px) {
  #studio-report { height: 2680px }
}
@media (max-width: 900px) {
  .studio-shell:has(.is-editing) { overflow-x: auto }
  #studio-report.is-editing { min-width: 940px }
}
`;
