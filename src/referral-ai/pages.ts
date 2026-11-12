// ABOUTME: Renders the English signup, sign-in, invite, and Meeting Notes demo pages.
// ABOUTME: User and model text is escaped or rendered as plain text.

import { theme, wordmark } from '../appearance.ts';
import { DEMO_TOPUP_CENTS, MEETING_NOTES_UNITS, signupTrialUnits, TOPUP_GRANT_UNITS, TRIAL_GRANT_UNITS } from '../contracts.ts';
import { escapeHtml } from '../http.ts';

function layout(title: string, body: string, script: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Word of Fit</title>
<style>
${theme}
:root { color:var(--ink); background:var(--canvas); font:15px/1.5 var(--body) }
* { box-sizing:border-box }
[hidden] { display:none !important }
body { margin:0 }
header { background:var(--forest); color:var(--paper) }
header nav { min-height:60px; max-width:1220px; padding-inline:clamp(15px,4vw,48px); margin:auto; justify-content:space-between }
header a { color:inherit }
header .wof-brand { font-size:17px }
main { max-width:1220px; margin:0 auto; padding:clamp(22px,4vw,42px) clamp(15px,4vw,48px) 42px }
h1,h2,h3,p { margin:0 }
h1 { font:500 clamp(2.45rem,5vw,4.15rem)/1.02 var(--display); letter-spacing:-.052em }
h2,h3 { line-height:1.18; letter-spacing:-.02em }
h2 { font-size:1.3rem }
p { margin-top:.45rem }
section,.auth { background:var(--paper); border:1px solid var(--line); border-radius:8px; padding:clamp(15px,2vw,23px) }
.auth { max-width:30rem; margin:14px 0 }
nav,.row { display:flex; flex-wrap:wrap; gap:8px 14px; align-items:center }
a { color:var(--green-dark); text-underline-offset:.18em }
a:hover { text-decoration-thickness:2px }
label { display:block; font-size:.88rem; font-weight:660; margin-top:.75rem }
input,textarea,button { font:inherit }
input,textarea { display:block; width:100%; margin:.3rem 0 .7rem; padding:.6rem; border:1px solid #a6b2a5; border-radius:5px; background:var(--paper); color:inherit }
textarea { resize:vertical }
button,.topup-link { background:var(--forest); color:var(--paper); border:1px solid var(--forest); border-radius:5px; padding:7px 11px; min-height:37px; cursor:pointer; font-weight:670; font-size:.87rem }
.topup-link { display:inline-flex; align-items:center; text-decoration:none }
button:hover,.topup-link:hover { text-decoration:underline }
button:disabled { opacity:.65; cursor:wait }
.secondary { background:var(--paper); color:var(--green-dark); border-color:#b7c1b3 }
[role="status"] { white-space:pre-wrap; font-size:.88rem }
[role="status"]:empty { display:none }
pre { font:inherit; white-space:pre-wrap; overflow-wrap:anywhere; margin:12px 0 }
.muted { color:var(--muted) }
.app-hero { display:flex; justify-content:space-between; align-items:end; gap:14px 22px; flex-wrap:wrap; margin-bottom:18px }
.app-hero p { max-width:52ch }
.account-bar { background:var(--soft); border-radius:7px; padding:9px 12px }
.account-bar p { margin:0 }
.account-bar strong { display:block; font-size:.86rem; overflow-wrap:anywhere }
.account-bar small { display:block; font-size:.8rem; color:var(--muted) }
.topup-action small { margin-top:3px; text-align:center }
.workspace-grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,.85fr); gap:14px; align-items:start }
.workspace-grid section { min-width:0 }
.workspace-grid textarea { min-height:220px }
.result-panel { min-height:176px }
.result-panel:has(#task-output[hidden]) { background:var(--soft) }
.result-panel > p { max-width:42ch }
.result-panel h3 { font-size:1.03rem; margin-top:12px }
.invite-panel { margin-top:14px }
.invite-fields { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,2fr); gap:0 14px }
@media(max-width:750px) { .workspace-grid { grid-template-columns:1fr } }
@media(max-width:460px) { .invite-fields { grid-template-columns:1fr } header nav { padding-block:8px } }
</style>
</head>
<body>
<header><nav aria-label="Main navigation"><a href="/app" class="wof-brand">${wordmark}</a>
<a href="/founder">Founder dashboard</a></nav></header>
<main>${body}</main>
<script>
async function request(path, input) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}
${script}
</script>
</body>
</html>`;
}

export function authPage(mode: 'signup' | 'login', code: string): string {
  const signup = mode === 'signup';
  const title = signup ? 'Create your account' : 'Sign in';
  return layout(title, `
<h1>${title}</h1>
<p class="muted">${signup
    ? `Start with ${signupTrialUnits(false)} trial credit. A valid invite gives you ${TRIAL_GRANT_UNITS} trial credits.`
    : 'Open Meeting Notes to turn a transcript into a team handoff.'}</p>
<form class="auth" id="account-form" method="post" action="/api/auth/${mode}">
${signup ? '<label for="displayName">Name</label><input id="displayName" name="displayName" autocomplete="name" required maxlength="80">' : ''}
<label for="email">Email</label>
<input id="email" type="email" name="email" autocomplete="email" required maxlength="254">
<label for="password">Password</label>
<input id="password" type="password" name="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="8" maxlength="128">
${signup ? `<label for="inviteCode">Invite code (optional)</label>
<input id="inviteCode" name="inviteCode" value="${escapeHtml(code)}" maxlength="64" autocapitalize="off" spellcheck="false">` : ''}
<button type="submit">${title}</button>
<p id="account-status" role="status"></p>
</form>
<p>${signup ? 'Already have an account? <a href="/login">Sign in</a>.' : 'New to Word of Fit? <a href="/signup">Create an account</a>.'}</p>`, `
const form = document.getElementById('account-form');
const status = document.getElementById('account-status');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  status.textContent = '';
  try {
    await request('/api/auth/${mode}', Object.fromEntries(new FormData(form)));
    window.location.assign('/app');
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
});
`);
}

const sampleNotes = `Help center rollout · onboarding team

Jamie: In yesterday’s pilot, three new admins stopped at the workspace setup step. The current help article shows an old screen, so they looked for a button that no longer exists.
Morgan: We could replace the entire getting-started guide. That would push the launch to Thursday.
Riley: Let’s keep the Tuesday launch. Replace the setup checklist and its screenshots, and leave the rest of the guide for the next release.
Jamie: Agreed. I’ll update the setup checklist by Monday noon and flag the steps that require admin access.
Morgan: I’ll check the new screenshots against the current product by Monday afternoon. If a screenshot still shows test customer data, I’ll retake it.
Riley: I’ll ask Support to link the updated guide in their saved replies by Tuesday morning. We should also draft an announcement for customers on the old setup flow.
Jamie: Yes, let’s draft that announcement. We haven’t assigned it yet.
Morgan: Who will cover the support inbox during launch? Our usual owner is out Tuesday.
Riley: That’s still open. I’ll confirm coverage before we announce the rollout.`;

type AppView = {
  displayName: string;
  inviteCode: string;
  publicOrigin: string | undefined;
  balance: number;
  latestResult: string | null;
  latestTaskId: string | null;
};

export function appPage(view: AppView): string {
  const invitePath = `/signup?code=${encodeURIComponent(view.inviteCode)}`;
  const inviteUrl = view.publicOrigin ? new URL(invitePath, view.publicOrigin).href : invitePath;
  return layout('Workspace', `
<div class="app-hero">
  <div><h1>Meeting Notes</h1><p class="muted">Turn a meeting transcript into decisions, action items, and open questions your team can use.</p></div>
  <div class="row account-bar">
    <p><strong>Welcome, ${escapeHtml(view.displayName)}</strong><small>Credits available: <b id="balance">${view.balance}</b></small></p>
    <div class="topup-action"><a class="topup-link" href="/checkout">Top up with PayPal</a>
      <small>$${DEMO_TOPUP_CENTS / 100} · ${TOPUP_GRANT_UNITS} credits</small></div>
    <button class="secondary" id="sign-out" type="button">Sign out</button>
  </div>
</div>
<p id="sign-out-status" role="status"></p>
<div class="workspace-grid">
  <section aria-labelledby="task-heading">
    <h2 id="task-heading">Meeting transcript</h2>
    <p class="muted">Use the sample or paste a transcript. Each completed task uses ${MEETING_NOTES_UNITS} credit.</p>
    <form id="task-form" method="post" action="/api/tasks/meeting-notes">
      <label for="notes">Meeting notes</label>
      <textarea id="notes" name="notes" required maxlength="12000" rows="9">${escapeHtml(sampleNotes)}</textarea>
      <button type="submit">Run Meeting Notes</button>
    </form>
    <p id="task-status" role="status"></p>
  </section>
  <section class="result-panel" aria-labelledby="handoff-heading">
    <h2 id="handoff-heading">Team handoff</h2>
    <p class="muted" id="handoff-empty"${view.latestResult !== null ? ' hidden' : ''}>Run Meeting Notes to see the decisions, assigned actions, and questions to share with your team.</p>
    <div id="task-output" data-task-id="${escapeHtml(view.latestTaskId ?? '')}"${view.latestResult === null ? ' hidden' : ''}>
      <pre id="result">${escapeHtml(view.latestResult ?? '')}</pre>
      <button id="copy-handoff" type="button">Copy handoff</button>
      <p id="handoff-status" role="status"></p>
    </div>
  </section>
</div>
<section class="invite-panel" aria-labelledby="invite-heading">
  <h2 id="invite-heading">Invite someone</h2>
  <p class="muted">Share an invite to give a new account ${TRIAL_GRANT_UNITS} trial credits.</p>
  <div class="invite-fields">
    <div><label for="invite-code">Your invite code</label>
      <input id="invite-code" type="text" readonly value="${escapeHtml(view.inviteCode)}"></div>
    <div><label for="invite-link">Your invite link</label>
      <input id="invite-link" type="text" readonly value="${escapeHtml(inviteUrl)}"></div>
  </div>
  <div class="row">
    <button class="secondary" type="button" data-copy="invite-code">Copy invite code</button>
    <button class="secondary" type="button" data-copy="invite-link">Copy invite link</button>
  </div>
  <p id="copy-status" role="status"></p>
</section>`, `
const inviteLink = document.getElementById('invite-link');
inviteLink.value = new URL(inviteLink.value, window.location.origin).href;
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const field = document.getElementById(button.dataset.copy);
    const status = document.getElementById('copy-status');
    try {
      await navigator.clipboard.writeText(field.value);
      status.textContent = 'Copied.';
    } catch {
      field.select();
      status.textContent = 'Selected. Copy it to share.';
    }
  });
}
document.getElementById('sign-out').addEventListener('click', async () => {
  try {
    await request('/api/session/logout', {});
    window.location.assign('/login');
  } catch (error) {
    document.getElementById('sign-out-status').textContent = error.message;
  }
});
const taskForm = document.getElementById('task-form');
const runTask = taskForm.querySelector('button');
const taskStatus = document.getElementById('task-status');
const taskOutput = document.getElementById('task-output');
const result = document.getElementById('result');
const copyHandoff = document.getElementById('copy-handoff');
const handoffStatus = document.getElementById('handoff-status');
let pendingCopy = null;
copyHandoff.addEventListener('click', async () => {
  runTask.disabled = true;
  copyHandoff.disabled = true;
  try {
    if (!pendingCopy) {
      await navigator.clipboard.writeText(result.textContent);
      pendingCopy = { taskId: taskOutput.dataset.taskId, eventId: crypto.randomUUID(), occurredAt: new Date().toISOString() };
    }
    await request('/api/tasks/meeting-notes/copied', pendingCopy);
    pendingCopy = null;
    handoffStatus.textContent = 'Handoff copied.';
  } catch {
    handoffStatus.textContent = pendingCopy ? 'Handoff copied. Click again to retry activity recording.' : 'Could not copy the handoff.';
  } finally {
    runTask.disabled = false;
    copyHandoff.disabled = false;
  }
});
taskForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  runTask.disabled = true;
  copyHandoff.disabled = true;
  taskStatus.textContent = 'Preparing Meeting Notes…';
  try {
    const data = await request('/api/tasks/meeting-notes', Object.fromEntries(new FormData(taskForm)));
    pendingCopy = null;
    handoffStatus.textContent = '';
    result.textContent = data.result;
    taskOutput.dataset.taskId = data.taskId;
    taskOutput.hidden = false;
    document.getElementById('handoff-empty').hidden = true;
    const balance = document.getElementById('balance');
    balance.textContent = Number(balance.textContent) - ${MEETING_NOTES_UNITS};
    taskStatus.textContent = 'Meeting Notes ready.';
  } catch (error) {
    taskStatus.textContent = error.message;
  } finally {
    runTask.disabled = false;
    copyHandoff.disabled = false;
  }
});
`);
}
