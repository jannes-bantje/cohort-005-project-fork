import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import Knock, {
  NetworkStatus,
  type Feed,
  type FeedEventPayload,
  type FeedItem,
  type FeedStoreState,
} from "@knocklabs/client";
import { Bell, MessageSquareReply, X, type LucideIcon } from "lucide-react";
import type { NotificationFeedAuth } from "~/lib/knock.server";
import {
  notificationRow,
  unseenBadge,
  type NotificationRow,
  type NotificationRowIcon,
} from "~/lib/notification-rows";
import { POP_UP_LIFETIME_MS, stackPopUps } from "~/lib/notification-pop-ups";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/lib/utils";

// ─── Notification bell ───
// The Notification Feed behind a bell in the sidebar header. It reads the feed
// straight from Knock with @knocklabs/client's headless feed (no Knock React
// components), authenticated with the user token the layout loader signed.
// Rows come from Cadence's own row renderer; Knock's templates are never shown.

// One icon and tint per row icon. Adding a workflow to the trigger data
// contract makes this fail to type-check until it has an icon.
const ICONS: Record<NotificationRowIcon, { Icon: LucideIcon; tint: string }> = {
  "discussion-reply": {
    Icon: MessageSquareReply,
    tint: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300",
  },
  notification: {
    Icon: Bell,
    tint: "bg-muted text-muted-foreground",
  },
};

export function NotificationBell({ auth }: { auth: NotificationFeedAuth }) {
  const { feed, state } = useNotificationFeed(auth);
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { popUps, dismissPopUp, clearPopUps } = useNotificationPopUps(
    feed,
    open
  );

  const items = state?.items ?? [];
  const failed = state?.networkStatus === NetworkStatus.error;
  const loading = !state || (state.loading && items.length === 0);
  // When the feed can't load, the badge hides rather than show a stale count.
  const badge = failed ? null : unseenBadge(state?.metadata.unseen_count ?? 0);
  const anyUnread =
    (state?.metadata.unread_count ?? 0) > 0 ||
    items.some((item) => !item.read_at);
  const shownItems = unreadOnly ? items.filter((item) => !item.read_at) : items;

  /** Refetches the feed, then marks everything seen unless it failed to load. */
  function refresh() {
    if (!feed) return;
    void feed.fetch().then((result) => {
      if (result?.status !== "error") void feed.markAllAsSeen();
    });
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      clearPopUps();
      refresh();
    }
  }

  /** Clicking a row or a pop-up marks it read; its link does the navigating. */
  function markRead(item: FeedItem) {
    if (feed && !item.read_at) void feed.markAsRead(item);
  }

  return (
    <div className="relative ml-auto">
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger
          className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          aria-label={
            badge ? `Notifications (${badge} unseen)` : "Notifications"
          }
        >
          <Bell className="size-5" />
          {badge && (
            <span className="absolute -top-1 -right-1.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-semibold text-primary-foreground">
              {badge}
            </span>
          )}
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={12}
          className="w-96 p-0"
        >
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Notifications</h2>
            <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(event) => setUnreadOnly(event.target.checked)}
                className="accent-primary"
              />
              Unread only
            </label>
            <Button
              variant="link"
              size="xs"
              className="px-0"
              disabled={failed || !anyUnread}
              onClick={() => void feed?.markAllAsRead()}
            >
              Mark all as read
            </Button>
          </div>
          {failed ? (
            <div className="flex flex-col items-center gap-3 px-4 py-8">
              <p className="text-sm text-muted-foreground">
                Couldn't load Notifications
              </p>
              <Button variant="outline" size="sm" onClick={refresh}>
                Retry
              </Button>
            </div>
          ) : loading ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Loading…
            </p>
          ) : shownItems.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              You're all caught up.
            </p>
          ) : (
            <ul className="max-h-[28rem] divide-y overflow-y-auto">
              {shownItems.map((item) => (
                <li key={item.id}>
                  <NotificationRowView
                    row={rowFor(item)}
                    unread={!item.read_at}
                    onClick={() => {
                      markRead(item);
                      setOpen(false);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="border-t px-4 py-2 text-right">
            <Link
              to="/settings#notifications"
              onClick={() => setOpen(false)}
              className="text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              Notification Preferences
            </Link>
          </div>
        </PopoverContent>
      </Popover>
      {!open && popUps.length > 0 && (
        <ol
          aria-live="polite"
          className="absolute top-0 left-full z-40 ml-3 w-80 space-y-2"
        >
          {popUps.map((item) => (
            <li key={item.id}>
              <NotificationPopUp
                row={rowFor(item)}
                onOpen={() => {
                  markRead(item);
                  dismissPopUp(item.id);
                }}
                onDismiss={() => dismissPopUp(item.id)}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * A Notification that arrived while the popover was closed, beside the bell.
 * It goes after about six seconds or on ×, and leaves seen and read state
 * alone. Clicking it opens it like a row.
 */
function NotificationPopUp({
  row,
  onOpen,
  onDismiss,
}: {
  row: NotificationRow;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const timeout = setTimeout(() => dismissRef.current(), POP_UP_LIFETIME_MS);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <div className="flex items-start overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-left-2">
      <div className="min-w-0 flex-1">
        <NotificationRowView row={row} unread onClick={onOpen} />
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        className="m-2 text-muted-foreground"
        aria-label="Close"
        onClick={onDismiss}
      >
        <X />
      </Button>
    </div>
  );
}

function rowFor(item: FeedItem): NotificationRow {
  return notificationRow({
    workflow: item.source.key,
    data: item.data,
    actorName: actorName(item),
    insertedAt: item.inserted_at,
  });
}

function NotificationRowView({
  row,
  unread,
  onClick,
}: {
  row: NotificationRow;
  unread: boolean;
  onClick: () => void;
}) {
  const { Icon, tint } = ICONS[row.icon];
  const className = cn(
    "flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/50",
    unread && "bg-primary/5"
  );
  const content = (
    <>
      <span className={cn("shrink-0 rounded-full p-2", tint)}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-sm",
            unread ? "font-medium" : "text-muted-foreground"
          )}
        >
          {row.title}
        </span>
        {row.details.map((detail) => (
          <span
            key={detail}
            className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground"
          >
            {detail}
          </span>
        ))}
        <span className="mt-1 block text-xs text-muted-foreground">
          {row.time}
        </span>
      </span>
      {unread && (
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary">
          <span className="sr-only">Unread</span>
        </span>
      )}
    </>
  );

  if (row.url) {
    return (
      <Link to={row.url} onClick={onClick} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

function actorName(item: FeedItem): string | null {
  const actor = item.actors[0];
  return actor && "name" in actor && typeof actor.name === "string"
    ? actor.name
    : null;
}

/**
 * The pop-ups beside the bell. Notifications that arrive in real time while
 * the popover is closed stack up, newest first and at most three; the
 * popover being open shows them in the feed instead.
 */
function useNotificationPopUps(feed: Feed | null, open: boolean) {
  const [popUps, setPopUps] = useState<FeedItem[]>([]);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!feed) return;
    function onReceived({ items }: FeedEventPayload) {
      if (!openRef.current) setPopUps((showing) => stackPopUps(showing, items));
    }
    feed.on("items.received.realtime", onReceived);
    return () => {
      feed.off("items.received.realtime", onReceived);
      setPopUps([]);
    };
  }, [feed]);

  return {
    popUps,
    dismissPopUp: (id: string) =>
      setPopUps((showing) => showing.filter((item) => item.id !== id)),
    clearPopUps: () => setPopUps([]),
  };
}

/**
 * Connects to the user's Notification Feed and keeps it live with
 * `listenForUpdates()`. The connection is rebuilt only when the user, key or
 * channel changes; a renewed token re-authenticates the same client, so the
 * socket isn't torn down every time the layout loader runs.
 */
function useNotificationFeed({
  userId,
  token,
  publicApiKey,
  feedChannelId,
}: NotificationFeedAuth) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [state, setState] = useState<FeedStoreState | null>(null);
  const knockRef = useRef<Knock | null>(null);
  const tokenRef = useRef(token);

  useEffect(() => {
    const knock = new Knock(publicApiKey);
    knock.authenticate({ id: userId }, tokenRef.current, {
      identificationStrategy: "skip",
    });
    const userFeed = knock.feeds.initialize(feedChannelId, {
      page_size: 30,
      archived: "exclude",
    });
    const unsubscribe = userFeed.store.subscribe(setState);
    userFeed.listenForUpdates();
    void userFeed.fetch();
    knockRef.current = knock;
    setFeed(userFeed);

    return () => {
      unsubscribe();
      userFeed.dispose();
      knock.teardown();
      knockRef.current = null;
      setFeed(null);
      setState(null);
    };
  }, [userId, publicApiKey, feedChannelId]);

  useEffect(() => {
    tokenRef.current = token;
    const knock = knockRef.current;
    if (knock && knock.userToken !== token) {
      knock.authenticate({ id: userId }, token, {
        identificationStrategy: "skip",
      });
    }
  }, [userId, token]);

  return { feed, state };
}
