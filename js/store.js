'use strict';
// Histórico de corridas no próprio aparelho (IndexedDB). Na Fase 2 ganha a fila de envio para a nuvem.
const Store = (() => {
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open('passada', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('runs', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction('runs', mode), st = t.objectStore('runs');
      const req = fn(st);
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  }
  return {
    saveRun: run => tx('readwrite', st => st.put(run)),
    getRun: id => tx('readonly', st => st.get(id)),
    deleteRun: id => tx('readwrite', st => st.delete(id)),
    async listRuns() {
      const all = await tx('readonly', st => st.getAll());
      return (all || []).sort((a, b) => b.id - a.id);
    }
  };
})();
