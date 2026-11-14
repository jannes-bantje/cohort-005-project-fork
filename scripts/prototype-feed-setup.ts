// PROTOTYPE — throwaway for "What does the Notification Feed look like in
// Cadence?" (#16). Lives on the prototype/notification-feed branch only.
// Never merge.
//
// Creates one Knock workflow per v1 catalogue Notification (#12), each with a
// single in-app feed step. Categories here are provisional: preferences are
// decided in "How do Notification preferences work in Cadence?" (#17).
//
// Run: npm run prototype:feed-setup
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
const environment: string = envs.entries[0].slug;

const channels = await mapi("GET", "/channels");
const feed = channels.entries.find(
  (c: { id: string }) => c.id === feedChannelId
);
if (!feed) throw new Error(`No channel with id ${feedChannelId}`);

// Variant A renders Knock's markdown_body as-is; variants B and C render from
// `data` in Cadence. Both are fed from the same trigger.
const workflows = [
  {
    key: "refund-approved",
    name: "Refund Request approved",
    categories: ["refunds"],
    body: "Your Refund Request for **{{ data.course_title }}** was approved.{% if data.decision_note %} “{{ data.decision_note }}”{% endif %}",
  },
  {
    key: "refund-declined",
    name: "Refund Request declined",
    categories: ["refunds"],
    body: "Your Refund Request for **{{ data.course_title }}** was declined: “{{ data.decision_note }}” You can ask again.",
  },
  {
    key: "refund-request-opened",
    name: "New Open Refund Request",
    categories: ["refund-requests"],
    body: "**{{ actor.name }}** asked for a refund of **{{ data.amount }}** for **{{ data.course_title }}**: “{{ data.reason }}”",
  },
  {
    key: "seat-claimed",
    name: "Seat claimed",
    categories: ["seats"],
    body: "**{{ actor.name }}** claimed a Seat for **{{ data.course_title }}**. {{ data.seats_left }} of {{ data.seats_total }} Seats left.",
  },
  {
    key: "new-enrollment",
    name: "New Enrollment",
    categories: ["enrollments"],
    body: "**{{ actor.name }}** enrolled in **{{ data.course_title }}**",
  },
  {
    key: "discussion-question",
    name: "Discussion Question",
    categories: ["discussions"],
    body: "**{{ actor.name }}** asked a question in **{{ data.lesson_title }}**: {{ data.excerpt }}",
  },
  {
    key: "discussion-reply",
    name: "Discussion Reply",
    categories: ["discussions"],
    body: "**{{ actor.name }}** replied to your question in **{{ data.lesson_title }}**: {{ data.excerpt }}",
  },
];

for (const category of new Set(workflows.flatMap((wf) => wf.categories))) {
  await mapi("PUT", `/preference_categories/${category}`);
}

for (const wf of workflows) {
  await mapi(
    "PUT",
    `/workflows/${wf.key}?environment=${environment}&commit=true&commit_message=prototype-notification-feed`,
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
  await mapi(
    "PUT",
    `/workflows/${wf.key}/activate?environment=${environment}`,
    { status: true }
  );
}

export {};
