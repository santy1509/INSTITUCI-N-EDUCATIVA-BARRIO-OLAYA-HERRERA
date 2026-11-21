(() => {
  window.Auth = {
    signIn(email, password) {
      return auth.signInWithEmailAndPassword(email.trim().toLowerCase(), password);
    },

    signOut() {
      return auth.signOut();
    },

    onChange(callback) {
      return auth.onAuthStateChanged(callback);
    },

    currentUser() {
      return auth.currentUser;
    },

    async getProfile(uid) {
      const snap = await db.collection("usuarios").doc(uid).get();
      return snap.exists ? { uid: snap.id, ...snap.data() } : null;
    },

    async createUser(email, password, nombre, rol) {
      const created = await FirebaseService.createAuthUser(email, password);
      const profile = {
        uid: created.uid,
        nombre: nombre.trim(),
        correo: created.email,
        rol,
        activo: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      await db.collection("usuarios").doc(created.uid).set(profile);
      return { ...profile, uid: created.uid };
    }
  };
})();
