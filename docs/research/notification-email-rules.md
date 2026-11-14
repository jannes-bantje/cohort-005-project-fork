# Rules for Notification and Nudge emails

- **Researched:** 2026-11-14
- **Disclaimer:** This is a summary of published rules and guidance, not legal advice, and it makes no design decisions.
- **How the sources were read:** The sandbox firewall blocked direct fetches of every primary domain (support.google.com, ftc.gov, ico.org.uk, postmarkapp.com and the rest returned "Approval required"). I read the pages through search-engine extracts limited to each primary domain. Short quotes below come from those extracts or from statutory text. Before relying on exact wording, spot-check it against the live page. Anything I could not pin to a primary page is marked **unverified**.

## Question

Cadence already sends transactional receipts through Postmark (`MessageStream: "outbound"`, From `hello@cadence.dev`). It plans to add **Notifications**, sent because something happened (instructor reply, new lesson, new comment, new Refund Request to staff), and **Nudges**, sent because a Student *hasn't* done something ("you haven't watched in 7 days"). Which mailbox-provider rules, US and EU/UK laws, and Postmark policies constrain these emails?

## TL;DR

- **Gmail bulk-sender status is per primary domain and permanent.** Gmail treats you as a bulk sender once you send roughly 5,000+ messages in 24 hours to personal Gmail accounts. All mail from the same primary domain counts, subdomains included. Once you hit the threshold, the status "doesn't expire" ([Gmail FAQ](https://support.google.com/mail/answer/14229414?hl=en)). Enforcement started Feb 2024 and Google is "ramping up its enforcement on non-compliant traffic" from **November 2025**, including "temporary and permanent rejections" ([Gmail FAQ](https://support.google.com/a/answer/14229414?hl=en)).
- **Bulk senders need SPF, DKIM and DMARC, with the From domain aligned to one of them.** DMARC can be `p=none`, and either SPF or DKIM must align with the From domain (Gmail, Yahoo). Microsoft has required the same for Outlook.com consumer addresses from senders of 5,000+/day since **May 5, 2025** ([Microsoft](https://techcommunity.microsoft.com/blog/microsoftdefenderforoffice365blog/strengthening-email-ecosystem-outlook%E2%80%99s-new-requirements-for-high%E2%80%90volume-senders/4399730)).
- **One-click unsubscribe (RFC 8058 headers) is required only for marketing/promotional ("subscribed") mail from bulk senders.** Google: "Transactional messages are excluded from this requirement." Yahoo says the same. Unsubscribes must be honored within **2 days / 48 hours**.
- **Google also says "some notification messages" can be subscription messages.** It adds that "Message recipients, not Google, determine the nature of the messages that they receive." So whether Cadence's notifications need one-click is not settled by the label "notification" ([Gmail subscription guidelines](https://support.google.com/mail/answer/15263077?hl=en)).
- **Spam-rate limits apply to all of the domain's mail, not just marketing.** Gmail wants user-reported spam below **0.1%** and never at **0.3%** or above. Above 0.3% you are ineligible for mitigation until you have spent 7 consecutive days below it. Postmaster Tools measures this daily, for DKIM-authenticated mail that reached the inbox.
- **CAN-SPAM (US) only regulates *commercial* email, and it is opt-out, not opt-in.** A message made up only of "transactional or relationship" content is exempt from most of the Act. The five statutory categories include "notification concerning a change in the terms or features of" an ongoing relationship and delivering "product updates or upgrades, that the recipient is entitled to receive under the terms of a transaction" ([15 USC 7702(17)](https://www.law.cornell.edu/uscode/text/15/7702)). Commercial mail needs an opt-out honored within **10 business days**, plus a physical postal address.
- **EU/UK (ePrivacy Art. 13, PECR reg. 22) require consent for email marketing,** unless the "soft opt-in" applies: an existing customer, your own "similar products and services", and an opt-out offered at collection *and in every message*. Under GDPR Art. 21(2)/(3), an objection to direct marketing is absolute.
- **The ICO's test points toward Nudges being marketing.** Its guidance says a message that "actively promotes or encourages people to make use of a particular service, special offer, or upgrade" is "likely to be direct marketing". Neutral, informative messages about an existing account are "service messages". Neither the ICO nor the EU sources I found address re-engagement emails about a service the person **already paid for**, so the Nudge's status is unresolved.
- **UK DUAA 2025 (in force in phases, June 2025 to June 2026):** PECR fines rose to up to **£17.5m or 4% of global turnover**. A charity soft opt-in (reg. 22(3A)) took effect **5 Feb 2026** but does not apply to Cadence. The direct-marketing definition moved into PECR ([ICO](https://ico.org.uk/about-the-ico/what-we-do/legislation-we-cover/data-use-and-access-act-2025/the-data-use-and-access-act-2025-duaa-summary-of-the-changes/privacy-and-electronic-communications)).
- **Postmark separates streams by message type.** Transactional streams are for one-to-one, user-triggered mail, and its examples include "comment notifications". Broadcast streams are for the same content sent to many people ("product update announcements", newsletters, promotions, ToS updates). The two use separate infrastructure. Promotional mail detected on a transactional stream gets sending "paused". Broadcast streams add an unsubscribe link and RFC 8058 headers automatically. Suppressions are per stream.

## 1. Mailbox-provider rules (Gmail, Yahoo, Microsoft)

### Who counts as a bulk sender

- **Gmail:** a sender of roughly 5,000+ messages in 24 hours **to personal Gmail accounts** (@gmail.com / @googlemail.com). Messages "sent from the same primary domain" count together, so 2,500 from `solarmora.com` plus 2,500 from `promotions.solarmora.com` makes the domain a bulk sender. "Senders who meet the criteria at least once are permanently considered bulk senders" ([Gmail FAQ](https://support.google.com/mail/answer/14229414?hl=en)).
- **Gmail scope:** the guidelines "don't apply to messages sent to Google Workspace accounts". They apply only when sending to personal Gmail accounts ([Gmail FAQ](https://support.google.com/mail/answer/14229414?hl=en)).
- **Yahoo** publishes no number. A bulk sender is one "sending a significant volume of mail", judged at the authenticated-domain or From-domain level ([Yahoo FAQ](https://senders.yahooinc.com/faqs/)).
- **Microsoft (Outlook.com, Hotmail, Live):** domains sending more than 5,000 emails a day must pass SPF and DKIM and have DMARC (at least `p=none`) aligned with one of them. The announcement was dated April 2025, and from **May 5, 2025** non-compliant mail is affected ([Microsoft Tech Community](https://techcommunity.microsoft.com/blog/microsoftdefenderforoffice365blog/strengthening-email-ecosystem-outlook%E2%80%99s-new-requirements-for-high%E2%80%90volume-senders/4399730)). The rejection text is `550; 5.7.515 Access denied, sending domain [SendingDomain] does not meet the required authentication level.` **Unverified:** the extracts conflict on whether May 5 meant routing to Junk (with rejection "date to be announced") or outright rejection, so check the post's update note. Microsoft *recommends* a "functional unsubscribe link" for marketing or bulk mail but does not require it.

### Authentication and alignment

- **Gmail bulk senders:** SPF and DKIM, plus a DMARC record (`p=none` is the minimum). Alignment means "the organisational domain in the sender From: header must be aligned with either the SPF organisational domain or the DKIM organisational domain" ([Gmail FAQ](https://support.google.com/a/answer/14229414?hl=en); [guidelines](https://support.google.com/mail/answer/81126?hl=en)).
- **Yahoo bulk senders:** both SPF and DKIM, and DMARC at least `p=none` that passes, with alignment ([Yahoo best practices](https://senders.yahooinc.com/best-practices/)).

### One-click unsubscribe

- **Gmail guidelines:** bulk senders' "marketing messages and subscribed messages must support one-click unsubscribe" and include "a clearly visible unsubscribe link in the message body" ([guidelines](https://support.google.com/mail/answer/81126?hl=en)).
- **Gmail FAQ on the transactional exemption:** "One-click unsubscribe is required only for marketing and promotional messages. Transactional messages are excluded from this requirement." It also says: "The distinction between promotional and transactional messages can vary depending on industry and applicable regulations. Message recipients, not Google, determine the nature of the messages that they receive" ([Gmail FAQ](https://support.google.com/a/answer/14229414?hl=en)).
- **Gmail subscription guidelines:** a subscription message is mail to a list the recipient can unsubscribe from. Marketing is the usual case, "but newsletters and some notification messages" also count. Examples of **non**-subscription messages are "password resets, purchase receipts, and one-time passwords (OTPs)". Google also recommends sending subscription and non-subscription mail from **different From addresses** ([Gmail subscription guidelines](https://support.google.com/mail/answer/15263077?hl=en)).
- **Yahoo:** "only required for promotional/marketing messages", not transactional mail "like order confirmations and password resets". Yahoo suggests adding one-click to transactional mail if complaint rates are high. A body link alone is not enough ([Yahoo FAQ](https://senders.yahooinc.com/faqs/)).
- **Mechanism:** a `List-Unsubscribe` header with an HTTPS URI, plus `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. Both headers must be covered by a valid DKIM signature (listed in `h=`), or receivers "SHOULD NOT" offer one-click. The endpoint must not answer the POST with a redirect ([RFC 8058](https://www.rfc-editor.org/rfc/rfc8058.txt)). Gmail says mailto links and body URL links alone "don't meet our one-click unsubscribe requirement".
- **Deadline:** Gmail says honor unsubscribes within 48 hours. Yahoo says "within 2 days".
- **Dates:** the requirements started 1 Feb 2024. One-click enforcement started June 2024 (Yahoo FAQ; Gmail FAQ).

### Spam-rate thresholds

- Gmail: keep the user-reported spam rate "below 0.1%" and prevent it "from reaching 0.3% or higher". Since June 2024, bulk senders above 0.3% have been ineligible for mitigation. They become eligible again after 7 consecutive days below 0.3% ([Gmail FAQ](https://support.google.com/a/answer/14229414?hl=en)).
- Measurement: [Postmaster Tools](https://support.google.com/mail/answer/14668346?hl=en) calculates the rate daily, for DKIM-authenticated mail (SPF if there is no DKIM). The denominator is mail delivered to the inbox. Its compliance-status dashboard covers primary domains and updates within about 24 hours.
- Yahoo: keep the spam rate "below 0.3%". Yahoo calculates it on inbox-delivered mail, so your own numbers may differ ([Yahoo best practices](https://senders.yahooinc.com/best-practices/)).
- **Implication from the sources:** the rate covers all mail from the domain, including notifications that people did not want.

## 2. CAN-SPAM (US, FTC)

- **Scope.** CAN-SPAM regulates "commercial electronic mail messages", meaning those whose primary purpose is "the commercial advertisement or promotion of a commercial product or service". A "transactional or relationship message" is excluded from that definition ([15 USC 7702](https://www.law.cornell.edu/uscode/text/15/7702)). The FTC guide splits content into commercial, transactional/relationship, and "other". A message containing only transactional/relationship content is exempt from most provisions, but it still cannot carry false or misleading routing information ([FTC compliance guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)). The Act sets no prior-consent requirement. It requires an opt-out for commercial mail.
- **The five transactional/relationship categories** ([15 USC 7702(17)(A)](https://www.law.cornell.edu/uscode/text/15/7702)). The primary purpose must be:
  1. "to facilitate, complete, or confirm a commercial transaction that the recipient has previously agreed to enter into with the sender";
  2. warranty, product recall, or safety/security information about a product or service used or purchased;
  3. "notification concerning a change in the terms or features of", a change in the recipient's standing or status in, or periodic account statements for "a subscription, membership, account, loan, or comparable ongoing commercial relationship";
  4. information about an employment relationship or benefit plan the recipient is in;
  5. "to deliver goods or services, including product updates or upgrades, that the recipient is entitled to receive under the terms of a transaction that the recipient has previously agreed to enter into with the sender."

  The FTC says these categories are read narrowly ([FTC guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)).
- **Primary-purpose test for mixed messages** ([16 CFR 316.3](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-316/section-316.3)):
  - If a message mixes commercial and transactional content, it is commercial when a recipient "reasonably interpreting the subject line" would expect an ad, **or** when the transactional content does not appear "in whole or in substantial part, at the beginning of the body".
  - If it mixes commercial and "other" content, the test is the subject line or the body as a whole. Placement, proportion, and visual emphasis all count.
  - A message is transactional if it "consists exclusively of transactional or relationship content".
- **Requirements for commercial mail** ([FTC guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)):
  - no false header information and no deceptive subject line;
  - identify the message as an ad;
  - include a valid physical postal address;
  - give a clear opt-out that works for at least 30 days after sending;
  - honor opt-outs "within 10 business days", charging no fee and requiring nothing beyond a reply email or a visit to a single web page.

  Penalties are per email. The guide's indexed figure is up to $53,088 (**unverified for 2026**, because it is inflation-adjusted).
- **Relevant enforcement:** in *U.S. v. Experian Consumer Services* (Aug 2023), the FTC alleged that promotional emails sent to account holders, presented alongside account information, lacked an opt-out. The settlement was a $650,000 penalty ([FTC press release](https://www.ftc.gov/news-events/news/press-releases/2023/08/ftc-charges-experian-spamming-consumers-who-signed-company-accounts-marketing-emails-they-couldnt)). It shows that account-style emails with promotional content get treated as commercial.

## 3. GDPR / ePrivacy / UK PECR

- **ePrivacy Directive Art. 13(1)–(2)** ([2002/58/EC](https://eur-lex.europa.eu/eli/dir/2002/58)):
  - Email "for the purposes of direct marketing" needs the recipient's prior consent.
  - Exception (soft opt-in): where a business obtained a customer's email "in the context of the sale of a product or a service", it may use it "for direct marketing of its own similar products or services". Customers must be given the chance to object, "free of charge and in an easy manner", "at the time of their collection and on the occasion of each message".
  - The CJEU (C-654/23 *Inteligo Media*, 2024) held that a free account giving access to content can count as a "sale". It also held that where 13(2) applies, GDPR Art. 6(1) conditions do not additionally apply ([judgment](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX%3A62023CJ0654)).
  - The Directive does not define "direct marketing". The proposed ePrivacy Regulation was **withdrawn** (notice published in the OJ on 6 Oct 2025), so the Directive and national laws still apply ([EP legislative train](https://www.europarl.europa.eu/legislative-train/theme-a-europe-fit-for-the-digital-age/file-jd-e-privacy-reform)).
- **UK PECR reg. 22:**
  - Electronic mail marketing to individuals needs consent unless the soft opt-in applies. The conditions: details obtained "in the course of the sale or negotiations for the sale", only for "similar products and services", and a simple opt-out at collection and "at the time of each subsequent communication".
  - The ICO says an opt-out "hidden within your privacy policy" is not enough ([ICO e-mail marketing guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-direct-marketing-using-electronic-mail/how-do-we-comply-with-the-pecr-electronic-mail-marketing-rules/)).
  - **DUAA 2025 changes:**
    - the direct-marketing definition moved into PECR;
    - charities got their own soft opt-in (reg. 22(3A)) from **5 Feb 2026**;
    - PECR fines rose to "£17.5 million or 4% of global turnover".

    All stages were in force by June 2026 ([ICO DUAA summary](https://ico.org.uk/about-the-ico/what-we-do/legislation-we-cover/data-use-and-access-act-2025/the-data-use-and-access-act-2025-duaa-summary-of-the-changes/privacy-and-electronic-communications); [ICO charity soft opt-in](https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/2026/04/charities-given-new-flexibility-to-contact-supporters-under-data-law-change/); [ICO commencement statement](https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/2026/02/statement-on-the-commencement-of-the-data-use-and-access-act-duaa/)).
- **What the ICO treats as direct marketing** ([Identify direct marketing](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/direct-marketing-guidance/identify-direct-marketing/)):
  - The definition is broad. It covers commercial marketing **and** the "promotion of aims and ideals", such as fundraising and campaigning.
  - Routine customer-service messages are not marketing. Examples are service interruptions, delivery arrangements, product safety, and changes to terms, where they concern an existing contract. General branding in them does not make them marketing.
  - The rules **do** apply if a service message includes promotional material, "even if that is not the main purpose of the message".
  - The key line: "If you want to send a message that actively promotes or encourages people to make use of a particular service, special offer, or upgrade, then it is likely to be direct marketing." By contrast, a message with "a neutral tone that simply gives information they need as part of the relationship is more likely to be a service message".
  - Tone alone does not decide it. "Your local supermarket stocks carrots" is still promotional.
  - The ICO suggests asking whether you want to "influence thought or behaviour or encourage an action".
  - Worked example: a mobile network's data-limit text is a service message, but it becomes marketing if it pushes a data offer.
- **GDPR** ([Regulation 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng)):
  - **Lawful basis for non-marketing notifications** is typically Art. 6(1)(b), contract, or 6(1)(f), legitimate interests. The EDPB says 6(1)(b) covers only processing "objectively necessary" for the contract, not what is merely "useful". Service-improvement processing "usually cannot" rely on it ([EDPB Guidelines 2/2019](https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines-art_6-1-b-adopted_after_public_consultation_en.pdf)).
  - Recital 47 says direct marketing "may be regarded as carried out for a legitimate interest", subject to a balancing test.
  - **Art. 21(2)/(3):** the data subject may object "at any time" to direct-marketing processing, and the data "shall no longer be processed for such purposes". This right has no balancing test, unlike Art. 21(1). Art. 21(4) requires the right to be brought to the person's attention by the first communication at the latest.
- **Re-engagement emails about a service already paid for:** I found **no** ICO, EDPB or EU text that addresses this case directly. The ICO's "encourages people to make use of a particular service" sentence points toward marketing. Its "information they need as part of the relationship" sentence points toward a service message. The sources do not resolve it.

## 4. Postmark message streams

- **Stream types and IDs:** there are three types: Transactional, Broadcasts and Inbound. A server can have up to 10 streams. The API field `MessageStream` sets the stream, and if it is omitted the message goes to the default transactional stream `"outbound"`. A broadcast stream's ID is chosen when the stream is created, e.g. `broadcasts`, and it cannot be changed afterward. SMTP uses `smtp-broadcasts.postmarkapp.com` and the `X-PM-Message-Stream` header ([Email API](https://postmarkapp.com/developer/api/email-api); [Message Streams API](https://postmarkapp.com/developer/api/message-streams-api)).
- **What goes where:**
  - Transactional means one-to-one messages "the recipient is expecting", "usually triggered by the user". Examples: welcome emails, password resets, "comment notifications", weekly digests, "opted-in individual alerts", "account notifications".
  - Broadcast means the same content to many recipients: "product update announcements", newsletters, promotions, terms-of-service updates.
  - Postmark: "multiple recipients receiving the same content that isn't triggered by an event is considered bulk, marketing, or promotional email" ([What types of messages are a good fit](https://postmarkapp.com/support/article/1082-what-types-of-messages-are-a-good-fit-for-postmark); [What are transactional emails](https://postmarkapp.com/support/article/804-what-are-transactional-emails)).
  - A Postmark *blog* post (not a policy page) says inaction can trigger transactional mail, e.g. a trial-ending notice.
  - The Batch API can carry transactional mail. The Bulk API must use broadcast.
- **Mixing:** transactional and broadcast traffic do not share infrastructure, including IP ranges. "If we detect promotional email being sent through a Transactional Stream, your sending will be paused" ([Message Streams](https://postmarkapp.com/message-streams); [Postmark blog](https://postmarkapp.com/blog/send-promotional-email-with-postmark-message-streams)).
- **Broadcast unsubscribe handling:**
  - Every broadcast message must have an unsubscribe link. By default Postmark appends one, and it adds RFC 8058-compliant `List-Unsubscribe` and `List-Unsubscribe-Post` headers. You cannot edit those headers while Postmark manages unsubscribes.
  - Managing your own unsubscribes requires Postmark's approval, and you must then supply both the body link and the headers ([List-Unsubscribe article](https://postmarkapp.com/support/article/1299-how-to-include-a-list-unsubscribe-header); [Unsubscribe link article](https://postmarkapp.com/support/article/1208-how-to-add-an-unsubscribe-link)).
- **Transactional streams and headers:** unsubscribe links and headers are "not *required*", but if you add your own `List-Unsubscribe` headers through the API `Headers` array, "Postmark will include them". Unsubscribe management on transactional streams defaults to None, so your app must handle suppression itself ([List-Unsubscribe article](https://postmarkapp.com/support/article/1299-how-to-include-a-list-unsubscribe-header)).
- **Suppressions:**
  - Suppressions are scoped **per stream**, and an unsubscribe removes the person only from that stream.
  - Addresses are suppressed automatically on hard bounce, spam complaint or unsubscribe. SpamComplaint suppressions cannot be deleted.
  - The API path is `/message-streams/{stream_id}/suppressions`. A Subscription Change webhook reports changes, including `MessageStream` ([Suppressions API](https://postmarkapp.com/developer/api/suppressions-api)).
- **Broadcast approval and content rules:** broadcast sending requires a request for approval. Postmark's guidance asks for explicit opt-in "for that specific message(s)" within the past three months, a spam complaint rate below 0.1%, and a bounce rate below 10% ([Best practices for broadcast sending](https://postmarkapp.com/guides/best-practices-for-broadcast-sending); [Can I send bulk emails?](https://postmarkapp.com/support/article/can-i-send-bulk-emails)). **Unverified** whether these figures are current.

## How this applies to Cadence's examples

| Example | CAN-SPAM | PECR / ePrivacy | Postmark stream (per docs) | Gmail/Yahoo one-click |
| --- | --- | --- | --- | --- |
| Instructor replied to your question → Student | No promotional content, so not "commercial". It fits "other" content or category (v) delivering a service the student is entitled to. Exempt from the commercial-mail rules if it stays free of promotion. | Neutral information about the person's own activity reads as a **service message**. | **Transactional**: one recipient, event-triggered, matching Postmark's "comment notifications" example. | Not marketing/promotional, so not required by the FAQ. **Open:** Google says "some notification messages" are subscription messages and recipients decide. |
| New lesson added to your course → enrolled Students | Possibly category (v), "product updates or upgrades… entitled to receive", or (iii) "change in the terms or features". This depends on whether the purchase entitles students to added lessons. It becomes commercial if promotional content leads. **Open.** | A neutral "new content is available" message reads as a service message. Wording that "encourages people to make use of" it moves toward marketing (ICO). **Open.** | **Ambiguous.** The same content goes to many recipients, which resembles Postmark's "product update announcements" (broadcast). But it is triggered by an event, and each message is per-recipient, which resembles notifications (transactional). **Open.** | Not required if transactional. **Open** for the same reason as row 1. |
| New comment on your lesson → Instructor | Not commercial: it is service information to a user of the platform. | Service message. | **Transactional** ("comment notifications"). | Not required (not marketing). |
| New Refund Request → Platform Admin (staff) | Not commercial. Arguably category (iv), the employment relationship, but no source addresses internal alerts specifically. | Not direct marketing: it is internal operational mail, and no source treats staff alerts as marketing. | **Transactional**: one-to-one and event-triggered. Postmark draws no internal/external distinction. | Gmail rules "don't apply to messages sent to Google Workspace accounts", and only mail to personal Gmail counts toward the 5,000. **Open:** what staff mailboxes are hosted on. |
| Nudge: "you haven't watched in 7 days" → Student | It does not clearly fit any of the five categories. It promotes use of a service already bought rather than a new purchase, and the FTC reads the categories narrowly. Commercial versus "other" is **open**. | The ICO's "actively promotes or encourages people to make use of a particular service" sentence points to **direct marketing**. No source addresses already-paid services. **Open.** If it is marketing: the soft opt-in plausibly covers existing customers, with an opt-out at signup and in every message, and the GDPR Art. 21(2) objection becomes absolute. | **Ambiguous.** It is one-to-one and triggered by inaction (Postmark's blog accepts inaction triggers), but it is scheduled, similar content to many people. Promotional content on a transactional stream risks having sending paused. **Open.** | Required **if** it is marketing/promotional **and** Cadence is a bulk sender. Recipients decide. **Open.** |

Two cross-cutting points from the sources:

- All five types count toward Gmail's spam rate and toward the domain's permanent bulk-sender status, because both are tracked per primary domain.
- Google recommends separate From addresses for subscription and non-subscription mail. Cadence currently sends everything from `hello@cadence.dev`.

## Open questions for a human

1. Has `cadence.dev` (or any subdomain) ever sent 5,000+ messages in a day to personal Gmail accounts? If so, it is permanently a Gmail bulk sender. Projected volume matters for Microsoft as well.
2. Is DMARC published for `cadence.dev`, and does Postmark sign DKIM with the `cadence.dev` domain (alignment)?
3. Which jurisdictions do Cadence's Students and Instructors live in (US, EU, UK)? This determines whether PECR/ePrivacy apply at all.
4. Is the "you haven't watched in 7 days" Nudge direct marketing under PECR/ePrivacy, and commercial under CAN-SPAM? The sources point both ways. This needs a human or legal decision, and the email's wording affects the answer.
5. Do course purchase terms entitle Students to lessons added later? That decides whether category (v) can cover "new lesson" emails under CAN-SPAM.
6. Does Postmark consider "new lesson" fan-out mail and scheduled Nudges acceptable on a transactional stream, or do they require broadcast? Ask Postmark support. The docs don't settle either case.
7. Should non-marketing Notifications carry `List-Unsubscribe` headers anyway? Google says "some notification messages" are subscription mail, and Yahoo suggests it when complaints are high. On transactional streams Postmark would leave suppression to Cadence.
8. If anything goes through a broadcast stream, does Cadence have the opt-in Postmark asks for ("explicitly opted-in for that specific message(s), within the past 3 months")?
9. Are Platform Admin mailboxes on Google Workspace or on consumer providers? That affects whether provider rules apply to them at all.
10. **Unverified items to spot-check on the live pages:**
    - Microsoft's May 2025 action (Junk or reject);
    - the current CAN-SPAM per-email penalty;
    - the current Postmark broadcast thresholds;
    - exact quote wording in general, since the pages were read via search extracts.

## Sources

- Google: [Email sender guidelines](https://support.google.com/mail/answer/81126?hl=en) · [Sender guidelines FAQ](https://support.google.com/a/answer/14229414?hl=en) · [Email subscription guidelines](https://support.google.com/mail/answer/15263077?hl=en) · [Postmaster Tools dashboards](https://support.google.com/mail/answer/14668346?hl=en)
- Yahoo: [Sender best practices](https://senders.yahooinc.com/best-practices/) · [FAQs](https://senders.yahooinc.com/faqs/)
- Microsoft: [Outlook's new requirements for high-volume senders](https://techcommunity.microsoft.com/blog/microsoftdefenderforoffice365blog/strengthening-email-ecosystem-outlook%E2%80%99s-new-requirements-for-high%E2%80%90volume-senders/4399730)
- IETF: [RFC 8058](https://www.rfc-editor.org/rfc/rfc8058.txt)
- US: [15 USC 7702](https://www.law.cornell.edu/uscode/text/15/7702) · [16 CFR 316.3](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-316/section-316.3) · [FTC CAN-SPAM compliance guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business) · [FTC v. Experian press release (2023)](https://www.ftc.gov/news-events/news/press-releases/2023/08/ftc-charges-experian-spamming-consumers-who-signed-company-accounts-marketing-emails-they-couldnt)
- EU: [Directive 2002/58/EC](https://eur-lex.europa.eu/eli/dir/2002/58) · [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng) · [CJEU C-654/23](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX%3A62023CJ0654) · [EDPB Guidelines 2/2019](https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines-art_6-1-b-adopted_after_public_consultation_en.pdf) · [EP legislative train: ePrivacy Regulation](https://www.europarl.europa.eu/legislative-train/theme-a-europe-fit-for-the-digital-age/file-jd-e-privacy-reform)
- UK: [ICO: Identify direct marketing](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/direct-marketing-guidance/identify-direct-marketing/) · [ICO: PECR e-mail marketing rules](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-direct-marketing-using-electronic-mail/how-do-we-comply-with-the-pecr-electronic-mail-marketing-rules/) · [ICO: DUAA changes to PECR](https://ico.org.uk/about-the-ico/what-we-do/legislation-we-cover/data-use-and-access-act-2025/the-data-use-and-access-act-2025-duaa-summary-of-the-changes/privacy-and-electronic-communications) · [ICO: DUAA commencement](https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/2026/02/statement-on-the-commencement-of-the-data-use-and-access-act-duaa/) · [ICO: charity soft opt-in](https://ico.org.uk/about-the-ico/media-centre/news-and-blogs/2026/04/charities-given-new-flexibility-to-contact-supporters-under-data-law-change/)
- Postmark: [Message Streams](https://postmarkapp.com/message-streams) · [Good fit for Postmark?](https://postmarkapp.com/support/article/1082-what-types-of-messages-are-a-good-fit-for-postmark) · [What are transactional emails?](https://postmarkapp.com/support/article/804-what-are-transactional-emails) · [List-Unsubscribe header](https://postmarkapp.com/support/article/1299-how-to-include-a-list-unsubscribe-header) · [Unsubscribe link](https://postmarkapp.com/support/article/1208-how-to-add-an-unsubscribe-link) · [Suppressions API](https://postmarkapp.com/developer/api/suppressions-api) · [Email API](https://postmarkapp.com/developer/api/email-api) · [Message Streams API](https://postmarkapp.com/developer/api/message-streams-api) · [Broadcast best practices](https://postmarkapp.com/guides/best-practices-for-broadcast-sending) · [Can I send bulk emails?](https://postmarkapp.com/support/article/can-i-send-bulk-emails) · [Promotional email blog post](https://postmarkapp.com/blog/send-promotional-email-with-postmark-message-streams)
