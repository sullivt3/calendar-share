import { GOOGLE_SCOPES, type GoogleGateway, type GoogleEvent, type GoogleCalendar, type OAuthTokens } from "../../src/server/google/contracts";
import { googleGateway } from "../../src/server/google/gateway";
import { GoogleError } from "../../src/server/google/errors";
export function sampleGoogleEvent(id = "single", changes: Partial<GoogleEvent> = {}): GoogleEvent {
  return { id, summary: "Google sample " + id, status: "confirmed", visibility: "default",
    start: { dateTime: "2026-11-01T01:30:00-04:00", timeZone: "America/New_York" },
    end: { dateTime: "2026-11-01T01:45:00-04:00", timeZone: "America/New_York" },
    description: "Google sample description", location: "Google sample location", etag: "v1", ...changes };
}
export class FakeGoogle implements GoogleGateway {
  subject = "test-google-subject";
  email = "google-owner@example.test";
  access = "TEST_ONLY_ACCESS_TOKEN";
  refreshValue = "TEST_ONLY_REFRESH_TOKEN";
  revision = 1;
  exchanged = 0; refreshed = 0; revoked = 0; watched = 0;
  codeVerifier = "";
  stopped: string[] = [];
  eventCalls: { cursor?: string; page?: string }[] = [];
  instanceCalls: { master: string; start: string; end: string }[] = [];
  calendarsData: GoogleCalendar[] = [
    { id: "primary@example.test", summary: "Google personal", timeZone: "America/New_York", accessRole: "owner" },
    { id: "work@example.test", summary: "Google work", timeZone: "Europe/London", accessRole: "reader" },
    { id: "freebusy@example.test", summary: "Free/busy only", accessRole: "freeBusyReader" },
  ];
  source: GoogleEvent[] = [sampleGoogleEvent()];
  delta: GoogleEvent[] = [];
  series: Record<string, GoogleEvent[]> = {};
  failures: { events?: GoogleError; refresh?: GoogleError; watch?: GoogleError; revoke?: GoogleError; calendars?: GoogleError } = {};
  failSecondPage = false;
  onWatch?: (channel: { id: string; token: string; address: string }, resource: string) => Promise<void>;
  authorization(state: string, challenge: string) { return googleGateway().authorization(state, challenge); }
  tokens(): OAuthTokens { return { accessToken: this.access, refreshToken: this.refreshValue, expiresAt: Date.now() + 3600000, scope: GOOGLE_SCOPES.join(" "), idToken: "TEST_ONLY_ID_TOKEN" }; }
  async exchange(_code: string, verifier: string) { this.exchanged++; this.codeVerifier = verifier; return this.tokens(); }
  async identity() { return { subject: this.subject, email: this.email }; }
  async refresh() { this.refreshed++; if (this.failures.refresh) throw this.failures.refresh; return { ...this.tokens(), accessToken: "TEST_ONLY_REFRESHED_ACCESS" }; }
  async calendars(_token: string, page?: string) {
    if (this.failures.calendars) throw this.failures.calendars;
    return page ? { items: this.calendarsData.slice(2) } : { items: this.calendarsData.slice(0, 2), nextPageToken: "calendar-page-2" };
  }
  async events(_token: string, _calendar: string, cursor?: string, page?: string) {
    this.eventCalls.push({ cursor, page });
    if (this.failures.events) throw this.failures.events;
    if (page && this.failSecondPage) { this.failSecondPage = false; throw new GoogleError("PROVIDER_UNAVAILABLE"); }
    const values = cursor ? this.delta : this.source;
    return !page && values.length > 1 ? { items: values.slice(0, 1), nextPageToken: "events-page-2" } :
      { items: page ? values.slice(1) : values, nextSyncToken: "cursor-" + this.revision };
  }
  async instances(_token: string, _calendar: string, master: string, start: string, end: string) {
    this.instanceCalls.push({ master, start, end });
    return { items: this.series[master] ?? [] };
  }
  async event(_token: string, _calendar: string, id: string) {
    const item = this.source.find(item => item.id === id);
    if (!item) throw new GoogleError("NOT_FOUND");
    return item;
  }
  async watch(_token: string, calendar: string, channel: { id: string; token: string; address: string }) {
    this.watched++;
    if (this.failures.watch) throw this.failures.watch;
    const resource = "resource:" + calendar;
    if (this.onWatch) await this.onWatch(channel, resource);
    return { id: channel.id, resourceId: resource, expiration: String(Date.now() + 86400000) };
  }
  async stop(_token: string, channel: { id: string; resourceId: string }) { this.stopped.push(channel.id); }
  async revoke() { this.revoked++; if (this.failures.revoke) throw this.failures.revoke; }
}
