// Test double only. Production must use a persistent UsageStore with database locking.
class MemoryUsageStore {
  constructor() { this.data = new Map(); this.locks = new Map(); this.failNextEvent = false; }
  async transaction(org, period, work) {
    const before = this.locks.get(org) || Promise.resolve(); let unlock;
    const current = new Promise(resolve => { unlock = resolve; }); this.locks.set(org, current);
    await before;
    const key = `${org}/${period}`;
    const data = structuredClone(this.data.get(key) || { period: null, reservations: {}, events: {}, notices: {}, observations: {} });
    const scope = value => { if (value.organizationId !== org || value.periodId !== period) throw Error('scope mismatch'); };
    const copy = v => v == null ? null : structuredClone(v);
    const tx = {
      overlapsOtherPeriod: async (start,end) => [...this.data.entries()].some(([k,v]) => k !== key && k.startsWith(org+'/') && v.period && v.period.startsAt < end && v.period.endsAt > start),
      period: async () => copy(data.period), savePeriod: async p => { scope(p); data.period = copy(p); },
      reservation: async id => copy(data.reservations[id]),
      saveReservation: async r => {
        scope(r);
        for (const [otherKey, other] of [...this.data.entries(), [key, data]]) {
          for (const old of Object.values(other.reservations)) {
            if (otherKey === key && old.id === r.id) continue;
            if (old.objectName === r.objectName || (old.organizationId === org && old.transferId === r.transferId)) throw Error('TRANSFER_ALREADY_RESERVED');
          }
        }
        data.reservations[r.id] = copy(r);
      },
      event: async id => copy(data.events[id]), appendEvent: async e => {
        if (this.failNextEvent) { this.failNextEvent = false; throw Error('simulated DB failure'); }
        if (data.events[e.id]) throw Error('duplicate event'); data.events[e.id] = copy(e);
      },
      notice: async id => copy(data.notices[id]), saveNotice: async n => { data.notices[n.id] = copy(n); },
      observation: async id => copy(data.observations[id]), insertObservation: async o => { scope(o); data.observations[o.id] = copy(o); },
      windowBytes: async key => Object.values(data.observations).filter(o => `${o.kind}:${Math.floor(o.at / data.period.plan.downloadWindowMs)}` === key).reduce((n, o) => n + o.bytes, 0),
    };
    try { const result = await work(tx); this.data.set(key, data); return copy(result); }
    finally { unlock(); if (this.locks.get(org) === current) this.locks.delete(org); }
  }
}
module.exports = { MemoryUsageStore };
