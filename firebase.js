(() => {
  if (!window.firebase || !window.FIREBASE_CONFIG) {
    throw new Error("No se cargó Firebase. Revisa la conexión y los scripts de index.html.");
  }

  const app = firebase.apps.length
    ? firebase.app()
    : firebase.initializeApp(window.FIREBASE_CONFIG);

  window.firebaseApp = app;
  window.auth = firebase.auth();
  window.db = firebase.firestore();

  // Crea usuarios desde una app secundaria para no cerrar la sesión del administrador.
  window.FirebaseService = {
    async createAuthUser(email, password) {
      const appName = "user-creator";
      let secondary = firebase.apps.find(item => item.name === appName);
      if (!secondary) secondary = firebase.initializeApp(window.FIREBASE_CONFIG, appName);

      const secondaryAuth = secondary.auth();
      try {
        const credential = await secondaryAuth.createUserWithEmailAndPassword(
          email.trim().toLowerCase(),
          password
        );
        return {
          uid: credential.user.uid,
          email: credential.user.email
        };
      } finally {
        await secondaryAuth.signOut().catch(() => {});
      }
    }
  };
})();
