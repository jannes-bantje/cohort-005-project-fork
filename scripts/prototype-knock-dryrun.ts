// PROTOTYPE (#18): headless dry run of checks 2-4. Run: npx tsx scripts/prototype-knock-dryrun.ts
process.loadEnvFile(".env");
import { signUserToken, Knock as KnockNode } from "@knocklabs/node";
import Knock from "@knocklabs/client";
const pk = process.env.KNOCK_PUBLIC_API_KEY!, ch = process.env.KNOCK_FEED_CHANNEL_ID!;
const server = new KnockNode();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
for (const [id, name] of [["5","Emma Wilson"],["2","Sarah Chen"],["6","James Park"]]) await server.users.update(id, { name });

async function client(id: string) {
  const k = new Knock(pk); k.authenticate(id, await signUserToken(id));
  const f = k.feeds.initialize(ch, { page_size: 20 });
  return { k, f };
}
async function waitFor(f: any, pred: (s: any) => boolean, label: string) {
  for (let i = 0; i < 15; i++) { await f.fetch(); if (pred(f.getState())) return true; await sleep(1000); }
  console.log("  timed out:", label); return false;
}

console.log("CHECK 2+3: discussion-reply → Emma (5), actor James (6)");
const emma = await client("5");
await emma.f.fetch(); const before = emma.f.getState().metadata;
console.log("  before:", before);
const run = await server.workflows.trigger("discussion-reply", { recipients: ["5"], actor: "6", data: { lesson_title: "Dry run lesson", excerpt: "dry-run reply", url: "/x" } });
console.log("  trigger:", run);
await waitFor(emma.f, (s) => s.metadata.total_count > before.total_count, "reply arrives");
let s = emma.f.getState(); const item = s.items[0];
console.log("  arrived:", item.source.key, JSON.stringify((item.blocks[0] as any).rendered), "meta", s.metadata);
await emma.f.markAsSeen(item); await emma.f.markAsRead(item);
await emma.f.fetch(); s = emma.f.getState();
console.log("  after seen+read:", s.metadata, "item read_at", s.items[0].read_at, "seen_at", s.items[0].seen_at);

console.log("CHECK 4: new-enrollment → Sarah (2), off by default");
await server.users.unsetPreferences("2", "default").catch(() => {});
const sarah = await client("2");
console.log("  Sarah prefs (client):", JSON.stringify(await sarah.k.preferences.get()));
await sarah.f.fetch(); const b2 = sarah.f.getState().metadata.total_count;
await server.workflows.trigger("new-enrollment", { recipients: ["2"], actor: "6", data: { course_title: "Dry run course (default)", url: "/x" } });
await sleep(6000); await sarah.f.fetch();
console.log("  default-off: feed count", b2, "→", sarah.f.getState().metadata.total_count);
const optedIn = await sarah.k.preferences.setCategory("enrollments", { channel_types: { in_app_feed: true } });
console.log("  opted in (client, user token):", JSON.stringify(optedIn.categories));
await server.workflows.trigger("new-enrollment", { recipients: ["2"], actor: "6", data: { course_title: "Dry run course (opted in)", url: "/x" } });
const ok = await waitFor(sarah.f, (st) => st.metadata.total_count > b2, "enrollment after opt-in");
console.log("  opted-in: feed count →", sarah.f.getState().metadata.total_count, ok ? (sarah.f.getState().items[0].blocks[0] as any).rendered : "");
await server.users.unsetPreferences("2", "default");
console.log("  reset Sarah's prefs");
process.exit(0);
