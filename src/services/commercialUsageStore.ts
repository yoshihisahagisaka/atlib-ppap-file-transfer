import type { Period, Reservation, UsageEvent, Notice, DownloadObservation } from '../domain/commercialUsage';

export interface UsageTransaction {
  /** Production adapter uses this same connection, under the organization lock. */
  transferScope?(groupId: string, transferId: string, userId: string): Promise<import('./commercialUsageService').TransferScope | null>;
  commitTransfer?(reservation: Reservation): Promise<void>;
  period(): Promise<Period | null>;
  overlapsOtherPeriod(startsAt: number, endsAt: number): Promise<boolean>;
  savePeriod(period: Period): Promise<void>;
  reservation(id: string): Promise<Reservation | null>;
  saveReservation(value: Reservation): Promise<void>;
  event(id: string): Promise<UsageEvent | null>;
  appendEvent(event: UsageEvent): Promise<void>;
  notice(id: string): Promise<Notice | null>;
  saveNotice(notice: Notice): Promise<void>;
  observation(id: string): Promise<DownloadObservation | null>;
  insertObservation(value: DownloadObservation): Promise<void>;
  windowBytes(window: string): Promise<number>;
}
export interface UsageStore {
  /** Must serialize the entire callback, including a missing period row, and rollback on failure. */
  transaction<T>(organizationId: string, periodId: string, work: (tx: UsageTransaction) => Promise<T>): Promise<T>;
}
