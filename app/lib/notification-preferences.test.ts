import { describe, expect, it } from "vitest";
import { visibleNotificationPreferences } from "./notification-preferences";
import { UserRole } from "~/db/schema";

describe("visibleNotificationPreferences", () => {
  it("shows a Student only Refund Request decisions and Discussion Replies", () => {
    expect(
      visibleNotificationPreferences({
        role: UserRole.Student,
        ownsTeamLicence: false,
      })
    ).toEqual(["refund-request-decisions", "discussion-replies"]);
  });

  it("adds Open Refund Requests for a Platform Admin", () => {
    expect(
      visibleNotificationPreferences({
        role: UserRole.Admin,
        ownsTeamLicence: false,
      })
    ).toEqual([
      "refund-request-decisions",
      "discussion-replies",
      "open-refund-requests",
    ]);
  });

  it("adds Enrollments and Discussion Questions for an Instructor", () => {
    expect(
      visibleNotificationPreferences({
        role: UserRole.Instructor,
        ownsTeamLicence: false,
      })
    ).toEqual([
      "refund-request-decisions",
      "discussion-replies",
      "enrollments",
      "discussion-questions",
    ]);
  });

  it("adds Claimed Seats for a Student who owns a Team Licence", () => {
    expect(
      visibleNotificationPreferences({
        role: UserRole.Student,
        ownsTeamLicence: true,
      })
    ).toEqual([
      "refund-request-decisions",
      "discussion-replies",
      "claimed-seats",
    ]);
  });

  it("gives an Instructor who owns a Team Licence every switch that applies", () => {
    expect(
      visibleNotificationPreferences({
        role: UserRole.Instructor,
        ownsTeamLicence: true,
      })
    ).toEqual([
      "refund-request-decisions",
      "discussion-replies",
      "claimed-seats",
      "enrollments",
      "discussion-questions",
    ]);
  });

  it("gives a Platform Admin who owns a Team Licence every switch that applies", () => {
    expect(
      visibleNotificationPreferences({
        role: UserRole.Admin,
        ownsTeamLicence: true,
      })
    ).toEqual([
      "refund-request-decisions",
      "discussion-replies",
      "claimed-seats",
      "open-refund-requests",
    ]);
  });
});
