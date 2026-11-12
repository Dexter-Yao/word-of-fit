# Word of Fit

**Follow word of mouth to see who to build for.**

Word of Fit helps AI app founders see which referred users come back and pay. Personal invite links connect signups to their referrer. The founder compares repeat use and profit over the same time since signup, combines conditions in AG Studio, and opens individual accounts to see the activity and payments behind the results.

## Run locally

Install Node.js 22.18 or later, then run `npm ci`. The default application starts with an empty database. Run `npm start` after setting the provider configuration below, or use `node --env-file=/path/to/private-settings.env src/server.ts` to load settings explicitly. Keep environment files outside the repository.

The server binds to loopback on port 3000. Open [Meeting Notes](http://127.0.0.1:3000/app) or the [founder report](http://127.0.0.1:3000/founder). Check [service health](http://127.0.0.1:3000/healthz). Use separate browser profiles for the two app accounts and the founder session. Set `WOF_PORT` to change the port and `WOF_DB_PATH` to choose a SQLite file (default: `.local/word-of-fit.sqlite3`). Use a separate database for each instance.

| Purpose | Environment variables |
| --- | --- |
| Founder access | Set `WOF_FOUNDER_TOKEN` to a private token and enter it on the founder sign-in page. |
| PayPal Sandbox | Set `PAYPAL_SANDBOX_CLIENT_ID`, `PAYPAL_SANDBOX_CLIENT_SECRET` and `PAYPAL_SANDBOX_WEBHOOK_ID`. Optionally pin `PAYPAL_SANDBOX_MERCHANT_ID`. |
| OpenAI | Set `OPENAI_API_KEY`. Optionally set `OPENAI_MODEL`. |
| PostHog | Set `POSTHOG_PROJECT_ID`, `POSTHOG_PROJECT_TOKEN` with capture access and `POSTHOG_PERSONAL_API_KEY` with query access. `POSTHOG_REGION` accepts `us` or `eu`. |
| LangSmith | Set `LANGSMITH_WORKSPACE_ID`, `LANGSMITH_PROJECT_ID` and `LANGSMITH_API_KEY` with trace write and read access. `LANGSMITH_REGION` accepts `us`, `eu`, `apac` or `aws-us`. Configure model pricing for reported cost. |
| Application origin | Set `WOF_PUBLIC_ORIGIN` to the browser origin if it differs from the loopback default. It supplies invitation and checkout return URLs. |
| AG Studio | The vendor allows local evaluation without a key. For deployments that require a license, set an authorized `WOF_AG_STUDIO_LICENSE_KEY`. [Vendor instructions](https://www.ag-grid.com/studio/javascript/licence-install/) |

Create a Sandbox business app and a separate Personal Sandbox buyer. Register an HTTPS callback for the same Sandbox app, forwarding to `/webhook/paypal`, with `PAYMENT.CAPTURE.COMPLETED` and `PAYMENT.CAPTURE.REFUNDED` subscriptions. Use the registration ID for `PAYPAL_SANDBOX_WEBHOOK_ID`. [Sandbox setup](https://developer.paypal.com/sandbox-testing/overview) · [Webhook setup](https://developer.paypal.com/api/rest/webhooks/)

### Verify the referral, AI task, and payment

1. Register Alex and copy the invite link. Open it in a separate browser profile and register Jamie. Direct signup grants one trial credit; signup through the invite grants three.
2. As Jamie, submit a fictional meeting transcript. The OpenAI Responses API returns decisions, action items, and open questions. Use **Copy handoff** to record the key action.
3. Open **Top up with PayPal** and approve the one-time $10 order as the Personal Sandbox buyer. On return, use **Check payment** if prompted. A completed top-up grants ten credits.
4. In the founder report, use **Sync records** to read PostHog activity and LangSmith cost. Select Alex in the comparison and open Jamie. The timeline links the task, credit use, model cost, and $10 capture to the same account. If an import has not appeared yet, wait for provider ingestion and retry the sync.
5. In PayPal Sandbox, resend the completed capture notification. Jamie should still have one $10 capture and one top-up grant.

The default key action is `meeting_handoff_copied`. To use another event, set `WOF_KEY_ACTION` and `WOF_KEY_ACTION_LABEL`. For imported events use the application user ID as `distinct_id` and include `wof_app=word_of_fit_demo`. Include `task_id` and `scenario` when an event is tied to a task.

### Try the founder report without provider accounts

The optional example below creates an independent SQLite database with eight fictional accounts. It is a working analytics example and does not call OpenAI, PayPal, PostHog, or LangSmith. It does not change the default application database.

```sh
mkdir -p .local
node examples/paid-web.ts .local/paid-web.sqlite3
WOF_FOUNDER_TOKEN=judge-local-demo WOF_MODE=showcase WOF_DB_PATH=.local/paid-web.sqlite3 WOF_PORT=3001 npm start
```

Open the [example report](http://127.0.0.1:3001/founder) and sign in with the local demo token `judge-local-demo`. Use a fresh database path if generating the example again.

Use **Window → First 4 weeks** and the native **Filters** panel:

1. Set **Repeat use** to **Repeated**. Three accounts match.
2. Set **Window profit (USD)** to **Greater than 0**. Two accounts match.
3. Use **Add Filter → PostHog workflow**, select **Equals**, and enter **Team Report Export**. Only Jamie matches. The comparison, journey, retention, profit charts, and account list use the same filters. Open Jamie to inspect the two exports and the payment, then return to the same selection.

Profit in this report is net captured payments less recorded model cost over the selected period. It excludes other business expenses. Missing required model cost leaves profit unavailable. The calendar-month chart uses completed UTC months.

AG Studio is installed from npm and is licensed separately from the Word of Fit source. The repository does not distribute vendor keys or binaries.
