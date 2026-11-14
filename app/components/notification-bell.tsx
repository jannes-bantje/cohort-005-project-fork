import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import Knock, {
  type Feed,
  type FeedItem,
  type FeedStoreState,
} from "@knocklabs/client";
import {
  Bell,
  MessageSquareReply,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import type { NotificationFeedAuth } from "~/lib/knock.server";
import {
  notificationRow,
  unseenBadge,
  type NotificationRow,
  type NotificationRowIcon,
} from "~/lib/notification-rows";
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
  "open-refund-request": {
    Icon: Receipt,
    tint: "bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-300",
  },
  notification: {
    Icon: Bell,
    tint: "bg-muted text-muted-foreground",
  },
};

export function NotificationBell({ auth }: { auth: NotificationFeedAuth }) {
  const { feed, state } = useNotificationFeed(auth);
  const [open, setOpen] = useState(false);

  const items = state?.items ?? [];
  const badge = unseenBadge(state?.metadata.unseen_count ?? 0);
  const loading = !state || (state.loading && items.length === 0);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next && feed) {
      // Refetch so the popover is current, then mark everything seen.
      void feed.fetch().then(() => feed.markAllAsSeen());
    }
  }

  function onRowClick(item: FeedItem) {
    if (feed && !item.read_at) void feed.markAsRead(item);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        className="relative ml-auto rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        aria-label={badge ? `Notifications (${badge} unseen)` : "Notifications"}
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
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Notifications</h2>
        </div>
        {loading ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        ) : items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            You're all caught up.
          </p>
        ) : (
          <ul className="max-h-[28rem] divide-y overflow-y-auto">
            {items.map((item) => (
              <li key={item.id}>
                <NotificationRowView
                  row={notificationRow({
                    workflow: item.source.key,
                    data: item.data,
                    actorName: actorName(item),
                    insertedAt: item.inserted_at,
                  })}
                  unread={!item.read_at}
                  onClick={() => onRowClick(item)}
                />
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
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
