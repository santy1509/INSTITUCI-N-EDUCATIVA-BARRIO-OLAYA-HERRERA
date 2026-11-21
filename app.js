(() => {
  const $ = id => document.getElementById(id);
  let currentUser = null;
  let currentProfile = null;
  let busy = false;

  const fmtDate = value => {
    const date = value && value.toDate ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime()) ? "Fecha no disponible" : date.toLocaleString("es-CO");
  };

  const normalizeStudentName = value => String(value ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-CO").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");

  const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));

  const data = () => Store.get();
  const isAdmin = () => currentProfile?.rol === "admin";
  const isTeacher = () => currentProfile?.rol === "profesor";

  function showOnlyAuth(view) {
    ["setupView", "loginView", "appView"].forEach(id =>
      $(id).classList.toggle("hidden", id !== view)
    );
  }

  function setStatus(message, connected = false) {
    $("syncStatus").textContent = message;
    $("connectionStatus").textContent = connected ? "Firebase conectado" : "Sistema privado";
  }

  function fillGroups() {
    const opts = window.GRUPOS.map(group =>
      `<option value="${escapeHTML(group)}">${escapeHTML(group)}</option>`
    ).join("");

    $("studentGroup").innerHTML = opts;
    $("groupFilter").innerHTML = `<option value="">Todos los grupos</option>${opts}`;
  }

  function switchTab(id) {
    document.querySelectorAll(".tab-panel").forEach(panel =>
      panel.classList.toggle("hidden", panel.id !== id)
    );

    document.querySelectorAll(".tab").forEach(button =>
      button.classList.toggle("active", button.dataset.tab === id)
    );
  }

  function applyPermissions() {
    const admin = isAdmin();

    $("currentRole").textContent = admin ? "Administrador" : "Profesor";

    document.querySelectorAll('[data-admin-only]').forEach(element => {
      element.classList.toggle("hidden", !admin);
    });

    document.querySelectorAll('[data-teacher-or-admin]').forEach(element => {
      element.classList.toggle("hidden", !(admin || isTeacher()));
    });

    const adminTab = document.querySelector('[data-tab="adminsPanel"]');
    const backupTab = document.querySelector('[data-tab="backupPanel"]');

    if (adminTab) adminTab.classList.toggle("hidden", !admin);
    if (backupTab) backupTab.classList.toggle("hidden", !admin);

    ["newStudentBtn", "importStudentsBtn", "clearHistoryBtn", "exportBtn", "importFile"]
      .forEach(id => {
        const element = $(id);

        if (element) {
          const wrapper = id === "importFile" ? element.closest(".file-button") : element;
          if (wrapper) wrapper.classList.toggle("hidden", !admin);
        }
      });

    if (!admin && $("adminsPanel")) $("adminsPanel").classList.add("hidden");
    if (!admin && $("backupPanel")) $("backupPanel").classList.add("hidden");
  }

  async function enter(profile) {
    currentProfile = profile;
    currentUser = auth.currentUser;

    $("currentAdmin").textContent = profile.nombre || profile.correo || "Usuario";

    showOnlyAuth("appView");
    applyPermissions();
    setStatus("Conectando con la base de datos...");

    try {
      await Store.start(profile.rol);
      setStatus("Sincronización en tiempo real activa", true);

      if (isAdmin()) {
        try {
          const result = await Store.migrateLocalData();

          if (result.migrated && result.count) {
            alert(`Se importaron ${result.count} registros locales a Firebase. Las cuentas antiguas no se migraron; deben crearse como usuarios Firebase.`);
          }
        } catch (error) {
          console.error(error);
          alert(error.message || "No se pudo migrar la información local.");
        }
      }

      renderAll();
    } catch (error) {
      console.error(error);
      setStatus("No se pudo conectar con Firestore");
      alert("No se pudo cargar la base de datos. Revisa las reglas de Firestore y la conexión.");
    }
  }

  function showLoggedOut() {
    currentUser = null;
    currentProfile = null;

    Store.stop();
    showOnlyAuth("loginView");
    $("loginError").textContent = "";
  }

  $("setupForm").addEventListener("submit", event => {
    event.preventDefault();

    alert("La primera cuenta administradora debe autorizarse creando su perfil en Firebase Console. Consulta el archivo LEEME.txt. Esto evita que cualquier persona pueda convertirse en administrador desde la página.");
  });

  $("loginForm").addEventListener("submit", async event => {
    event.preventDefault();

    if (busy) return;
    busy = true;

    $("loginError").textContent = "";

    try {
      const result = await Auth.signIn($("loginUser").value, $("loginPass").value);
      const profile = await Auth.getProfile(result.user.uid);

      if (!profile) {
        await Auth.signOut();
        throw new Error("Tu cuenta todavía no tiene un perfil autorizado en Firestore. Contacta al administrador principal.");
      }

      if (profile.activo !== true) {
        await Auth.signOut();
        throw new Error("Tu cuenta está desactivada. Contacta al administrador.");
      }

      await enter(profile);
      $("loginPass").value = "";
    } catch (error) {
      $("loginError").textContent = error.message || "No se pudo iniciar sesión.";
    } finally {
      busy = false;
    }
  });

  $("logoutBtn").addEventListener("click", async () => {
    await Auth.signOut();
    showLoggedOut();
  });

  Auth.onChange(async user => {
    if (!user) {
      showLoggedOut();
      return;
    }

    try {
      const profile = await Auth.getProfile(user.uid);

      if (!profile) {
        await Auth.signOut();
        showOnlyAuth("loginView");
        $("loginError").textContent = "Tu cuenta no tiene un perfil autorizado en Firestore.";
        return;
      }

      if (profile.activo !== true) {
        await Auth.signOut();
        $("loginError").textContent = "Tu cuenta está desactivada.";
        return;
      }

      if (!currentProfile || currentProfile.uid !== profile.uid) {
        await enter(profile);
      }
    } catch (error) {
      console.error(error);
      $("loginError").textContent = "No se pudo verificar tu cuenta.";
    }
  });

  window.addEventListener("store:changed", renderAll);
  window.addEventListener("store:error", () => setStatus("Error de sincronización"));

  document.querySelectorAll(".tab").forEach(button =>
    button.addEventListener("click", () => {
      if (button.dataset.tab === "adminsPanel" && !isAdmin()) return;
      switchTab(button.dataset.tab);
    })
  );

  function openStudent(student = null) {
    if (!isAdmin()) return alert("Solo un administrador puede modificar estudiantes.");

    $("studentForm").reset();
    $("studentId").value = student?.id || "";
    $("studentDialogTitle").textContent = student ? "Editar estudiante" : "Agregar estudiante";
    $("studentName").value = student?.name || "";
    $("studentGroup").value = student?.group || window.GRUPOS[0];
    $("studentPhone").value = student?.phone || "";

    $("studentDialog").showModal();
  }

  $("newStudentBtn").addEventListener("click", () => openStudent());
  $("importStudentsBtn").addEventListener("click", () => $("studentsExcelFile").click());
  $("studentsExcelFile").addEventListener("change", importStudentsFromFile);
  $("closeStudentDialog").addEventListener("click", () => $("studentDialog").close());
  $("cancelStudent").addEventListener("click", () => $("studentDialog").close());

  $("studentForm").addEventListener("submit", async event => {
    event.preventDefault();

    if (!isAdmin()) return alert("No tienes permiso para modificar estudiantes.");

    const id = $("studentId").value;
    const name = $("studentName").value.trim();
    const group = $("studentGroup").value;
    const phone = $("studentPhone").value.replace(/\D/g, "");

    if (phone && !(phone.length === 12 && phone.startsWith("57"))) {
      return alert("Revisa el número: para Colombia usa 57 seguido de los 10 dígitos.");
    }

    try {
      if (id) {
        await Store.updateStudent(id, { name, group, phone });
      } else {
        const duplicate = data().students.find(student =>
          normalizeStudentName(student.name) === normalizeStudentName(name)
        );

        if (duplicate) {
          return alert(`No se puede registrar: ${name} ya está incorporado en el grupo ${duplicate.group}.`);
        }

        await Store.addStudent({
          id: crypto.randomUUID(),
          name,
          group,
          phone,
          active: true,
          lateCount: 0,
          createdAt: new Date().toISOString()
        });
      }

      $("studentDialog").close();
      renderAll();
    } catch (error) {
      alert(error.message || "No se pudo guardar el estudiante. Revisa los permisos de Firestore.");
      console.error(error);
    }
  });

  function renderStudents() {
    if (!$("studentsTable")) return;

    const q = $("searchInput").value.trim().toLowerCase();
    const group = $("groupFilter").value;
    const admin = isAdmin();

    const activeStudents = data().students.filter(student => student.active !== false);

    const grouped = new Map();

    activeStudents.forEach(student => {
      const key = normalizeStudentName(student.name);

      if (!key) return;

      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(student);
    });

    const list = [...grouped.values()].map(records => {
      const student = [...records].sort((a, b) =>
        Number(!!b.phone) - Number(!!a.phone)
      )[0];

      const ids = new Set(records.map(item => item.id));

      const notices = data().notices.filter(notice =>
        ids.has(notice.studentId)
      );

      const attended = notices.filter(notice =>
        ["Atendido", "Atendida"].includes(notice.status)
      ).length;

      const pending = notices.filter(notice =>
        notice.status === "Pendiente"
      ).length;

      return {
        student,
        notices: notices.length,
        attended,
        pending
      };
    })
      .filter(item =>
        String(item.student.name || "").toLowerCase().includes(q)
        && (!group || item.student.group === group)
      )
      .sort((a, b) =>
        String(a.student.group).localeCompare(String(b.student.group))
        || String(a.student.name).localeCompare(String(b.student.name))
      );

    $("studentsTable").innerHTML = list.length
      ? list.map(({ student, notices, attended, pending }) => `
        <tr>
          <td>
            <strong>${escapeHTML(student.name)}</strong><br>
            <span class="muted">${escapeHTML(student.phone || "Sin número de acudiente")}</span>
          </td>
          <td><span class="pill">${escapeHTML(student.group)}</span></td>
          <td><strong>${Number(student.lateCount || 0)}/3</strong></td>
          <td>
            <div class="citation-counts">
              <span class="citation-total">Citaciones: ${notices}</span>
              <span class="citation-attended">Atendidas: ${attended}</span>
              <span class="citation-pending">Pendientes: ${pending}</span>
            </div>
          </td>
          <td>
            <div class="actions">
              <button class="primary small" data-action="late" data-id="${escapeHTML(student.id)}">Registrar llegada</button>
              ${admin ? `
                <button class="secondary small" data-action="edit" data-id="${escapeHTML(student.id)}">Editar</button>
                <button class="danger small" data-action="retire" data-id="${escapeHTML(student.id)}">Retirar</button>
              ` : ""}
            </div>
          </td>
        </tr>
      `).join("")
      : `<tr><td colspan="5" class="empty">No hay estudiantes para mostrar.</td></tr>`;

    $("statStudents").textContent = list.length;
    $("statRecords").textContent = data().history.length;
    $("statNotices").textContent = data().notices.filter(notice =>
      notice.status === "Pendiente"
    ).length;
  }

  $("studentsTable").addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]");

    if (!button) return;

    const student = data().students.find(item =>
      item.id === button.dataset.id
    );

    if (!student) return;

    if (button.dataset.action === "edit") {
      return openStudent(student);
    }

    if (button.dataset.action === "retire") {
      if (!isAdmin()) return;

      if (confirm(`¿Retirar a ${student.name}? Su historial se conservará.`)) {
        try {
          await Store.updateStudent(student.id, { active: false });
        } catch (error) {
          alert("No se pudo retirar el estudiante.");
        }
      }
    }

    if (button.dataset.action === "late") {
      await registerLate(student);
    }
  });

  $("searchInput").addEventListener("input", renderStudents);
  $("groupFilter").addEventListener("change", renderStudents);

  // REGISTRO DE LLEGADAS Y APERTURA DE WHATSAPP EN LA TERCERA LLEGADA.
  async function registerLate(student) {
    if (!currentUser || !(isAdmin() || isTeacher())) {
      return alert("No tienes permiso para registrar llegadas.");
    }

    // Prepara una ventana durante el clic del usuario
    // para evitar que Chrome bloquee WhatsApp después de esperar a Firebase.
    const phone = String(student.phone || "").replace(/\D/g, "");

    const whatsappWindow = phone
      ? window.open("about:blank", "_blank")
      : null;

    try {
      const result = await Store.registerLate(student);

      if (result.createdNotice) {
        if (!phone || phone.length !== 12 || !phone.startsWith("57")) {
          if (whatsappWindow && !whatsappWindow.closed) {
            whatsappWindow.close();
          }

          alert(
            `Se creó la citación de ${student.name}, pero no hay un número válido del acudiente registrado.`
          );

          return;
        }

        // MENSAJE FORMAL DE LA INSTITUCIÓN.
       const message =
  `INSTITUCIÓN EDUCATIVA BARRIO OLAYA HERRERA

COMUNICADO A PADRES DE FAMILIA Y ACUDIENTES

Cordial saludo.

Por medio del presente, nos permitimos informarle que el estudiante ${student.name}, perteneciente al grupo ${student.group}, ha registrado su tercera llegada tarde a la institución .

Por este motivo, solicitamos amablemente su presencia en las instalaciones de la institución, con el fin de dialogar sobre esta situación y establecer compromisos que contribuyan al cumplimiento de los horarios escolares.

Agradecemos su atención, colaboración y compromiso con la formación académica de nuestro estudiante.

Atentamente,
Coordinación
Institución Educativa Barrio Olaya Herrera.`;
        const whatsappURL =
          `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

        if (whatsappWindow && !whatsappWindow.closed) {
          whatsappWindow.location.href = whatsappURL;
        } else {
          alert(
            "La citación se creó, pero el navegador bloqueó la apertura de WhatsApp. Permite las ventanas emergentes de esta página."
          );
        }

        alert(
          `Se registró la tercera llegada de ${student.name} y se creó una citación para el acudiente.`
        );
      } else {
        if (whatsappWindow && !whatsappWindow.closed) {
          whatsappWindow.close();
        }

        alert(
          `Llegada ${result.count} de 3 registrada para ${student.name}.`
        );
      }
    } catch (error) {
      if (whatsappWindow && !whatsappWindow.closed) {
        whatsappWindow.close();
      }

      console.error(error);

      alert(
        error.message || "No se pudo registrar la llegada."
      );
    }
  }

  function normalizeGroup(value) {
    const raw = String(value ?? "").trim();

    if (!raw) return "";

    if (window.GRUPOS.includes(raw)) return raw;

    const digits = raw.replace(/\D/g, "");

    if (window.GRUPOS.includes(digits)) return digits;

    const match = raw.match(/(6|7|8|9|10|11)\s*(?:°|º|[-_.\s])\s*0?(1|2|3|4)/i);

    if (match) {
      const grade = Number(match[1]);
      const course = Number(match[2]);

      const code = grade === 6 ? `60${course}00`
        : grade === 7 ? `70${course}00`
        : grade === 8 ? `80${course}00`
        : grade === 9 ? `90${course}00`
        : `${grade}0${course}00`;

      if (window.GRUPOS.includes(code)) return code;

      const afternoonCode = `${grade}${course}`;

      if (window.GRUPOS.includes(afternoonCode)) return afternoonCode;
    }

    return "";
  }

  function normalizeHeader(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  async function importStudentsFromRows(rows) {
    if (!isAdmin()) {
      throw new Error("Solo un administrador puede importar estudiantes.");
    }

    if (!rows.length) {
      throw new Error("El archivo no contiene filas de estudiantes.");
    }

    const headers = rows[0].map(normalizeHeader);

    const findColumn = aliases =>
      headers.findIndex(header => aliases.includes(header));

    const nameIndex = findColumn([
      "nombredelestudiante",
      "nombrecompleto",
      "estudiante",
      "nombre"
    ]);

    const groupIndex = findColumn([
      "grupo",
      "curso",
      "gradoygrupo",
      "grupoescolar"
    ]);

    const phoneIndex = findColumn([
      "whatsappdelacudiente",
      "telefonodelacudiente",
      "celulardelacudiente",
      "telefonowhatsapp",
      "whatsapp",
      "telefono",
      "celular"
    ]);

    if (nameIndex < 0 || groupIndex < 0) {
      throw new Error("No encuentro las columnas de nombre y grupo. Usa la plantilla de Excel descargable.");
    }

    let added = 0;
    let skipped = 0;

    const seen = new Set();

    for (const row of rows.slice(1)) {
      const name = String(row[nameIndex] ?? "")
        .trim()
        .replace(/\s+/g, " ");

      if (!name) continue;

      const group = normalizeGroup(row[groupIndex]);

      if (!group) {
        skipped++;
        continue;
      }

      let phone = phoneIndex >= 0
        ? String(row[phoneIndex] ?? "").replace(/\D/g, "")
        : "";

      if (phone.length === 10 && phone.startsWith("3")) {
        phone = `57${phone}`;
      }

      if (phone && !(phone.length === 12 && phone.startsWith("57"))) {
        phone = "";
      }

      const key = normalizeStudentName(name);

      if (seen.has(key)) {
        skipped++;
        continue;
      }

      seen.add(key);

      const existing = data().students.find(student =>
        normalizeStudentName(student.name) === key
      );

      if (existing) {
        skipped++;
      } else {
        await Store.addStudent({
          id: crypto.randomUUID(),
          name,
          group,
          phone,
          active: true,
          lateCount: 0,
          createdAt: new Date().toISOString()
        });

        added++;
      }
    }

    alert(
      `Importación terminada.\n\nNuevos estudiantes: ${added}\nFilas omitidas por estar repetidas o incompletas: ${skipped}`
    );
  }

  async function importStudentsFromFile(event) {
    const file = event.target.files[0];

    if (!file) return;

    try {
      let rows;

      if (file.name.toLowerCase().endsWith(".csv")) {
        const content = await file.text();

        rows = content.split(/\r?\n/)
          .filter(line => line.trim())
          .map(line =>
            line.split(/[,;\t]/).map(cell =>
              cell.replace(/^\s*"|"\s*$/g, "").trim()
            )
          );
      } else {
        if (!window.XLSX) {
          throw new Error("No se pudo cargar el lector de Excel.");
        }

        const workbook = XLSX.read(await file.arrayBuffer(), {
          type: "array"
        });

        rows = XLSX.utils.sheet_to_json(
          workbook.Sheets[workbook.SheetNames[0]],
          {
            header: 1,
            defval: "",
            raw: false
          }
        );
      }

      if (!rows || rows.length < 2) {
        throw new Error("Agrega encabezados y al menos un estudiante.");
      }

      if (!confirm("Se importarán los estudiantes. Los que ya existan en el mismo grupo se actualizarán. ¿Continuar?")) {
        return;
      }

      await importStudentsFromRows(rows);
    } catch (error) {
      alert(error.message || "No se pudo leer el archivo.");
    } finally {
      event.target.value = "";
    }
  }

  function renderHistory() {
    $("historyTable").innerHTML = data().history.length
      ? [...data().history]
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .map(item => `
          <tr>
            <td>${escapeHTML(fmtDate(item.date))}</td>
            <td>${escapeHTML(item.name)}</td>
            <td>${escapeHTML(item.group)}</td>
            <td>${Number(item.arrivalNumber || 0)}/3</td>
          </tr>
        `).join("")
      : `<tr><td colspan="4" class="empty">Todavía no hay registros.</td></tr>`;

    const notices = [...data().notices]
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    $("noticesList").innerHTML = notices.length
      ? notices.map(notice => {
        const citationDate = notice.date
          ? fmtDate(notice.date)
          : "No disponible (aviso antiguo)";

        const statusText = notice.status === "Pendiente"
          ? "Pendiente"
          : notice.status === "Atendido"
            ? "Atendida"
            : notice.status;

        return `
          <div class="item">
            <div>
              <strong>${escapeHTML(notice.name)}</strong>
              <p class="muted">Grupo ${escapeHTML(notice.group)}</p>
              <p class="muted">
                <strong>Fecha de citación:</strong>
                ${escapeHTML(citationDate)}
              </p>
              <p class="muted">
                <strong>Estado:</strong>
                ${escapeHTML(statusText)}
              </p>
            </div>

            <div class="actions">
              ${notice.status === "Pendiente"
                ? `<button class="primary small" data-notice="done" data-id="${escapeHTML(notice.id)}">Marcar atendido</button>`
                : ""}
            </div>
          </div>
        `;
      }).join("")
      : `<p class="empty">No hay avisos registrados.</p>`;
  }

  $("noticesList").addEventListener("click", async event => {
    const button = event.target.closest("button[data-notice]");

    if (!button) return;

    const notice = data().notices.find(item =>
      item.id === button.dataset.id
    );

    if (!notice) return;

    if (
      button.dataset.notice === "done"
      && confirm("¿Confirmas que el acudiente ya fue atendido?")
    ) {
      try {
        await Store.updateNotice(notice.id, {
          status: "Atendido"
        });
      } catch (error) {
        alert("No se pudo actualizar el aviso.");
      }
    }
  });

  $("clearHistoryBtn").addEventListener("click", async () => {
    if (!isAdmin()) {
      return alert("Solo un administrador puede borrar el historial.");
    }

    if (confirm("¿Borrar todos los registros del historial? Los avisos y estudiantes no se borrarán.")) {
      try {
        await Store.clearHistory();
      } catch (error) {
        alert("No se pudo borrar el historial.");
      }
    }
  });

  $("adminForm").addEventListener("submit", async event => {
    event.preventDefault();

    if (!isAdmin()) {
      return alert("Solo un administrador puede crear usuarios.");
    }

    const nombre = $("adminName").value.trim();
    const correo = $("adminUser").value.trim().toLowerCase();
    const password = $("adminPass").value;
    const rol = $("adminRole").value;

    if (!["admin", "profesor"].includes(rol)) {
      return alert("Selecciona un rol válido.");
    }

    if (password.length < 8) {
      return alert("La contraseña debe tener al menos 8 caracteres.");
    }

    try {
      if (data().users.some(user =>
        user.correo?.toLowerCase() === correo
      )) {
        return alert("Ya existe un usuario con ese correo.");
      }

      await Auth.createUser(correo, password, nombre, rol);

      $("adminForm").reset();

      alert(`Usuario ${rol === "admin" ? "administrador" : "profesor"} creado correctamente.`);
    } catch (error) {
      console.error(error);
      alert(error.message || "No se pudo crear el usuario.");
    }
  });

  function renderAdmins() {
    if (!$("adminsList")) return;

    $("adminsList").innerHTML = data().users
      .sort((a, b) =>
        String(a.nombre).localeCompare(String(b.nombre))
      )
      .map(user => {
        const status = user.activo === true;

        return `
          <div class="item">
            <div>
              <strong>${escapeHTML(user.nombre || user.correo)}</strong>
              <p class="muted">
                ${escapeHTML(user.correo || "")} ·
                ${user.rol === "admin" ? "Administrador" : "Profesor"} ·
                ${status ? "Activo" : "Inactivo"}
              </p>
            </div>

            ${user.uid !== currentUser?.uid
              ? `
                <button
                  class="${status ? "danger" : "secondary"} small"
                  data-toggle-user="${escapeHTML(user.uid)}"
                  data-active="${status ? "true" : "false"}"
                >
                  ${status ? "Desactivar" : "Activar"}
                </button>
              `
              : `<span class="pill">Tu cuenta</span>`
            }
          </div>
        `;
      }).join("")
      || `<p class="empty">No hay usuarios registrados.</p>`;
  }

  $("adminsList").addEventListener("click", async event => {
    const button = event.target.closest("[data-toggle-user]");

    if (!button || !isAdmin()) return;

    const nextActive = button.dataset.active !== "true";

    const message = nextActive
      ? "¿Activar esta cuenta?"
      : "¿Desactivar esta cuenta? El usuario perderá acceso.";

    if (!confirm(message)) return;

    try {
      await Store.updateUser(button.dataset.toggleUser, {
        activo: nextActive
      });
    } catch (error) {
      alert("No se pudo cambiar el estado del usuario.");
    }
  });

  $("exportBtn").addEventListener("click", () => {
    if (!isAdmin()) {
      return alert("Solo un administrador puede exportar copias.");
    }

    const backup = {
      exportedAt: new Date().toISOString(),
      students: data().students,
      history: data().history,
      notices: data().notices
    };

    const blob = new Blob(
      [JSON.stringify(backup, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = `copia-control-llegadas-${new Date().toISOString().slice(0, 10)}.json`;

    anchor.click();
    URL.revokeObjectURL(url);
  });

  $("importFile").addEventListener("change", async event => {
    const file = event.target.files[0];

    if (!file) return;

    try {
      if (!isAdmin()) {
        throw new Error("Solo un administrador puede restaurar copias.");
      }

      const parsed = JSON.parse(await file.text());

      if (
        !Array.isArray(parsed.students)
        || !Array.isArray(parsed.history)
        || !Array.isArray(parsed.notices)
      ) {
        throw new Error("El archivo no contiene las listas esperadas.");
      }

      if (!confirm("Esto reemplazará estudiantes, historial y avisos actuales en Firebase. ¿Continuar?")) {
        return;
      }

      await Store.restoreData(parsed);

      alert("Copia restaurada correctamente.");
    } catch (error) {
      alert(error.message || "El archivo no es una copia válida.");
    } finally {
      event.target.value = "";
    }
  });

  function renderAll() {
    if (!currentProfile) return;

    applyPermissions();
    renderStudents();
    renderHistory();
    renderAdmins();
  }

  fillGroups();
  showOnlyAuth("loginView");
})();