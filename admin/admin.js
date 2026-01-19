import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  doc,
  updateDoc,
  orderBy,
  query,
  deleteDoc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
// [KEAMANAN] Import Firebase Auth
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { firebaseConfig } from "../firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app); // [KEAMANAN] Inisialisasi Auth

const $ = (q) => document.querySelector(q);
const $$ = (q) => document.querySelectorAll(q);
function rupiah(n) {
  return "Rp " + (n || 0).toLocaleString("id-ID");
}

let state = {
  orders: [],
  vendors: [],
  banners: [],
  subscriptions: [],
  topups: [],
  vendorStats: {},
  selectedOrderId: null,
  selectedVendorId: null,
  selectedSubId: null,
  isBooted: false, // Mencegah double listener
};

// --- GLOBAL: IMAGE MODAL LOGIC ---
window.closeImageModal = () => {
  $("#imageModal").classList.add("hidden");
  $("#imagePreviewFull").src = "";
};

window.viewProofImage = (imgSrc) => {
  if (!imgSrc) return alert("Gambar tidak valid");
  $("#imagePreviewFull").src = imgSrc;
  $("#imageModal").classList.remove("hidden");
};

window.viewTopupProof = (id) => {
  const item = state.topups.find((t) => t.id === id);
  if (item && item.proof) window.viewProofImage(item.proof);
};

window.viewSubscriptionProof = (id) => {
  const item = state.subscriptions.find((s) => s.id === id);
  if (item && item.proof) window.viewProofImage(item.proof);
};

// --- [KEAMANAN] AUTH LOGIC BARU ---

// 1. Cek Status Login (Session Persistence)
onAuthStateChanged(auth, (user) => {
  if (user) {
    // Jika User Login Valid
    console.log("Admin Logged In:", user.email);
    $("#adminAuth").classList.add("hidden");
    $("#adminApp").classList.remove("hidden");

    // Jalankan aplikasi hanya jika belum jalan
    if (!state.isBooted) {
      boot();
      state.isBooted = true;
    }
  } else {
    // Jika Tidak Login / Logout
    $("#adminAuth").classList.remove("hidden");
    $("#adminApp").classList.add("hidden");
    state.isBooted = false;
  }
});

// 2. Fungsi Login
$("#adminLoginForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = $("#adminUser").value.trim(); // Pastikan input HTML type="email" atau user isi email
  const pass = $("#adminPass").value;
  const btn = e.target.querySelector("button");

  btn.textContent = "Memverifikasi...";
  btn.disabled = true;

  try {
    // Login ke Firebase
    await signInWithEmailAndPassword(auth, email, pass);
    // Jika sukses, onAuthStateChanged akan otomatis jalan
  } catch (err) {
    alert("Login Gagal: Password salah atau user tidak ditemukan.");
    console.error(err);
    btn.textContent = "Masuk";
    btn.disabled = false;
  }
});

// 3. Fungsi Logout
$("#adminLogoutBtn").addEventListener("click", async () => {
  if (confirm("Keluar dari Panel Admin?")) {
    await signOut(auth);
    location.reload(); // Refresh agar bersih
  }
});

// --- TABS (DESKTOP) ---
$$(".sbItem").forEach((b) =>
  b.addEventListener("click", () => {
    switchTab(b.dataset.tab);
  }),
);

// --- TABS (MOBILE) ---
window.switchTabMobile = (tabName, el) => {
  switchTab(tabName);
};

// --- UNIVERSAL TAB SWITCHER ---
function switchTab(tabName) {
  $$(".tab").forEach((t) => t.classList.add("hidden"));
  $("#tab" + tabName).classList.remove("hidden");

  $$(".sbItem").forEach((x) => x.classList.remove("active"));
  const desktopBtn = document.querySelector(`.sbItem[data-tab="${tabName}"]`);
  if (desktopBtn) desktopBtn.classList.add("active");

  $$(".nav-item").forEach((x) => x.classList.remove("active"));
  const mobileBtns = document.querySelectorAll(".nav-item");
  mobileBtns.forEach((btn) => {
    if (btn.getAttribute("onclick").includes(tabName)) {
      btn.classList.add("active");
    }
  });

  const title = $("#pageTitle");
  if (title)
    title.textContent =
      tabName === "Topups"
        ? "Topup User"
        : tabName === "Revenue"
          ? "Validasi Mitra"
          : tabName;
}

window.goToRevenue = () => {
  switchTab("Revenue");
};

// --- BOOT ---
function boot() {
  // Hanya jalan kalau sudah login
  onSnapshot(
    query(collection(db, "orders"), orderBy("createdAt", "desc")),
    (snap) => {
      state.orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      calculateStats();
      renderDashboard();
      renderOrdersTable();
      renderVendors();
    },
  );
  onSnapshot(collection(db, "vendors"), (snap) => {
    state.vendors = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderVendors();
    renderVendorDropdown();
    renderDashboard();
  });
  onSnapshot(
    query(collection(db, "subscriptions"), orderBy("timestamp", "desc")),
    (snap) => {
      state.subscriptions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderDashboard();
      renderRevenueTable();
    },
  );
  onSnapshot(
    query(collection(db, "topups"), orderBy("timestamp", "desc")),
    (snap) => {
      state.topups = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderTopupsTable();
    },
  );
  onSnapshot(collection(db, "banners"), (snap) => {
    state.banners = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderBanners();
  });
}

function calculateStats() {
  state.vendorStats = {};
  state.orders.forEach((o) => {
    const vid = o.vendorId;
    if (!state.vendorStats[vid])
      state.vendorStats[vid] = { totalOrders: 0, revenue: 0 };
    state.vendorStats[vid].totalOrders += 1;
    if (o.status === "Selesai") state.vendorStats[vid].revenue += o.total || 0;
  });
}

// --- DASHBOARD ---
function renderDashboard() {
  const gtv = state.orders
    .filter((o) => o.status === "Selesai")
    .reduce((a, b) => a + (b.total || 0), 0);
  $("#kpiGTV").textContent = rupiah(gtv);
  $("#kpiOrders").textContent = state.orders.length;
  $("#kpiVendors").textContent = state.vendors.length;
  const adminRev = state.subscriptions
    .filter(
      (s) =>
        s.status === "redeemed" ||
        (s.status === "approved" && s.method === "qris"),
    )
    .reduce((a, b) => a + (b.amount || 0), 0);
  $("#kpiAdminRevenue").textContent = rupiah(adminRev);
  $("#revTotalDisplay").textContent = rupiah(adminRev);

  $("#latestSubs").innerHTML =
    state.subscriptions
      .slice(0, 4)
      .map(
        (s) => `
    <div class="trx-item">
        <div>
            <div style="font-weight:600; font-size:13px;">${s.vendorName}</div>
            <div class="muted" style="font-size:11px;">${new Date(
              s.timestamp,
            ).toLocaleDateString()} • ${
              s.method === "qris" ? "QRIS" : "Tunai"
            }</div>
        </div>
        <div class="trx-amount" style="background:${
          s.status === "pending" ? "#fef3c7" : "#dcfce7"
        }; color:${s.status === "pending" ? "#b45309" : "#166534"}">${
          s.status === "pending" ? "⏳ Wait" : "+" + rupiah(s.amount)
        }</div>
    </div>
  `,
      )
      .join("") ||
    '<div class="muted" style="text-align:center; padding:10px;">Belum ada pemasukan.</div>';

  $("#latestOrders").innerHTML = state.orders
    .slice(0, 5)
    .map(
      (o) => `
    <div class="item"><div><div style="font-weight:700">${
      o.vendorName
    }</div><div class="muted" style="font-size:12px">${new Date(
      o.createdAt,
    ).toLocaleTimeString()} • ${
      o.userName
    }</div></div><div style="text-align:right"><div style="font-weight:700; color:var(--orange)">${rupiah(
      o.total,
    )}</div><small class="pill">${o.status}</small></div></div>
  `,
    )
    .join("");
}

// --- TOPUP USER LOGIC ---
function renderTopupsTable() {
  const container = $("#topupsTable");
  if (state.topups.length === 0) {
    container.innerHTML = `<div style="padding:40px; text-align:center; color:#999; border:1px dashed #ccc; border-radius:12px;">Belum ada request topup.</div>`;
    return;
  }

  container.innerHTML = `
      <table>
          <thead><tr><th>Waktu</th><th>User</th><th>Nominal</th><th>Bukti</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>
              ${state.topups
                .map((t) => {
                  let proofHtml = t.proof
                    ? `<button onclick="viewTopupProof('${t.id}')" style="color:blue; text-decoration:underline; border:none; background:none; cursor:pointer; font-size:12px;">Lihat Bukti</button>`
                    : "-";

                  let statusBadge = "";
                  if (t.status === "pending")
                    statusBadge = `<span class="badge-pending">⏳ Menunggu</span>`;
                  else if (t.status === "approved")
                    statusBadge = `<span class="badge-success">✅ Berhasil</span>`;
                  else
                    statusBadge = `<span class="badge-fail">❌ Ditolak</span>`;

                  let actionBtn = "";
                  if (t.status === "pending") {
                    actionBtn = `<button class="btn small primary" onclick="verifyTopupUser('${t.id}')">🔍 Cek & Setujui</button>`;
                  } else {
                    actionBtn = `<span class="muted" style="font-size:11px;">Selesai</span>`;
                  }

                  return `
                  <tr>
                      <td>${new Date(t.timestamp).toLocaleString()}</td>
                      <td><b>${t.userName}</b></td>
                      <td style="color:#166534; font-weight:bold;">${rupiah(
                        t.amount,
                      )}</td>
                      <td>${proofHtml}</td>
                      <td>${statusBadge}</td>
                      <td>${actionBtn}</td>
                  </tr>`;
                })
                .join("")}
          </tbody>
      </table>`;
}

window.verifyTopupUser = (tid) => {
  const t = state.topups.find((x) => x.id === tid);
  if (!t) return;

  const content = $("#verifContent");
  const title = $("#verifTitle");
  $("#verificationModal").classList.remove("hidden");

  title.textContent = "Validasi Topup User";
  content.innerHTML = `
        <div style="text-align:center;">
            <p>User: <b>${t.userName}</b> request isi saldo:</p>
            <h2 style="color:#166534; margin:10px 0;">${rupiah(t.amount)}</h2>
            <img src="${
              t.proof
            }" class="proof-img-large" style="display:block; margin:10px auto; width:100%; max-width:300px; border-radius:8px; border:1px solid #ddd;" />
            <p class="muted" style="font-size:13px; margin-top:10px;">Cek mutasi bank Anda. Jika dana masuk, klik Setujui.</p>
            <div style="display:flex; gap:10px; margin-top:15px;">
                <button class="btn full" style="background:#fee2e2; color:#ef4444;" onclick="rejectTopupUser('${
                  t.id
                }')">Tolak</button>
                <button class="btn primary full" onclick="approveTopupUser('${
                  t.id
                }', '${t.userId}', ${
                  t.amount
                })">✅ Setujui (Auto Add Saldo)</button>
            </div>
        </div>
    `;
};

window.approveTopupUser = async (tid, uid, amount) => {
  if (
    !confirm(
      `Yakin setujui topup ${rupiah(
        amount,
      )}? Saldo user akan bertambah otomatis.`,
    )
  )
    return;

  try {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      const currentWallet = userSnap.data().wallet || 0;
      const newWallet = currentWallet + parseInt(amount);

      await updateDoc(userRef, { wallet: newWallet });
      await updateDoc(doc(db, "topups", tid), { status: "approved" });

      $("#verificationModal").classList.add("hidden");
      alert("Berhasil! Saldo user telah ditambahkan.");
    } else {
      alert("User tidak ditemukan di database!");
    }
  } catch (e) {
    alert("Error updating wallet: " + e.message);
  }
};

window.rejectTopupUser = async (tid) => {
  if (!confirm("Tolak permintaan ini?")) return;
  await updateDoc(doc(db, "topups", tid), { status: "rejected" });
  $("#verificationModal").classList.add("hidden");
};

// --- REVENUE TABLE ---
function renderRevenueTable() {
  const container = $("#revenueTable");
  if (state.subscriptions.length === 0) {
    container.innerHTML = `<div style="padding:40px; text-align:center; color:#999; border:1px dashed #ccc; border-radius:12px;">Belum ada data pembayaran masuk.</div>`;
    return;
  }

  container.innerHTML = `
    <table>
        <thead><tr><th>Waktu</th><th>Vendor</th><th>Metode</th><th>Bukti</th><th>Status</th><th>Aksi</th></tr></thead>
        <tbody>
            ${state.subscriptions
              .map((s) => {
                let proofHtml =
                  s.method === "qris" && s.proof
                    ? `<button onclick="viewSubscriptionProof('${s.id}')" style="color:blue; text-decoration:underline; border:none; background:none; cursor:pointer; font-size:12px;">Lihat Bukti</button>`
                    : "-";

                let statusBadge = "";
                if (s.status === "pending")
                  statusBadge = `<span class="badge-pending">⏳ Pending</span>`;
                else if (s.status === "approved")
                  statusBadge = `<span class="badge-pending" style="background:#bae6fd; color:#0369a1">🔑 Wait Input</span>`;
                else if (
                  s.status === "redeemed" ||
                  (s.status === "approved" && s.method === "qris")
                )
                  statusBadge = `<span class="badge-success">✅ Selesai</span>`;
                else statusBadge = `<span class="badge-fail">❌ Ditolak</span>`;

                let mainAction = "";
                if (s.status === "pending") {
                  if (s.method === "qris")
                    mainAction = `<button class="btn small primary" onclick="openVerification('${s.id}', 'qris')">🔍 Cek</button>`;
                  else
                    mainAction = `<button class="btn small primary" onclick="openVerification('${s.id}', 'cash')">💵 Terima</button>`;
                } else if (s.status === "approved" && s.method === "cash") {
                  mainAction = `<span style="font-size:11px; font-weight:bold; color:#0369a1;">Kode: ${s.activationCode}</span>`;
                } else {
                  mainAction = `<span class="muted" style="font-size:12px;">-</span>`;
                }

                const buttons = `
                    <div class="action-row">
                        ${mainAction}
                        <button class="btn small ghost" title="Edit" onclick="openEditSub('${s.id}')">✏️</button>
                        <button class="btn small" title="Hapus" style="color:red; border-color:#fee2e2; background:#fff1f2;" onclick="deleteSub('${s.id}')">🗑</button>
                    </div>
                `;

                return `
                <tr>
                    <td>${new Date(s.timestamp).toLocaleString()}</td>
                    <td><b>${s.vendorName}</b></td>
                    <td>${s.method ? s.method.toUpperCase() : "TUNAI"}</td>
                    <td>${proofHtml}</td>
                    <td>${statusBadge}</td>
                    <td>${buttons}</td>
                </tr>`;
              })
              .join("")}
        </tbody>
    </table>`;
}

// --- VERIFICATION LOGIC ---
window.openVerification = (subId, type) => {
  const sub = state.subscriptions.find((s) => s.id === subId);
  if (!sub) return;
  const content = $("#verifContent");
  const title = $("#verifTitle");
  $("#verificationModal").classList.remove("hidden");

  if (type === "qris") {
    title.textContent = "Validasi QRIS Mitra";
    content.innerHTML = `
            <div style="text-align:center;">
                <p>Mitra: <b>${sub.vendorName}</b></p>
                <img src="${sub.proof}" class="proof-img-large" style="display:block; margin:10px auto; max-width:100%; border-radius:8px; border:1px solid #ddd;" />
                <p class="muted">Pastikan dana Rp 5.000 sudah masuk.</p>
                <div style="display:flex; gap:10px; margin-top:15px;">
                    <button class="btn full" style="background:#fee2e2; color:#ef4444;" onclick="rejectSub('${sub.id}')">Tolak</button>
                    <button class="btn primary full" onclick="approveSub('${sub.id}', '${sub.vendorId}', 'qris')">Valid (Aktifkan)</button>
                </div>
            </div>`;
  } else {
    title.textContent = "Terima Pembayaran Tunai";
    content.innerHTML = `
            <div style="text-align:center; padding:20px 0;">
                <div style="font-size:40px; margin-bottom:10px;">💵</div>
                <h3>Rp 5.000</h3>
                <p>Apakah Anda sudah menerima uang dari <b>${sub.vendorName}</b>?</p>
                <div style="display:flex; gap:10px; margin-top:20px;">
                    <button class="btn full" style="background:#f1f5f9; color:#64748b;" onclick="$('#verificationModal').classList.add('hidden')">Batal</button>
                    <button class="btn primary full" onclick="approveSub('${sub.id}', '${sub.vendorId}', 'cash')">Ya, Terima Uang</button>
                </div>
            </div>`;
  }
};

window.approveSub = async (subId, vendorId, type) => {
  const now = Date.now();
  const activationCode = Math.floor(1000 + Math.random() * 9000);

  if (type === "cash") {
    await updateDoc(doc(db, "subscriptions", subId), {
      status: "approved",
      activationCode: activationCode,
    });
    $("#verifContent").innerHTML = `
            <div style="text-align:center;">
                <div style="font-size:40px; margin-bottom:10px;">✅</div>
                <h3>Uang Diterima!</h3>
                <p>Berikan kode ini ke Seller:</p>
                <div class="activation-code-box">${activationCode}</div>
                <p class="muted" style="font-size:12px;">Akun seller BELUM AKTIF sampai kode ini dimasukkan.</p>
                <button class="btn primary full" onclick="$('#verificationModal').classList.add('hidden')">Tutup</button>
            </div>`;
  } else {
    if (!confirm("Yakin bukti ini valid?")) return;
    await updateDoc(doc(db, "subscriptions", subId), {
      status: "approved",
      activationCode: activationCode,
    });
    await updateDoc(doc(db, "vendors", vendorId), {
      subscriptionExpiry: now + 30 * 24 * 60 * 60 * 1000,
      isLive: true,
    });
    $("#verificationModal").classList.add("hidden");
  }
};

window.rejectSub = async (subId) => {
  if (!confirm("Tolak pembayaran ini?")) return;
  await updateDoc(doc(db, "subscriptions", subId), { status: "rejected" });
  $("#verificationModal").classList.add("hidden");
};

// --- EDIT & DELETE SUBSCRIPTION ---
window.deleteSub = async (id) => {
  if (confirm("Yakin hapus data transaksi ini selamanya?")) {
    await deleteDoc(doc(db, "subscriptions", id));
  }
};

window.openEditSub = (id) => {
  state.selectedSubId = id;
  const sub = state.subscriptions.find((s) => s.id === id);
  if (!sub) return;

  $("#esName").value = sub.vendorName;
  $("#esMethod").value = (sub.method || "cash").toUpperCase();
  $("#esStatus").value = sub.status;
  $("#editSubModal").classList.remove("hidden");
};

$("#editSubForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.selectedSubId) return;

  const newStatus = $("#esStatus").value;

  await updateDoc(doc(db, "subscriptions", state.selectedSubId), {
    status: newStatus,
  });

  $("#editSubModal").classList.add("hidden");
});

// --- ORDERS CRUD ---
function renderOrdersTable() {
  $("#ordersTable").innerHTML =
    `<table><thead><tr><th>Waktu</th><th>User</th><th>Vendor</th><th>Total</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${state.orders
      .map(
        (o) =>
          `<tr><td>${new Date(o.createdAt).toLocaleString()}</td><td>${
            o.userName
          }</td><td>${o.vendorName}</td><td><b>${rupiah(
            o.total,
          )}</b></td><td><span class="pill">${
            o.status
          }</span></td><td><button class="btn small ghost" onclick="openOrd('${
            o.id
          }')">Edit</button> <button class="btn small" onclick="deleteOrd('${
            o.id
          }')" style="color:red; border-color:#fee">🗑</button></td></tr>`,
      )
      .join("")}</tbody></table>`;
}
window.openOrd = (id) => {
  state.selectedOrderId = id;
  const o = state.orders.find((x) => x.id === id);
  $("#ordStatus").value = o.status;
  $("#ordItems").innerHTML =
    o.items
      .map(
        (i) =>
          `<div class="rowBetween" style="margin-bottom:6px"><span>${
            i.name
          } <small>x${i.qty}</small></span><span>${rupiah(
            i.price * i.qty,
          )}</span></div>`,
      )
      .join("") +
    `<hr style="margin:10px 0; border:none; border-top:1px dashed #ccc"><div class="rowBetween"><b>Total</b><b>${rupiah(
      o.total,
    )}</b></div>`;
  $("#orderModal").classList.remove("hidden");
};
$("#saveStatusBtn").addEventListener("click", async () => {
  await updateDoc(doc(db, "orders", state.selectedOrderId), {
    status: $("#ordStatus").value,
  });
  $("#orderModal").classList.add("hidden");
});
window.deleteOrd = async (id) => {
  if (confirm("Hapus?")) await deleteDoc(doc(db, "orders", id));
};

// --- VENDOR CRUD ---
function renderVendors() {
  $("#vendorAdminList").innerHTML = state.vendors
    .map((v) => {
      const stats = state.vendorStats[v.id] || { totalOrders: 0, revenue: 0 };
      return `
        <div class="item" style="display:flex; flex-direction:column; align-items:stretch; gap:10px;">
            <div class="rowBetween">
                <div><div style="font-weight:700; font-size:16px;">${
                  v.name
                }</div><div class="muted" style="font-size:12px">${v.type.toUpperCase()} • Rating ${
                  v.rating || 0
                }</div></div>
                <div style="display:flex; gap:6px;"><button class="btn small ghost" onclick="openEditVendor('${
                  v.id
                }')">Edit</button><button class="btn small" style="color:red; border:1px solid #fee" onclick="deleteVendor('${
                  v.id
                }')">Hapus</button></div>
            </div>
            <div style="display:flex; gap:10px; background:#f8fafc; padding:8px; border-radius:8px;">
                <div style="flex:1; text-align:center; border-right:1px solid #e2e8f0;"><div style="font-size:10px; color:#64748b; font-weight:600;">ORDER</div><div style="font-weight:800; font-size:16px;">${
                  stats.totalOrders
                }</div></div>
                <div style="flex:1; text-align:center;"><div style="font-size:10px; color:#64748b; font-weight:600;">OMZET</div><div style="font-weight:800; font-size:16px; color:#10b981;">${rupiah(
                  stats.revenue,
                )}</div></div>
            </div>
        </div>`;
    })
    .join("");
}
$("#addVendorBtn").addEventListener("click", async () => {
  const n = prompt("Nama Vendor:");
  if (n)
    await addDoc(collection(db, "vendors"), {
      name: n,
      type: "bakso",
      ico: "🥘",
      rating: 4.5,
      busy: "Sepi",
      lat: -6.2,
      lon: 106.8,
    });
});
window.openEditVendor = (id) => {
  state.selectedVendorId = id;
  const v = state.vendors.find((x) => x.id === id);
  if (!v) return;
  $("#evName").value = v.name;
  $("#evType").value = v.type;
  $("#evRating").value = v.rating || 0;
  $("#editVendorModal").classList.remove("hidden");
};
$("#editVendorForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  await updateDoc(doc(db, "vendors", state.selectedVendorId), {
    name: $("#evName").value,
    type: $("#evType").value,
    rating: parseFloat($("#evRating").value),
  });
  $("#editVendorModal").classList.add("hidden");
});
window.deleteVendor = async (id) => {
  if (confirm("Yakin hapus vendor?")) await deleteDoc(doc(db, "vendors", id));
};

// --- BANNERS ---
function renderVendorDropdown() {
  $("#bnVendor").innerHTML =
    `<option value="">-- Info Umum (Tanpa Link) --</option>` +
    state.vendors
      .map((v) => `<option value="${v.id}">${v.name}</option>`)
      .join("");
}
function renderBanners() {
  $("#bannerList").innerHTML = state.banners
    .map(
      (b) =>
        `<div style="border-radius:16px; overflow:hidden; border:1px solid #eee; position:relative; box-shadow:0 4px 12px rgba(0,0,0,0.05);"><div style="background:${
          b.c
        }; padding:16px; color:white; height:120px; display:flex; flex-direction:column; justify-content:center;"><span style="font-size:10px; background:rgba(0,0,0,0.2); width:fit-content; padding:2px 8px; border-radius:10px; margin-bottom:4px;">${
          b.vName || "Info Umum"
        }</span><h3 style="margin:0; font-size:18px;">${
          b.t
        }</h3><p style="margin:4px 0 0; font-size:12px; opacity:0.9">${
          b.d
        }</p></div><button onclick="deleteBanner('${
          b.id
        }')" style="position:absolute; top:10px; right:10px; background:white; color:red; border:none; width:28px; height:28px; border-radius:50%; cursor:pointer; font-weight:bold; box-shadow:0 2px 5px rgba(0,0,0,0.2);">✕</button></div>`,
    )
    .join("");
}
$("#addBannerBtn").addEventListener("click", () => {
  renderVendorDropdown();
  $("#bannerModal").classList.remove("hidden");
  $("#bnTitle").value = "";
  $("#bnDesc").value = "";
  $("#bnVendor").value = "";
  window.updatePreviewText();
});
window.updatePreviewText = () => {
  const t = $("#bnTitle").value || "Judul Promo";
  const d = $("#bnDesc").value || "Keterangan singkat...";
  const vId = $("#bnVendor").value;
  $("#prevTitle").textContent = t;
  $("#prevDesc").textContent = d;
  if (vId) {
    const v = state.vendors.find((x) => x.id === vId);
    $("#prevVendor").textContent = "Promosi: " + (v ? v.name : "Vendor");
  } else {
    $("#prevVendor").textContent = "Info Promo";
  }
};
window.switchColorTab = (mode) => {
  const tabs = $$(".tab-btn");
  if (mode === "template") {
    tabs[0].classList.add("active");
    tabs[1].classList.remove("active");
    $("#tabColorTemplate").classList.remove("hidden");
    $("#tabColorCustom").classList.add("hidden");
  } else {
    tabs[1].classList.add("active");
    tabs[0].classList.remove("active");
    $("#tabColorTemplate").classList.add("hidden");
    $("#tabColorCustom").classList.remove("hidden");
    window.updateCustomGradient();
  }
};
window.selectPreset = (el) => {
  const bg = el.style.background;
  $("#bannerPreview").style.background = bg;
  $("#finalColor").value = bg;
  $$(".preset-item").forEach((i) => (i.style.border = "2px solid transparent"));
  el.style.border = "2px solid #333";
};
window.updateCustomGradient = () => {
  const c1 = $("#color1").value;
  const c2 = $("#color2").value;
  const grad = `linear-gradient(135deg, ${c1}, ${c2})`;
  $("#bannerPreview").style.background = grad;
  $("#finalColor").value = grad;
};
$("#bannerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const vid = $("#bnVendor").value;
  const v = state.vendors.find((x) => x.id === vid);
  await addDoc(collection(db, "banners"), {
    t: $("#bnTitle").value,
    d: $("#bnDesc").value,
    c: $("#finalColor").value,
    vid: vid || null,
    vName: v ? v.name : null,
    createdAt: Date.now(),
  });
  $("#bannerModal").classList.add("hidden");
});
window.deleteBanner = async (id) => {
  if (confirm("Hapus iklan ini?")) await deleteDoc(doc(db, "banners", id));
};
$$("[data-close]").forEach((b) =>
  b.addEventListener("click", () =>
    $("#" + b.dataset.close).classList.add("hidden"),
  ),
);
