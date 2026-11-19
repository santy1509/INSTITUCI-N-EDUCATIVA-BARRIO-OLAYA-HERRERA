(() => {
  const bytesToHex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2,"0")).join("");
  async function hash(password, salt) {
    const data = new TextEncoder().encode(`${salt}:${password}`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return bytesToHex(digest);
  }
  function makeSalt() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return bytesToHex(bytes);
  }
  window.Auth = {
    async create(name, username, password) {
      const salt = makeSalt();
      return { id: crypto.randomUUID(), name, username: username.trim().toLowerCase(), salt, passwordHash: await hash(password, salt) };
    },
    async verify(username, password) {
      const admin = Store.get().admins.find(a => a.username === username.trim().toLowerCase());
      if (!admin) return null;
      const candidate = await hash(password, admin.salt);
      return candidate === admin.passwordHash ? admin : null;
    }
  };
})();
