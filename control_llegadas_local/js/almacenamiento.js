(() => {
  const KEY = "control_llegadas_colegio_local_v2";
  const initial = {
    admins: [],
    students: window.ESTUDIANTES_INICIALES || [],
    history: [],
    notices: []
  };
  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(initial);
      const data = JSON.parse(raw);
      return {
        admins: Array.isArray(data.admins) ? data.admins : [],
        students: Array.isArray(data.students) ? data.students : [],
        history: Array.isArray(data.history) ? data.history : [],
        notices: Array.isArray(data.notices) ? data.notices : []
      };
    } catch {
      alert("No se pudieron leer los datos locales. No borres los datos del navegador.");
      return structuredClone(initial);
    }
  }
  let state = read();
  function save() {
    localStorage.setItem(KEY, JSON.stringify(state));
  }
  window.Store = {
    get: () => state,
    save,
    replace: (next) => { state = next; save(); },
    resetHistory: () => { state.history = []; save(); }
  };
})();
