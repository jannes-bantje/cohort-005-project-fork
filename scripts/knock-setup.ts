// npm run knock:setup
//
// Applies Cadence's Notification config to your own Knock account through the
// Management API, so it lives in the repo and never only in the dashboard:
//
//   1. the six preference categories (a workflow may only name a category
//      that already exists)
//   2. the seven workflows, each with one in-app feed step on channel `in-app`,
//      exactly one category and a plain-text fallback template, committed and
//      activated (the bell renders rows itself, so the template is a fallback)
//   3. the environment default that turns the `enrollments` category off
//
// Every call is an upsert, so it's safe to run again whenever this changes.
// Needs KNOCK_SERVICE_TOKEN in .env (scripts/setup-knock.sh collects it).

import { loadEnvFile } from "../app/lib/env.server";
import {
  CATEGORY_DEFAULTS,
  CATEGORY_KEYS,
  WORKFLOW_CATEGORY,
  WORKFLOW_KEYS,
  type WorkflowKey,
} from "../app/lib/notification-keys";

const MANAGEMENT_API = "https://control.knock.app/v1";
const FEED_CHANNEL_KEY = "in-app";

const WORKFLOWS: Record<WorkflowKey, { name: string; body: string }> = {
  "refund-request-approved": {
    name: "Refund Request approved",
    body: "Your Refund Request for {{ data.course_title }} was approved.",
  },
  "refund-request-declined": {
    name: "Refund Request declined",
    body: "Your Refund Request for {{ data.course_title }} was declined.",
  },
  "open-refund-request": {
    name: "New Open Refund Request",
    body: "{{ actor.name }} raised a Refund Request for {{ data.course_title }}.",
  },
  "seat-claimed": {
    name: "Claimed Seat",
    body: "{{ actor.name }} claimed a Seat on {{ data.course_title }}.",
  },
  "new-enrollment": {
    name: "New Enrollment",
    body: "{{ actor.name }} enrolled in {{ data.course_title }}.",
  },
  "discussion-question": {
    name: "Discussion Question",
    body: "{{ actor.name }} asked a Discussion Question on {{ data.lesson_title }}.",
  },
  "discussion-reply": {
    name: "Discussion Reply",
    body: "{{ actor.name }} replied to your Discussion Question on {{ data.lesson_title }}.",
  },
};

loadEnvFile();
const token = process.env.KNOCK_SERVICE_TOKEN;
if (!token) {
  console.error(
    "KNOCK_SERVICE_TOKEN is not set. Run scripts/setup-knock.sh to add it to .env."
  );
  process.exit(1);
}

async function managementApi(
  method: "GET" | "PUT",
  path: string,
  body?: unknown
) {
  const response = await fetch(`${MANAGEMENT_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `${method} ${path} failed with ${response.status}: ${text}`
    );
  }
  console.log(`✓ ${method} ${path}`);
  return text ? JSON.parse(text) : null;
}

// One Knock account per developer, single environment. An older account with
// several environments uses Development.
async function environmentSlug(): Promise<string> {
  const environments: { entries: { slug: string }[] } = await managementApi(
    "GET",
    "/environments"
  );
  const slugs = environments.entries.map((environment) => environment.slug);
  if (slugs.includes("development")) return "development";
  if (slugs.length === 1) return slugs[0];
  throw new Error(
    `Expected one Knock environment or a "development" one, found: ${slugs.join(", ")}`
  );
}

const environment = await environmentSlug();
const query = `environment=${encodeURIComponent(environment)}`;

for (const category of CATEGORY_KEYS) {
  await managementApi("PUT", `/preference_categories/${category}`);
}

for (const key of WORKFLOW_KEYS) {
  const workflow = WORKFLOWS[key];
  await managementApi(
    "PUT",
    `/workflows/${key}?${query}&commit=true&commit_message=${encodeURIComponent("knock:setup")}`,
    {
      workflow: {
        name: workflow.name,
        categories: [WORKFLOW_CATEGORY[key]],
        steps: [
          {
            type: "channel",
            ref: "in_app_feed_1",
            name: "In-app feed",
            channel_key: FEED_CHANNEL_KEY,
            template: {
              markdown_body: workflow.body,
              action_url: "{{ data.url }}",
            },
          },
        ],
      },
    }
  );
  await managementApi("PUT", `/workflows/${key}/activate?${query}`, {
    status: true,
  });
}

const categoriesOffByDefault = Object.fromEntries(
  CATEGORY_KEYS.filter((category) => !CATEGORY_DEFAULTS[category]).map(
    (category) => [category, false]
  )
);
await managementApi("PUT", `/environments/${environment}/defaults`, {
  preference_set: { categories: categoriesOffByDefault },
});

console.log(`\nKnock is set up in the "${environment}" environment.`);
