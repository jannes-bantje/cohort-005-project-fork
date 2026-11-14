# Notifications live only in Knock

Cadence keeps no table of Notifications. A Notification exists only as a Knock message, and Knock owns whether it was seen or read and every Notification Preference. Cadence's database owns the facts a Notification is about (Refund Requests, Discussion Replies, Enrollments, Claimed Seats) and works out who receives it when the trigger fires, but it never copies Knock's state back. Knock keeps in-app feed items indefinitely, so a local copy would only buy an audit trail, a retry outbox or a "was this already sent?" check, and no v1 feature needs any of those.

## Considered Options

- **Audit trail table.** Rejected: nothing in Cadence reads it, and Knock's dashboard logs every workflow run for debugging.
- **Outbox table drained by a worker.** Rejected: Cadence has no job runner to drain it. Trigger failures are handled in the request instead.
- **Local record to stop duplicates.** Rejected: an idempotency key on the Knock trigger stops repeated sends, and each domain fact (a decided Refund Request, a posted Discussion Reply) happens only once.

## Consequences

Anything that later acts on Notifications already sent, such as clearing the other Platform Admins' Open Refund Request Notifications, has to find them through Knock's API by trigger `data` or workflow, not through a list of message ids. Knock's general messages API only reaches back 30 days on the free plan, even though feed items stay forever. A Notifications table added later would start empty, because the history lives only in Knock.
