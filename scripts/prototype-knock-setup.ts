// PROTOTYPE — throwaway spike for "Does Knock hold up against Cadence?" (#18).
// Lives on the prototype/knock-spike branch only. Never merge.
//
// Creates, through Knock's Management API, everything the spike route needs:
// two workflows (each with one in-app feed step and a category) and an
// environment-level default preference set that turns the Enrollment category
// off, so Instructors must opt in.
//
// Run: npx tsx scripts/prototype-knock-setup.ts
// Needs KNOCK_SERVICE_TOKEN and KNOCK_FEED_CHANNEL_ID in .env.

process.loadEnvFile(".env");

const token = process.env.KNOCK_SERVICE_TOKEN;
const feedChannelId = process.env.KNOCK_FEED_CHANNEL_ID;
if (!token || !feedChannelId) {
  throw new Error("Set KNOCK_SERVICE_TOKEN and KNOCK_FEED_CHANNEL_ID in .env");
}

async function mapi(method: string, path: string, body?: unknown) {
  const res = await fetch(`https://control.knock.app/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`${method} ${path} → ${res.status}`);
  if (!res.ok) throw new Error(text);
  return text ? JSON.parse(text) : null;
}

const envs = await mapi("GET", "/environments");
console.log(
  "environments:",
  envs.entries.map((e: { slug: string }) => e.slug)
);
const environment: string = envs.entries[0].slug;

const channels = await mapi("GET", "/channels");
const feed = channels.entries.find(
  (c: { id: string }) => c.id === feedChannelId
);
if (!feed) throw new Error(`No channel with id ${feedChannelId}`);
console.log("feed channel key:", feed.key);

const workflows = [
  {
    key: "discussion-reply",
    name: "Discussion Reply",
    categories: ["discussions"],
    body: "**{{ actor.name }}** replied to your question in **{{ data.lesson_title }}**: {{ data.excerpt }}",
  },
  {
    key: "new-enrollment",
    name: "New Enrollment",
    categories: ["enrollments"],
    body: "**{{ actor.name }}** enrolled in **{{ data.course_title }}**",
  },
];

// Workflows may only name categories that already exist in the catalog.
for (const category of new Set(workflows.flatMap((wf) => wf.categories))) {
  await mapi("PUT", `/preference_categories/${category}`);
}

for (const wf of workflows) {
  await mapi(
    "PUT",
    `/workflows/${wf.key}?environment=${environment}&commit=true&commit_message=prototype-knock-spike`,
    {
      workflow: {
        name: wf.name,
        categories: wf.categories,
        steps: [
          {
            type: "channel",
            ref: "in_app_feed_1",
            name: "In-app feed",
            channel_key: feed.key,
            template: {
              markdown_body: wf.body,
              action_url: "{{ data.url }}",
            },
          },
        ],
      },
    }
  );
  await mapi("PUT", `/workflows/${wf.key}/activate?environment=${environment}`, {
    status: true,
  });
}

// The off-by-default, opt-in entry: Enrollment Notifications are off for
// everyone unless the recipient's own preference set turns them on.
const defaults = await mapi("PUT", `/environments/${environment}/defaults`, {
  preference_set: { categories: { enrollments: false } },
});
console.log("environment defaults:", JSON.stringify(defaults.preference_set));

export {};
