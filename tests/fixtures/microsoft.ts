import { randomUUID } from "node:crypto";
import { microsoftGateway, type MicrosoftGateway } from "../../src/server/microsoft/gateway";
import { MicrosoftError } from "../../src/server/microsoft/errors";
import type { MicrosoftEvent, MicrosoftRange } from "../../src/server/microsoft/contracts";
export const sampleMicrosoftEvent = (id = "single", changes: Partial<MicrosoftEvent> = {}): MicrosoftEvent => ({ id, subject: "Microsoft test " + id, sensitivity: "normal", type: "singleInstance",
  start: { dateTime: "2026-11-01T05:30:00", timeZone: "UTC" }, end: { dateTime: "2026-11-01T06:30:00", timeZone: "UTC" }, originalStartTimeZone: "Eastern Standard Time", changeKey: "v1", ...changes });
export class FakeMicrosoft implements MicrosoftGateway {
  owner = { address: "outlook-owner@example.test" };
  primary = { id: "primary", name: "Outlook primary", isDefaultCalendar: true, owner: this.owner };
  calendarsData = [this.primary, { id: "secondary", name: "Outlook secondary", isDefaultCalendar: false, owner: this.owner }, { id: "shared", name: "Shared mailbox", isDefaultCalendar: false, owner: { address: "other@example.test" } }];
  source: MicrosoftEvent[] = [sampleMicrosoftEvent()]; delta: MicrosoftEvent[] = [];
  revision = 1; failPage = false; refreshed = 0; subscribed = 0; renewed = 0;
  stopped: string[] = []; calls: { kind: string; link?: string; range: MicrosoftRange }[] = [];
  failures: { events?: MicrosoftError; refresh?: MicrosoftError; subscribe?: MicrosoftError; stop?: MicrosoftError; discover?: MicrosoftError } = {};
  onSubscribe?: (id: string, secret: string) => Promise<void>;
  authorization(state: string, challenge: string, nonce: string) { return microsoftGateway().authorization(state, challenge, nonce); }
  async exchange() { return { accessToken: "TEST_ONLY_ACCESS", refreshToken: "TEST_ONLY_REFRESH", expiresAt: Date.now() + 3600000, scope: "Calendars.Read", idToken: "TEST_ONLY_ID_TOKEN" }; }
  async refresh() { this.refreshed++; if (this.failures.refresh) throw this.failures.refresh; return this.exchange(); }
  async defaultCalendar() { if (this.failures.discover) throw this.failures.discover; return this.primary; }
  async calendars() { return { value: this.calendarsData }; }
  async primaryDelta(_access: string, range: MicrosoftRange, link?: string) {
    this.calls.push({ kind: "delta", range, link });
    if (this.failures.events) throw this.failures.events;
    if (link?.includes("skiptoken") && this.failPage) { this.failPage = false; throw new MicrosoftError("PROVIDER_UNAVAILABLE"); }
    const values = link?.includes("deltatoken") ? this.delta : this.source;
    return !link && values.length > 1 ? { value: values.slice(0, 1), "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendarView/delta?$skiptoken=page2" } :
      { value: link?.includes("skiptoken") ? values.slice(1) : values, "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=" + this.revision };
  }
  async calendarView(_access: string, _id: string, range: MicrosoftRange, link?: string) { this.calls.push({ kind: "snapshot", range, link }); if (this.failures.events) throw this.failures.events; return { value: this.source }; }
  async subscribe(_access: string, _url: string, secret: string) {
    this.subscribed++; if (this.failures.subscribe) throw this.failures.subscribe;
    const id = randomUUID(); if (this.onSubscribe) await this.onSubscribe(id, secret);
    return { id, expirationDateTime: new Date(Date.now() + 86400000).toISOString() };
  }
  async renew(_access: string, id: string) { this.renewed++; return { id, expirationDateTime: new Date(Date.now() + 86400000).toISOString() }; }
  async stop(_access: string, id: string) { this.stopped.push(id); if (this.failures.stop) throw this.failures.stop; }
}
