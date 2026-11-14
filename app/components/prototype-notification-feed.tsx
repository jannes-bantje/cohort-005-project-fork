// PROTOTYPE — throwaway for "What does the Notification Feed look like in
// Cadence?" (#16). prototype/notification-feed branch only. Never merge.
//
// Three variants of the Notification Feed, mounted into the real app layout
// and switchable with ?variant=A|B|C (or ←/→, or the bottom bar). The choice
// sticks in localStorage so it survives navigation through normal links.
//
//   A · Bell popover   — bell in the sidebar header, badge = UNSEEN count,
//                        opening marks all seen, a click marks one read.
//                        Rows are Knock's own rendered markdown template.
//   B · Inbox page     — "Notifications" nav item, badge = UNREAD count,
//                        a full page with All/Unread tabs, day groups, rows
//                        rendered by Cadence from item.data, per-row actions.
//   C · Drawer + toasts — dot (no number) by the user's avatar, right-hand
//                        drawer grouped by area, opening marks EVERYTHING
//                        read (one state, no seen/read split), and a toast
//                        whenever a Notification arrives in real time.
//
// Every variant talks to the real Knock feed through @knocklabs/client with a
// signed user token for the DevUI user. No Knock React components.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useFetcher, useLocation, useNavigate } from "react-router";
import Knock, { type Feed, type FeedItem, type FeedStoreState } from "@knocklabs/client";
import { toast } from "sonner";
import {
  Bell,
  BellDot,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  GraduationCap,
  Inbox,
  MessageCircleQuestion,
  MessageSquareReply,
  Receipt,
  UserPlus,
  X,
} from "lucide-react";
import { cn } from "~/lib/utils";

// ─── Variant selection ───────────────────────────────────────────────────────

export const VARIANTS = {
  A: "Bell popover",
  B: "Inbox page",
  C: "Drawer + toasts",
} as const;
export type VariantKey = keyof typeof VARIANTS;
const KEYS = Object.keys(VARIANTS) as VariantKey[];
const STORAGE_KEY = "prototype-notification-feed-variant";

export function useVariant(): [VariantKey, (v: VariantKey) => void] {
  const location = useLocation();
  const navigate = useNavigate();
  const [stored, setStored] = useState<VariantKey>("A");

  useEffect(() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY) as VariantKey | null;
      if (s && KEYS.includes(s)) setStored(s);
    } catch {}
  }, []);

  const fromUrl = new URLSearchParams(location.search).get("variant") as VariantKey | null;
  const variant = fromUrl && KEYS.includes(fromUrl) ? fromUrl : stored;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, variant);
    } catch {}
    setStored(variant);
  }, [variant]);

  const set = useCallback(
    (v: VariantKey) => {
      const params = new URLSearchParams(location.search);
      params.set("variant", v);
      navigate(`${location.pathname}?${params}`, { replace: true, preventScrollReset: true });
    },
    [location.pathname, location.search, navigate]
  );
  return [variant, set];
}

// ─── Knock feed context ──────────────────────────────────────────────────────

interface FeedCtx {
  feed: Feed | null;
  state: FeedStoreState | null;
  items: FeedItem[];
  unread: number;
  unseen: number;
}
const Ctx = createContext<FeedCtx>({ feed: null, state: null, items: [], unread: 0, unseen: 0 });
export const useNotificationFeed = () => useContext(Ctx);

export interface KnockSession {
  userId: number;
  token: string;
  publicKey: string;
  channelId: string;
}

export function NotificationFeedProvider({
  session,
  children,
}: {
  session: KnockSession | null;
  children: ReactNode;
}) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [state, setState] = useState<FeedStoreState | null>(null);

  useEffect(() => {
    if (!session) return;
    const k = new Knock(session.publicKey);
    k.authenticate(String(session.userId), session.token);
    const f = k.feeds.initialize(session.channelId, { page_size: 30, archived: "exclude" });
    const unsub = f.store.subscribe(setState);
    f.listenForUpdates();
    f.fetch();
    setFeed(f);
    return () => {
      unsub();
      f.dispose();
      k.teardown();
      setFeed(null);
      setState(null);
    };
    // A new token on every loader run would rebuild the socket; key on user only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.userId, session?.publicKey, session?.channelId]);

  return (
    <Ctx.Provider
      value={{
        feed,
        state,
        items: state?.items ?? [],
        unread: state?.metadata.unread_count ?? 0,
        unseen: state?.metadata.unseen_count ?? 0,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

// ─── Shared bits (row content only; each variant owns its layout) ────────────

type D = Record<string, string | number | null | undefined>;
const dataOf = (item: FeedItem) => (item.data ?? {}) as D;
const actorName = (item: FeedItem) =>
  (item.actors[0] as { name?: string } | undefined)?.name ?? "Someone";
const urlOf = (item: FeedItem) => (dataOf(item).url as string) || "/";

function ago(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function knockHtml(item: FeedItem) {
  const b = item.blocks.find((b) => "rendered" in b) as { rendered: string } | undefined;
  return b?.rendered ?? "";
}

const KIND: Record<
  string,
  { icon: typeof Bell; tint: string; area: string; title: (i: FeedItem) => ReactNode; detail?: (i: FeedItem) => ReactNode }
> = {
  "refund-approved": {
    icon: CircleCheck,
    tint: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950",
    area: "Refunds",
    title: (i) => <>Refund approved for <b>{dataOf(i).course_title}</b></>,
    detail: (i) => dataOf(i).decision_note && <q>{dataOf(i).decision_note}</q>,
  },
  "refund-declined": {
    icon: CircleX,
    tint: "text-rose-600 bg-rose-50 dark:bg-rose-950",
    area: "Refunds",
    title: (i) => <>Refund declined for <b>{dataOf(i).course_title}</b></>,
    detail: (i) => (
      <>
        <q>{dataOf(i).decision_note}</q> You can ask again.
      </>
    ),
  },
  "refund-request-opened": {
    icon: Receipt,
    tint: "text-amber-600 bg-amber-50 dark:bg-amber-950",
    area: "Refund Requests",
    title: (i) => (
      <>
        <b>{actorName(i)}</b> asked for a refund of <b>{dataOf(i).amount}</b>
      </>
    ),
    detail: (i) => (
      <>
        {dataOf(i).course_title} · <q>{dataOf(i).reason}</q>
      </>
    ),
  },
  "seat-claimed": {
    icon: UserPlus,
    tint: "text-sky-600 bg-sky-50 dark:bg-sky-950",
    area: "Team",
    title: (i) => (
      <>
        <b>{actorName(i)}</b> claimed a Seat
      </>
    ),
    detail: (i) => (
      <>
        {dataOf(i).course_title} · {dataOf(i).seats_left} of {dataOf(i).seats_total} Seats left
      </>
    ),
  },
  "new-enrollment": {
    icon: GraduationCap,
    tint: "text-violet-600 bg-violet-50 dark:bg-violet-950",
    area: "Enrollments",
    title: (i) => (
      <>
        <b>{actorName(i)}</b> enrolled in <b>{dataOf(i).course_title}</b>
      </>
    ),
  },
  "discussion-question": {
    icon: MessageCircleQuestion,
    tint: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950",
    area: "Discussions",
    title: (i) => (
      <>
        <b>{actorName(i)}</b> asked a question
      </>
    ),
    detail: (i) => (
      <>
        {dataOf(i).lesson_title} · <q>{dataOf(i).excerpt}</q>
      </>
    ),
  },
  "discussion-reply": {
    icon: MessageSquareReply,
    tint: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950",
    area: "Discussions",
    title: (i) => (
      <>
        <b>{actorName(i)}</b> replied to your question
      </>
    ),
    detail: (i) => (
      <>
        {dataOf(i).lesson_title} · <q>{dataOf(i).excerpt}</q>
      </>
    ),
  },
};
const kindOf = (item: FeedItem) => KIND[item.source.key] ?? KIND["discussion-reply"];

function Badge({ n, className }: { n: number; className?: string }) {
  if (!n) return null;
  return (
    <span
      className={cn(
        "inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground",
        className
      )}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

// ─── Variant A: bell popover in the sidebar header ───────────────────────────

export function VariantASidebarHeader() {
  const { feed, items, unseen, unread } = useNotificationFeed();
  const [open, setOpen] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    if (unseen) feed?.markAllAsSeen();
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const shown = onlyUnread ? items.filter((i) => !i.read_at) : items;

  return (
    <div ref={ref} className="relative ml-auto">
      <button
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
        className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Bell className="size-5" />
        <Badge n={unseen} className="absolute -right-1.5 -top-1" />
      </button>
      {open && (
        <div className="absolute left-full top-0 z-40 ml-3 w-96 rounded-lg border bg-popover text-popover-foreground shadow-xl">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <span className="font-semibold">Notifications</span>
            <label className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
              <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} />
              Unread only
            </label>
            <button
              disabled={!unread}
              onClick={() => feed?.markAllAsRead()}
              className="text-xs text-primary hover:underline disabled:opacity-40"
            >
              Mark all as read
            </button>
          </div>
          <ul className="max-h-[28rem] divide-y overflow-y-auto">
            {shown.length === 0 && (
              <li className="px-4 py-10 text-center text-sm text-muted-foreground">You're all caught up.</li>
            )}
            {shown.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => {
                    feed?.markAsRead(item);
                    setOpen(false);
                    navigate(urlOf(item));
                  }}
                  className={cn(
                    "flex w-full gap-3 px-4 py-3 text-left text-sm hover:bg-muted",
                    !item.read_at && "bg-primary/5"
                  )}
                >
                  <span
                    className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.read_at ? "bg-transparent" : "bg-primary")}
                  />
                  <span className="flex-1">
                    <span
                      className="block [&_p]:inline [&_strong]:font-semibold"
                      dangerouslySetInnerHTML={{ __html: knockHtml(item) }}
                    />
                    <span className="mt-1 block text-xs text-muted-foreground">{ago(item.inserted_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Variant B: "Notifications" nav item + full inbox page ───────────────────

export function VariantBNavItem({ linkClass }: { linkClass: (active: boolean) => string }) {
  const { unread } = useNotificationFeed();
  const { pathname } = useLocation();
  return (
    <Link to="/prototype/notifications" className={linkClass(pathname === "/prototype/notifications")}>
      <Inbox className="size-4" />
      Notifications
      <Badge n={unread} className="ml-auto" />
    </Link>
  );
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

export function VariantBInboxPage() {
  const { feed, items, unread } = useNotificationFeed();
  const [tab, setTab] = useState<"all" | "unread">("all");
  const navigate = useNavigate();

  // Visiting the page counts as seeing everything (B shows UNREAD, not unseen).
  useEffect(() => {
    if (items.some((i) => !i.seen_at)) feed?.markAllAsSeen();
  }, [feed, items]);

  const shown = tab === "unread" ? items.filter((i) => !i.read_at) : items;
  const groups = new Map<string, FeedItem[]>();
  for (const i of shown) {
    const k = dayLabel(i.inserted_at);
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-sm text-muted-foreground">{unread ? `${unread} unread` : "Nothing unread"}</p>
        </div>
        <div className="ml-auto flex rounded-md border p-0.5 text-sm">
          {(["all", "unread"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn("rounded px-3 py-1 capitalize", tab === t && "bg-muted font-medium")}
            >
              {t}
            </button>
          ))}
        </div>
        <button
          disabled={!unread}
          onClick={() => feed?.markAllAsRead()}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-40"
        >
          Mark all as read
        </button>
      </div>

      {shown.length === 0 && (
        <div className="rounded-lg border border-dashed py-16 text-center text-muted-foreground">
          <Inbox className="mx-auto mb-2 size-8" />
          {tab === "unread" ? "No unread Notifications." : "No Notifications yet."}
        </div>
      )}

      {[...groups].map(([day, list]) => (
        <section key={day} className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{day}</h2>
          <ul className="divide-y rounded-lg border">
            {list.map((item) => {
              const k = kindOf(item);
              const Icon = k.icon;
              return (
                <li key={item.id} className="group flex items-start gap-4 p-4 hover:bg-muted/50">
                  <span className={cn("rounded-full p-2", k.tint)}>
                    <Icon className="size-4" />
                  </span>
                  <button
                    className="flex-1 text-left"
                    onClick={() => {
                      feed?.markAsRead(item);
                      navigate(urlOf(item));
                    }}
                  >
                    <div className={cn("text-sm", !item.read_at ? "font-medium" : "text-muted-foreground")}>
                      {k.title(item)}
                    </div>
                    {k.detail && (
                      <div className="mt-1 line-clamp-2 text-sm text-muted-foreground">{k.detail(item)}</div>
                    )}
                    <div className="mt-1 text-xs text-muted-foreground">
                      {k.area} · {ago(item.inserted_at)}
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
                    {!item.read_at && <span className="size-2 rounded-full bg-primary" />}
                    <button
                      onClick={() => (item.read_at ? feed?.markAsUnread(item) : feed?.markAsRead(item))}
                      className="invisible rounded border px-2 py-0.5 text-xs group-hover:visible"
                    >
                      Mark {item.read_at ? "unread" : "read"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ─── Variant C: dot by the avatar + right drawer + live toasts ───────────────

export function VariantCFooterButton() {
  const { feed, items, unread } = useNotificationFeed();
  const [open, setOpen] = useState(false);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const navigate = useNavigate();

  // Toast whenever something lands in real time.
  useEffect(() => {
    if (!feed) return;
    const onNew = ({ items }: { items: FeedItem[] }) => {
      for (const item of items) {
        const k = kindOf(item);
        toast(<span>{k.title(item)}</span>, {
          description: k.area,
          action: { label: "Open", onClick: () => { feed.markAsRead(item); navigate(urlOf(item)); } },
        });
      }
    };
    feed.on("items.received.realtime", onNew as never);
    return () => feed.off("items.received.realtime", onNew as never);
  }, [feed, navigate]);

  function openDrawer() {
    // One state only: opening reads everything. Remember what was new so the
    // drawer can still show a "New" section for this visit.
    setNewIds(new Set(items.filter((i) => !i.read_at).map((i) => i.id)));
    setOpen(true);
    if (unread) feed?.markAllAsRead();
  }

  const fresh = items.filter((i) => newIds.has(i.id));
  const rest = items.filter((i) => !newIds.has(i.id));
  const byArea = new Map<string, FeedItem[]>();
  for (const i of rest) {
    const a = kindOf(i).area;
    byArea.set(a, [...(byArea.get(a) ?? []), i]);
  }

  const Row = ({ item }: { item: FeedItem }) => {
    const k = kindOf(item);
    return (
      <button
        onClick={() => {
          setOpen(false);
          navigate(urlOf(item));
        }}
        className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
      >
        <div>{k.title(item)}</div>
        {k.detail && <div className="line-clamp-1 text-xs text-muted-foreground">{k.detail(item)}</div>}
        <div className="text-[11px] text-muted-foreground">{ago(item.inserted_at)}</div>
      </button>
    );
  };

  return (
    <>
      <button
        onClick={openDrawer}
        title="Notifications"
        className="relative rounded-md p-1 text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        {unread ? <BellDot className="size-4 text-primary" /> : <Bell className="size-4" />}
      </button>
      {open && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={() => setOpen(false)}>
          <aside
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-[26rem] flex-col border-l bg-background shadow-2xl"
          >
            <div className="flex items-center border-b px-5 py-4">
              <h2 className="text-lg font-semibold">Notifications</h2>
              <button onClick={() => setOpen(false)} className="ml-auto rounded p-1 hover:bg-muted">
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto p-3">
              {items.length === 0 && (
                <p className="py-16 text-center text-sm text-muted-foreground">Nothing here yet.</p>
              )}
              {fresh.length > 0 && (
                <section>
                  <h3 className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-primary">
                    New since you last looked
                  </h3>
                  <div className="rounded-lg bg-primary/5 p-1">
                    {fresh.map((i) => (
                      <Row key={i.id} item={i} />
                    ))}
                  </div>
                </section>
              )}
              {[...byArea].map(([area, list]) => (
                <section key={area}>
                  <h3 className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {area}
                  </h3>
                  {list.map((i) => (
                    <Row key={i.id} item={i} />
                  ))}
                </section>
              ))}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

// ─── The prototype switcher (not part of any design) ─────────────────────────

export function PrototypeSwitcher() {
  const [variant, setVariant] = useVariant();
  const { feed, state } = useNotificationFeed();
  const fetcher = useFetcher();
  const idx = KEYS.indexOf(variant);
  const go = (d: number) => setVariant(KEYS[(idx + d + KEYS.length) % KEYS.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (process.env.NODE_ENV === "production") return null;

  const m = state?.metadata;
  const busy = fetcher.state !== "idle";
  return (
    <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 shadow-2xl ring-2 ring-amber-400">
      <div className="flex items-center gap-1">
        <button onClick={() => go(-1)} className="rounded-full p-1 hover:bg-zinc-700">
          <ChevronLeft className="size-4" />
        </button>
        <span className="w-36 text-center font-medium">
          {variant} ({VARIANTS[variant]})
        </span>
        <button onClick={() => go(1)} className="rounded-full p-1 hover:bg-zinc-700">
          <ChevronRight className="size-4" />
        </button>
        <span className="mx-2 h-4 w-px bg-zinc-700" />
        <span className="font-mono text-zinc-400">
          unseen {m?.unseen_count ?? "–"} · unread {m?.unread_count ?? "–"} · total {m?.total_count ?? "–"}
        </span>
        <span className="mx-2 h-4 w-px bg-zinc-700" />
        <fetcher.Form method="post" action="/prototype/notification-feed" className="flex gap-1">
          <button name="intent" value="role" disabled={busy} className="rounded-full px-2 py-1 hover:bg-zinc-700">
            {busy ? "Sending…" : "+ My role's"}
          </button>
          <button name="intent" value="all" disabled={busy} className="rounded-full px-2 py-1 hover:bg-zinc-700">
            + All 7
          </button>
        </fetcher.Form>
        <button
          onClick={() => feed?.markAllAsArchived()}
          className="rounded-full px-2 py-1 text-zinc-400 hover:bg-zinc-700"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
