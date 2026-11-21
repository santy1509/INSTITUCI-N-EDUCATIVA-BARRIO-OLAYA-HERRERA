(() => {
  const state = {
    users: [],
    admins: [],
    students: [],
    history: [],
    notices: []
  };

  let unsubscribers = [];
  let started = false;
  let readyPromise = null;

  const notify = () => window.dispatchEvent(new CustomEvent("store:changed"));
  const mapSnapshot = snap => snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  function subscribeCollection(collection, key, transform = value => value) {
    return new Promise((resolve, reject) => {
      let first = true;
      const unsubscribe = db.collection(collection).onSnapshot(snapshot => {
        state[key] = mapSnapshot(snapshot).map(transform);
        if (key === "users") {
          state.admins = state.users.filter(user => user.rol === "admin");
        }
        notify();
        if (first) {
          first = false;
          resolve();
        }
      }, error => {
        console.error(`Error leyendo ${collection}:`, error);
        if (first) {
          first = false;
          reject(error);
        }
        window.dispatchEvent(new CustomEvent("store:error", { detail: error }));
      });
      unsubscribers.push(unsubscribe);
    });
  }

  async function start(role) {
    if (started) return readyPromise;
    started = true;
    const subscriptions = [
      subscribeCollection("estudiantes", "students"),
      subscribeCollection("llegadas", "history"),
      subscribeCollection("avisos", "notices")
    ];
    if (role === "admin") subscriptions.push(subscribeCollection("usuarios", "users"));
    else {
      state.users = [];
      state.admins = [];
    }
    readyPromise = Promise.all(subscriptions);
    try {
      await readyPromise;
      return true;
    } catch (error) {
      started = false;
      throw error;
    }
  }

  function stop() {
    unsubscribers.forEach(unsubscribe => unsubscribe());
    unsubscribers = [];
    started = false;
    readyPromise = null;
    state.users = [];
    state.admins = [];
    state.students = [];
    state.history = [];
    state.notices = [];
    notify();
  }

  function get() {
    return state;
  }

  async function addStudent(student) {
    const normalizeName = value => String(value ?? "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("es-CO").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
    const targetName = normalizeName(student.name);
    const existing = await db.collection("estudiantes").get();
    const duplicate = existing.docs.find(doc => normalizeName(doc.data().name) === targetName);
    if (duplicate) {
      throw new Error(`El estudiante ${student.name} ya está registrado. No se agregó nuevamente.`);
    }
    const ref = db.collection("estudiantes").doc(student.id);
    await ref.set(student);
  }

  async function updateStudent(id, changes) {
    await db.collection("estudiantes").doc(id).update(changes);
  }

  async function addUserProfile(profile) {
    await db.collection("usuarios").doc(profile.uid).set(profile);
  }

  async function updateUser(uid, changes) {
    await db.collection("usuarios").doc(uid).update(changes);
  }

  async function addNotice(notice) {
    await db.collection("avisos").doc(notice.id).set(notice);
  }

  async function updateNotice(id, changes) {
    await db.collection("avisos").doc(id).update(changes);
  }

  async function registerLate(student) {
    const studentRef = db.collection("estudiantes").doc(student.id);
    const arrivalRef = db.collection("llegadas").doc();
    const noticeRef = db.collection("avisos").doc();
    const now = new Date().toISOString();
    const actor = auth.currentUser ? auth.currentUser.uid : null;

    return db.runTransaction(async transaction => {
      const snapshot = await transaction.get(studentRef);
      if (!snapshot.exists) throw new Error("El estudiante ya no existe.");

      const current = snapshot.data();
      if (current.active === false) throw new Error("Este estudiante está retirado.");

      const nextCount = Number(current.lateCount || 0) + 1;
      const createsNotice = nextCount >= 3;
      const arrivalNumber = createsNotice ? 3 : nextCount;

      transaction.set(arrivalRef, {
        studentId: student.id,
        name: current.name,
        group: current.group,
        date: now,
        arrivalNumber,
        createdBy: actor
      });

      transaction.update(studentRef, {
        lateCount: createsNotice ? 0 : nextCount
      });

      if (createsNotice) {
        transaction.set(noticeRef, {
          studentId: student.id,
          name: current.name,
          group: current.group,
          date: now,
          status: "Pendiente",
          createdBy: actor
        });
      }

      return {
        createdNotice: createsNotice,
        count: createsNotice ? 3 : nextCount,
        student: { ...current, id: student.id }
      };
    });
  }

  async function clearHistory() {
    const docs = await db.collection("llegadas").get();
    const list = docs.docs;
    for (let i = 0; i < list.length; i += 450) {
      const batch = db.batch();
      list.slice(i, i + 450).forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
  }

  async function migrateLocalData() {
    const marker = "control_llegadas_firestore_migrated_v1";
    if (localStorage.getItem(marker)) return { migrated: false };

    const raw = localStorage.getItem("control_llegadas_colegio_local_v2");
    if (!raw) {
      localStorage.setItem(marker, "1");
      return { migrated: false };
    }

    let old;
    try {
      old = JSON.parse(raw);
    } catch {
      throw new Error("Los datos locales antiguos no se pudieron leer. No los borres.");
    }

    const collections = [
      ["estudiantes", Array.isArray(old.students) ? old.students : []],
      ["llegadas", Array.isArray(old.history) ? old.history : []],
      ["avisos", Array.isArray(old.notices) ? old.notices : []]
    ];

    let count = 0;
    for (const [collection, records] of collections) {
      for (const record of records) {
        const id = record.id || crypto.randomUUID();
        const ref = db.collection(collection).doc(id);
        const existing = await ref.get();
        if (!existing.exists) {
          const copy = { ...record };
          delete copy.id;
          await ref.set(copy);
          count++;
        }
      }
    }

    // Las cuentas locales antiguas no se migran: sus contraseñas no son cuentas Firebase.
    localStorage.setItem(marker, "1");
    return { migrated: true, count };
  }

  async function restoreData(parsed) {
    const collections = [
      ["estudiantes", parsed.students || []],
      ["llegadas", parsed.history || []],
      ["avisos", parsed.notices || []]
    ];

    for (const [collection, records] of collections) {
      const old = await db.collection(collection).get();
      const oldDocs = old.docs;
      for (let i = 0; i < oldDocs.length; i += 450) {
        const batch = db.batch();
        oldDocs.slice(i, i + 450).forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      }
      for (let i = 0; i < records.length; i += 450) {
        const batch = db.batch();
        records.slice(i, i + 450).forEach(record => {
          const id = record.id || crypto.randomUUID();
          const copy = { ...record };
          delete copy.id;
          batch.set(db.collection(collection).doc(id), copy);
        });
        await batch.commit();
      }
    }
  }

  window.Store = {
    get, start, stop,
    addStudent, updateStudent,
    addUserProfile, updateUser,
    addNotice, updateNotice,
    registerLate, clearHistory,
    migrateLocalData, restoreData
  };
})();
