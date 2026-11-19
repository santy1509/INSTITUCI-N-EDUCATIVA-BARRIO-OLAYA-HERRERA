(() => {
  const $ = id => document.getElementById(id);
  let currentAdmin = null;
  const fmtDate = value => new Date(value).toLocaleString("es-CO");
  const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const data = () => Store.get();
  const save = () => { Store.save(); renderAll(); };

  function showAuth() {
    $("setupView").classList.toggle("hidden", data().admins.length !== 0);
    $("loginView").classList.toggle("hidden", data().admins.length === 0);
    $("appView").classList.add("hidden");
  }
  function enter(admin) {
    currentAdmin = admin;
    $("currentAdmin").textContent = admin.name;
    $("setupView").classList.add("hidden");
    $("loginView").classList.add("hidden");
    $("appView").classList.remove("hidden");
    renderAll();
  }
  function fillGroups() {
    const opts = window.GRUPOS.map(g => `<option value="${g}">${g}</option>`).join("");
    $("studentGroup").innerHTML = opts;
    $("groupFilter").innerHTML = `<option value="">Todos los grupos</option>${opts}`;
  }
  function switchTab(id) {
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("hidden", p.id !== id));
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === id));
  }

  $("setupForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (!crypto?.subtle) return alert("Abre el proyecto con Live Server o una dirección HTTPS para activar el inicio de sesión.");
    const admin = await Auth.create($("setupName").value.trim(), $("setupUser").value, $("setupPass").value);
    data().admins.push(admin); save(); enter(admin);
  });
  $("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (!crypto?.subtle) return alert("Abre el proyecto con Live Server o una dirección HTTPS para activar el inicio de sesión.");
    const admin = await Auth.verify($("loginUser").value, $("loginPass").value);
    if (!admin) { $("loginError").textContent = "Usuario o contraseña incorrectos."; return; }
    $("loginError").textContent = ""; $("loginPass").value = ""; enter(admin);
  });
  $("logoutBtn").addEventListener("click", () => { currentAdmin = null; showAuth(); });
  document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));

  function openStudent(student=null) {
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
  $("studentForm").addEventListener("submit", e => {
    e.preventDefault();
    const id = $("studentId").value;
    const name = $("studentName").value.trim();
    const group = $("studentGroup").value;
    const phone = $("studentPhone").value.replace(/\D/g,"");
    if (phone && !(phone.length === 12 && phone.startsWith("57"))) {
      return alert("Revisa el número: para Colombia usa 57 seguido de los 10 dígitos.");
    }
    if (id) {
      const s = data().students.find(x => x.id === id);
      if (s) Object.assign(s, {name, group, phone});
    } else {
      data().students.push({id: crypto.randomUUID(), name, group, phone, active:true, lateCount:0});
    }
    $("studentDialog").close(); save();
  });

  function renderStudents() {
    const q = $("searchInput").value.trim().toLowerCase();
    const group = $("groupFilter").value;
    const list = data().students.filter(s => s.active !== false)
      .filter(s => s.name.toLowerCase().includes(q) && (!group || s.group === group))
      .sort((a,b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
    $("studentsTable").innerHTML = list.length ? list.map(s => {
      const pending = data().notices.some(n => n.studentId === s.id && n.status === "Pendiente");
      return `<tr>
        <td><strong>${escapeHTML(s.name)}</strong><br><span class="muted">${escapeHTML(s.phone || "Sin número de acudiente")}</span></td>
        <td><span class="pill">${escapeHTML(s.group)}</span></td>
        <td><strong>${s.lateCount || 0}/3</strong></td>
        <td><div class="actions">
          <button class="primary small" data-action="late" data-id="${s.id}">Registrar llegada</button>
          <button class="secondary small" data-action="edit" data-id="${s.id}">Editar</button>
          <button class="danger small" data-action="retire" data-id="${s.id}">Retirar</button>
          ${pending ? `<button class="secondary small" data-action="whatsapp" data-id="${s.id}">Abrir WhatsApp</button>` : ""}
        </div></td></tr>`;
    }).join("") : `<tr><td colspan="4" class="empty">No hay estudiantes para mostrar.</td></tr>`;
    $("statStudents").textContent = data().students.filter(s => s.active !== false).length;
    $("statRecords").textContent = data().history.length;
    $("statNotices").textContent = data().notices.filter(n => n.status === "Pendiente").length;
  }
  $("studentsTable").addEventListener("click", e => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const s = data().students.find(x => x.id === btn.dataset.id);
    if (!s) return;
    if (btn.dataset.action === "edit") return openStudent(s);
    if (btn.dataset.action === "retire") {
      if (confirm(`¿Retirar a ${s.name}? Su historial se conservará.`)) { s.active = false; save(); }
    }
    if (btn.dataset.action === "late") registerLate(s);
    if (btn.dataset.action === "whatsapp") openWhatsApp(s.id);
  });
  $("searchInput").addEventListener("input", renderStudents);
  $("groupFilter").addEventListener("change", renderStudents);

  function registerLate(student) {
    const now = new Date();
    student.lateCount = (student.lateCount || 0) + 1;
    const count = student.lateCount;
    data().history.unshift({
      id: crypto.randomUUID(), studentId: student.id, name: student.name,
      group: student.group, date: now.toISOString(), arrivalNumber: count
    });
    let createdNotice = false;
    if (count >= 3) {
      student.lateCount = 0;
      data().notices.unshift({
        id: crypto.randomUUID(), studentId: student.id, name: student.name,
        group: student.group, date: now.toISOString(), status: "Pendiente"
      });
      createdNotice = true;
    }
    save();
    if (createdNotice) {
      if (student.phone) {
        const opened = openWhatsApp(student.id);
        if (!opened) alert("El navegador bloqueó la ventana de WhatsApp. Usa el botón Abrir WhatsApp del estudiante.");
      } else {
        alert("Se registró la tercera llegada, pero falta el número autorizado del acudiente. Agrégalo editando al estudiante.");
      }
    } else {
      alert(`Llegada ${count} de 3 registrada para ${student.name}.`);
    }
  }
  function openWhatsApp(studentId) {
    const notice = data().notices.find(n => n.studentId === studentId && n.status === "Pendiente");
    const student = data().students.find(s => s.id === studentId);
    if (!notice || !student || !student.phone) return false;
    const message = `INSTITUCIÓN EDUCATIVA BARRIO OLAYA HERRERA\n\nBuen día, acudiente.\n\nLe informamos que el estudiante ${student.name}, del grupo ${student.group}, ha acumulado tres llegadas tarde a la Institución Educativa Barrio Olaya Herrera.\n\nPor esta razón, solicitamos que se presente en la institución junto con el estudiante para realizar el respectivo seguimiento y compromiso de puntualidad.\n\nAgradecemos su colaboración y atención.\n\nAtentamente,\nCoordinación Institucional\nInstitución Educativa Barrio Olaya Herrera.`;
    const url = `https://wa.me/${student.phone}?text=${encodeURIComponent(message)}`;
    const win = window.open(url, "_blank", "noopener");
    return !!win;
  }


  function normalizeGroup(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    if (window.GRUPOS.includes(raw)) return raw;
    const digits = raw.replace(/\D/g, "");
    if (window.GRUPOS.includes(digits)) return digits;
    // Acepta formatos habituales: 10-02, 10°2, 10 02, 6-01.
    const match = raw.match(/(6|7|8|9|10|11)\s*(?:°|º|[-_.\s])\s*0?(1|2|3|4)/i);
    if (match) {
      const grade = Number(match[1]);
      const course = Number(match[2]);
      const code = grade === 6 ? `60${course}00` : grade === 7 ? `70${course}00` : grade === 8 ? `80${course}00` : grade === 9 ? `90${course}00` : `${grade}0${course}00`;
      if (window.GRUPOS.includes(code)) return code;
    }
    return "";
  }

  function normalizeHeader(value) {
    return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function importStudentsFromRows(rows) {
    if (!rows.length) throw new Error("El archivo no contiene filas de estudiantes.");
    const headers = rows[0].map(normalizeHeader);
    const findColumn = aliases => headers.findIndex(h => aliases.includes(h));
    const nameIndex = findColumn(["nombredelestudiante", "nombrecompleto", "estudiante", "nombre"]);
    const groupIndex = findColumn(["grupo", "curso", "gradoygrupo", "grupoescolar"]);
    const phoneIndex = findColumn(["whatsappdelacudiente", "telefonodelacudiente", "celulardelacudiente", "telefonowhatsapp", "whatsapp", "telefono", "celular"]);
    if (nameIndex < 0 || groupIndex < 0) {
      throw new Error("No encuentro las columnas de nombre y grupo. Usa la plantilla de Excel descargable.");
    }
    let added = 0, updated = 0, skipped = 0;
    const seen = new Set();
    rows.slice(1).forEach(row => {
      const name = String(row[nameIndex] ?? "").trim().replace(/\s+/g, " ");
      if (!name) return;
      const group = normalizeGroup(row[groupIndex]);
      if (!group) { skipped++; return; }
      const rawPhone = phoneIndex >= 0 ? String(row[phoneIndex] ?? "").replace(/\D/g, "") : "";
      let phone = rawPhone;
      if (phone.length === 10 && phone.startsWith("3")) phone = `57${phone}`;
      if (phone && !(phone.length === 12 && phone.startsWith("57"))) phone = "";
      const key = `${name.toLocaleLowerCase("es-CO")}|${group}`;
      if (seen.has(key)) { skipped++; return; }
      seen.add(key);
      const existing = data().students.find(s => s.name.toLocaleLowerCase("es-CO") === name.toLocaleLowerCase("es-CO") && s.group === group);
      if (existing) {
        if (phone) existing.phone = phone;
        existing.active = true;
        updated++;
      } else {
        data().students.push({ id: crypto.randomUUID(), name, group, phone, active: true, lateCount: 0 });
        added++;
      }
    });
    save();
    alert(`Importación terminada.\n\nNuevos estudiantes: ${added}\nActualizados/reactivados: ${updated}\nFilas omitidas: ${skipped}\n\nLos estudiantes ya aparecen organizados por grupo y nombre.`);
  }

  async function importStudentsFromFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
      let rows;
      if (file.name.toLowerCase().endsWith(".csv")) {
        const textContent = await file.text();
        rows = textContent.split(/\r?\n/).filter(line => line.trim()).map(line => line.split(/[,;\t]/).map(cell => cell.replace(/^\s*"|"\s*$/g, "").trim()));
      } else {
        if (!window.XLSX) throw new Error("No se pudo cargar el lector de Excel. Revisa tu conexión a internet o guarda el archivo como CSV.");
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "array" });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "", raw: false });
      }
      if (!rows || rows.length < 2) throw new Error("Agrega los encabezados y al menos un estudiante en la primera hoja del archivo.");
      if (!confirm("Se importarán los estudiantes de este archivo. Si un estudiante ya existe en el mismo grupo, se actualizará su teléfono si el Excel lo trae. ¿Continuar?")) return;
      importStudentsFromRows(rows);
    } catch (error) {
      alert(error.message || "No se pudo leer el archivo. Verifica que sea un Excel o CSV válido.");
    } finally {
      event.target.value = "";
    }
  }

  function renderHistory() {
    $("historyTable").innerHTML = data().history.length ? data().history.map(h =>
      `<tr><td>${escapeHTML(fmtDate(h.date))}</td><td>${escapeHTML(h.name)}</td><td>${escapeHTML(h.group)}</td><td>${h.arrivalNumber}/3</td></tr>`
    ).join("") : `<tr><td colspan="4" class="empty">Todavía no hay registros.</td></tr>`;
    const notices = data().notices;
    $("noticesList").innerHTML = notices.length ? notices.map(n => `
      <div class="item"><div><strong>${escapeHTML(n.name)}</strong><p class="muted">Grupo ${escapeHTML(n.group)} · ${escapeHTML(fmtDate(n.date))} · ${escapeHTML(n.status)}</p></div>
      <div class="actions">
        <button class="secondary small" data-notice="open" data-id="${n.id}">Abrir WhatsApp</button>
        ${n.status === "Pendiente" ? `<button class="primary small" data-notice="done" data-id="${n.id}">Marcar atendido</button>` : ""}
      </div></div>`).join("") : `<p class="empty">No hay avisos registrados.</p>`;
  }
  $("noticesList").addEventListener("click", e => {
    const b = e.target.closest("button[data-notice]");
    if (!b) return;
    const n = data().notices.find(x => x.id === b.dataset.id);
    if (!n) return;
    if (b.dataset.notice === "open") openWhatsApp(n.studentId);
    if (b.dataset.notice === "done" && confirm("¿Confirmas que el acudiente ya fue atendido?")) { n.status = "Atendido"; save(); }
  });
  $("clearHistoryBtn").addEventListener("click", () => {
    if (confirm("¿Borrar todos los registros del historial? Los avisos y estudiantes no se borrarán.")) {
      Store.resetHistory(); renderAll();
    }
  });

  $("adminForm").addEventListener("submit", async e => {
    e.preventDefault();
    const username = $("adminUser").value.trim().toLowerCase();
    if (data().admins.some(a => a.username === username)) return alert("Ese usuario ya existe.");
    const admin = await Auth.create($("adminName").value.trim(), username, $("adminPass").value);
    data().admins.push(admin); $("adminForm").reset(); save();
  });
  function renderAdmins() {
    $("adminsList").innerHTML = data().admins.map(a => `<div class="item"><div><strong>${escapeHTML(a.name)}</strong><p class="muted">@${escapeHTML(a.username)}</p></div>
      <button class="danger small" data-remove-admin="${a.id}" ${data().admins.length <= 1 || a.id === currentAdmin?.id ? "disabled" : ""}>Eliminar</button></div>`).join("");
  }
  $("adminsList").addEventListener("click", e => {
    const b = e.target.closest("[data-remove-admin]");
    if (!b) return;
    if (!confirm("¿Eliminar esta cuenta de administrador?")) return;
    const index = data().admins.findIndex(a => a.id === b.dataset.removeAdmin);
    if (index >= 0) data().admins.splice(index,1);
    save();
  });

  $("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(data(), null, 2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `copia-control-llegadas-${new Date().toISOString().slice(0,10)}.json`; a.click();
    URL.revokeObjectURL(url);
  });
  $("importFile").addEventListener("change", async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.admins) || !Array.isArray(parsed.students) || !Array.isArray(parsed.history) || !Array.isArray(parsed.notices)) throw new Error();
      if (!confirm("Esto reemplazará todos los datos locales. ¿Continuar?")) return;
      Store.replace(parsed); currentAdmin = null; showAuth();
      alert("Copia restaurada. Inicia sesión con una cuenta incluida en esa copia.");
    } catch { alert("El archivo no es una copia válida de este sistema."); }
    e.target.value = "";
  });

  function renderAll() { renderStudents(); renderHistory(); renderAdmins(); }
  fillGroups();
  showAuth();
})();
