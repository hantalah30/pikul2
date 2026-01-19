import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  getDoc,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  updateDoc,
  setDoc,
  increment,
  limit, // [BARU] Import limit
  deleteDoc, // [BARU] Pastikan deleteDoc ada
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
// [BARU] Import Messaging untuk Notifikasi
import {
  getMessaging,
  getToken,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js";
import { firebaseConfig } from "./firebase-config.js";

const audioSelesaiMasak = new Audio("pesanan-selesai-dimasak.mp3");
const audioBayarBerhasil = new Audio("pembayaran-berhasil.mp3");

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const messaging = getMessaging(app); // [BARU] Init Messaging

const $ = (q) => document.querySelector(q);
const $$ = (q) => document.querySelectorAll(q);
function rupiah(n) {
  return "Rp " + (n || 0).toLocaleString("id-ID");
}

// --- STATE ---
const screens = {
  Home: $("#screenHome"),
  Map: $("#screenMap"),
  Orders: $("#screenOrders"),
  Messages: $("#screenMessages"),
  Profile: $("#screenProfile"),
};
let state = {
  user: null,
  you: { ok: false, lat: -6.2, lon: 106.816666 },
  vendors: [],
  cart: [],
  orders: [],
  banners: [],
  selectedVendorId: null,
  chatWithVendorId: null,
  activeMapVendorId: null,
  activeCategory: "Semua",
  mapCategory: "Semua",
  firstLoad: true,
  unsubChats: null,
  activeOrderTab: "active",
  map: null,
  markers: {},
  userMarker: null,
  routeLine: null,
  trackingVendorId: null,
  lastNearestId: null,
  tempPaymentProof: null,
  topupAmount: 0,
  tempTopupProof: null,
  watchId: null,
  mapLocked: false,
  // State Voucher
  activeVoucher: null,
  // [BARU] State Pengiriman
  deliveryMethod: "pickup", // 'pickup' atau 'delivery'
};

let isIslandExpanded = false;

// --- HELPER: IMAGE COMPRESSOR ---
function compressImage(file, maxWidth = 600, quality = 0.6) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height *= maxWidth / width));
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
    };
  });
}
function generatePin() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}
function getDistanceVal(v) {
  if (!state.you.ok) return 999999;
  return Math.sqrt(
    Math.pow(v.lat - state.you.lat, 2) + Math.pow(v.lon - state.you.lon, 2),
  );
}

// --- HELPER: LOCAL STORAGE CART ---
function saveCart() {
  localStorage.setItem("pikul_cart", JSON.stringify(state.cart));
  updateFab();
}

function loadCart() {
  const stored = localStorage.getItem("pikul_cart");
  if (stored) {
    try {
      state.cart = JSON.parse(stored);
      updateFab();
    } catch (e) {
      console.error("Gagal memuat keranjang", e);
      state.cart = [];
    }
  }
}

// --- [BARU] LOGIC NOTIFIKASI FCM ---
async function initFCM(userId) {
  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      // GANTI 'GANTI_DENGAN_VAPID_KEY' dengan Keypair dari Firebase Console -> Project Settings -> Cloud Messaging -> Web Push cert
      const token = await getToken(messaging, {
        vapidKey: "GANTI_DENGAN_VAPID_KEY_ANDA",
      });
      if (token) {
        console.log("FCM Token:", token);
        // Simpan token ke database user (opsional, untuk kirim notif server-side)
        // await updateDoc(doc(db, "users", userId), { fcmToken: token });
      }
    }
  } catch (error) {
    console.log("FCM Error:", error);
  }
}

// --- [BARU] DELIVERY METHOD TOGGLE ---
window.setDeliveryMethod = (method) => {
  state.deliveryMethod = method;

  // Update UI Button Class
  const btnPickup = document.getElementById("btnPickup");
  const btnDelivery = document.getElementById("btnDelivery");

  if (btnPickup && btnDelivery) {
    btnPickup.classList.toggle("active", method === "pickup");
    btnDelivery.classList.toggle("active", method === "delivery");
  }

  const addrField = document.getElementById("deliveryAddressField");
  if (addrField) {
    if (method === "delivery") {
      addrField.classList.remove("hidden");
    } else {
      addrField.classList.add("hidden");
    }
  }
};

// --- AUTH LOGIC ---
window.switchAuthMode = (mode) => {
  if (mode === "login") {
    $("#loginForm").classList.remove("hidden");
    $("#registerForm").classList.add("hidden");
  } else {
    $("#loginForm").classList.add("hidden");
    $("#registerForm").classList.remove("hidden");
  }
};
window.requireLogin = () => {
  showToast("Silakan login terlebih dahulu.");
  showAuth();
};
window.closeAuth = () => {
  showApp();
};

window.continueGuest = () => {
  state.user = null;
  localStorage.removeItem("pikul_user_id");
  showApp();
  bootApp();
  showToast("Masuk sebagai Tamu");
};

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#loginEmail").value.trim(),
    pass = $("#loginPass").value,
    btn = e.target.querySelector("button");

  btn.disabled = true;
  btn.textContent = "Memproses...";

  try {
    const q = query(collection(db, "users"), where("email", "==", email));
    const s = await getDocs(q);
    if (s.empty) {
      alert("Email tidak ditemukan.");
      btn.disabled = false;
      btn.textContent = "Masuk";
      return;
    }
    const uData = s.docs[0].data();
    if (uData.password && uData.password !== pass) {
      alert("Password salah!");
      btn.disabled = false;
      btn.textContent = "Masuk";
      return;
    }

    // --- SUKSES LOGIN ---
    state.user = { id: s.docs[0].id, ...uData };
    localStorage.setItem("pikul_user_id", state.user.id);

    showApp();
    bootApp();

    window.go("Home");
    showToast("Selamat datang kembali! 👋");
  } catch (err) {
    alert("Error: " + err.message);
  }
  btn.disabled = false;
  btn.textContent = "Masuk";
});
$("#registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#regName").value.trim(),
    email = $("#regEmail").value.trim(),
    phone = $("#regPhone").value.trim(),
    pass = $("#regPass").value,
    btn = e.target.querySelector("button");

  if (pass.length < 6) return alert("Password min 6 karakter");
  if (phone.length < 9) return alert("Nomor WA tidak valid");

  btn.disabled = true;
  btn.textContent = "Mendaftar...";

  try {
    const q = query(collection(db, "users"), where("email", "==", email));
    const s = await getDocs(q);
    if (!s.empty) {
      alert("Email sudah terdaftar.");
      btn.disabled = false;
      btn.textContent = "Daftar";
      return;
    }

    const newUser = {
      name,
      email,
      phone,
      password: pass,
      wallet: 0,
      createdAt: Date.now(),
    };

    const ref = await addDoc(collection(db, "users"), newUser);

    // --- SUKSES REGISTER ---
    state.user = { id: ref.id, ...newUser };
    localStorage.setItem("pikul_user_id", ref.id);

    showApp();
    bootApp();

    window.go("Home");
    showToast("Akun berhasil dibuat! 🎉");
  } catch (err) {
    alert("Gagal daftar: " + err.message);
  }
  btn.disabled = false;
  btn.textContent = "Daftar";
});
async function initAuth() {
  const uid = localStorage.getItem("pikul_user_id");
  if (uid) {
    try {
      const snap = await getDoc(doc(db, "users", uid));
      if (snap.exists()) state.user = { id: snap.id, ...snap.data() };
      else localStorage.removeItem("pikul_user_id");
    } catch (e) {
      state.user = null;
    }
  }
  showApp();
  bootApp();
}

// --- BOOT & NAV AUTO HIDE ---
function initAutoHideNav() {
  let lastScroll = 0;
  const content = document.querySelector(".content");
  const nav = document.querySelector(".bottomNav");
  if (content) {
    content.addEventListener("scroll", () => {
      const currentScroll = content.scrollTop;
      if (currentScroll > lastScroll && currentScroll > 50) {
        nav.classList.add("nav-hidden");
      } else {
        nav.classList.remove("nav-hidden");
      }
      lastScroll = currentScroll;
    });
  }
}

async function bootApp() {
  $("#userName").textContent = state.user ? state.user.name : "Tamu";
  initAutoHideNav();
  loadCart();

  if (state.user) {
    // [BARU] Jalankan FCM setelah login
    initFCM(state.user.id);

    onSnapshot(doc(db, "users", state.user.id), (doc) => {
      if (doc.exists()) {
        state.user = { id: doc.id, ...doc.data() };
        const walletEl = $("#wallet");
        if (walletEl) walletEl.textContent = rupiah(state.user.wallet);
      }
    });
  }

  onSnapshot(collection(db, "vendors"), (s) => {
    state.vendors = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderMapChips();
    if (!$("#screenHome").classList.contains("hidden")) renderVendors();

    if (
      !$("#screenMap").classList.contains("hidden") ||
      state.trackingVendorId
    ) {
      updateMapMarkers();
    }

    if (
      !$("#vendorModal").classList.contains("hidden") &&
      state.selectedVendorId
    )
      openVendor(state.selectedVendorId);
  });

  onSnapshot(collection(db, "banners"), (s) => {
    state.banners = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!$("#screenHome").classList.contains("hidden")) renderHome();
  });

  if (state.user) {
    onSnapshot(
      query(collection(db, "orders"), where("userId", "==", state.user.id)),
      (s) => {
        // --- LOGIKA SUARA GLOBAL ---
        if (!state.firstLoad) {
          s.docChanges().forEach((change) => {
            if (change.type === "modified") {
              const newData = change.doc.data();
              const oldData = state.orders.find((o) => o.id === change.doc.id);

              if (oldData) {
                if (
                  oldData.status === "Menunggu Konfirmasi Bayar" &&
                  newData.status === "Diproses"
                ) {
                  console.log("🔔 Pembayaran berhasil!");
                  audioBayarBerhasil
                    .play()
                    .catch((e) => console.log("Audio error:", e));
                  showToast("✅ Pembayaran Berhasil Diverifikasi!");
                }

                if (
                  oldData.status === "Diproses" &&
                  newData.status === "Siap Diambil/Diantar"
                ) {
                  console.log("🔔 Pesanan selesai masak!");
                  audioSelesaiMasak
                    .play()
                    .catch((e) => console.log("Audio error:", e));
                  showToast("🍲 Pesanan Selesai Dimasak!");
                }
              }
            }
          });
        }

        let raw = s.docs.map((d) => ({ id: d.id, ...d.data() }));
        state.orders = raw.sort(
          (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
        );
        state.firstLoad = false;
        renderOrders();
      },
    );
  } else {
    state.orders = [];
    renderOrders();
  }
}

// --- GPS SYSTEM IMPROVED ---
function startGPS() {
  if (!navigator.geolocation) {
    showToast("GPS tidak didukung perangkat ini");
    return;
  }
  if (state.watchId) return;

  const options = {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 0,
  };

  state.watchId = navigator.geolocation.watchPosition(
    (p) => {
      state.you = { ok: true, lat: p.coords.latitude, lon: p.coords.longitude };
      const gpsStatus = $("#gpsStatus");
      if (gpsStatus) {
        gpsStatus.textContent = "GPS Aktif";
        gpsStatus.className = "pill success";
        gpsStatus.style.background = "#dcfce7";
        gpsStatus.style.color = "#166534";
      }
      if (state.map && state.userMarker) {
        state.userMarker.setLatLng([state.you.lat, state.you.lon]);
        if (state.mapLocked) {
          state.map.setView([state.you.lat, state.you.lon], 16);
        }
        updateMapMarkers();
      }
    },
    (err) => {
      console.error("GPS Error:", err);
      $("#gpsStatus").textContent = "GPS Error";
      $("#gpsStatus").className = "pill warn";
    },
    options,
  );
}

// --- MAP & LIVE TRACKING ---
function initMap() {
  if (state.map) return;
  if (!$("#map")) return;

  state.map = L.map("map", { zoomControl: false }).setView(
    [state.you.lat, state.you.lon],
    15,
  );

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OSM",
  }).addTo(state.map);

  const userIcon = L.divIcon({ className: "user-pulse", iconSize: [20, 20] });
  state.userMarker = L.marker([state.you.lat, state.you.lon], {
    icon: userIcon,
  }).addTo(state.map);

  L.circle([state.you.lat, state.you.lon], {
    color: "#3b82f6",
    fillColor: "#3b82f6",
    fillOpacity: 0.1,
    radius: 100,
    weight: 1,
  }).addTo(state.map);

  updateMapMarkers();
}

window.toggleMapLock = () => {
  state.mapLocked = !state.mapLocked;
  const btn = $("#lockGpsBtn");
  if (state.mapLocked) {
    btn.classList.add("active");
    if (state.you.ok) state.map.setView([state.you.lat, state.you.lon], 16);
    showToast("📍 Peta Terkunci ke Posisi Anda");
  } else {
    btn.classList.remove("active");
    showToast("🔓 Peta Bebas");
  }
};

function updateMapMarkers(fitBounds = false) {
  if (!state.map) return;
  const cat = state.mapCategory.toLowerCase();
  let filtered = state.vendors.filter(
    (v) => cat === "semua" || v.type.toLowerCase().includes(cat),
  );
  if (state.you.ok)
    filtered.sort((a, b) => getDistanceVal(a) - getDistanceVal(b));

  $("#realtimeList").innerHTML = filtered
    .map((v, idx) => {
      const isClosed = !v.isLive;
      const statusText = isClosed ? "🔴 Tutup" : `📍 ${distText(v)}`;
      const isNearest = idx === 0 && !isClosed && state.you.ok;
      const itemClass = isNearest
        ? "listItem nearest"
        : isClosed
          ? "listItem closed"
          : "listItem";
      return `<div class="${itemClass}" onclick="openVendor('${
        v.id
      }')" style="cursor:pointer"><div class="rowBetween"><div><b>${v.ico} ${
        v.name
      }</b><div class="muted" style="font-size:12px">(${v.lat.toFixed(
        4,
      )}, ${v.lon.toFixed(
        4,
      )})</div></div><div class="pill small">${statusText}</div></div></div>`;
    })
    .join("");

  const bounds = L.latLngBounds();
  if (state.you.ok) bounds.extend([state.you.lat, state.you.lon]);

  Object.keys(state.markers).forEach((id) => {
    const v = filtered.find((x) => x.id === id);
    if (!v) {
      state.map.removeLayer(state.markers[id]);
      delete state.markers[id];
    }
  });

  filtered.forEach((v) => {
    bounds.extend([v.lat, v.lon]);
    if (state.markers[v.id]) {
      state.markers[v.id].setLatLng([v.lat, v.lon]);
      const el = state.markers[v.id].getElement();
      if (el) {
        if (!v.isLive) el.style.filter = "grayscale(100%) opacity(0.5)";
        else el.style.filter = "none";
      }
    } else {
      const html = `<div class="vendor-marker-custom" id="mark-${v.id}"><div class="vm-bubble">${v.ico}</div><div class="vm-arrow"></div></div>`;
      const icon = L.divIcon({
        className: "custom-div-icon",
        html: html,
        iconSize: [40, 50],
        iconAnchor: [20, 50],
      });
      const m = L.marker([v.lat, v.lon], { icon: icon }).addTo(state.map);
      m.on("click", () => selectVendorOnMap(v));
      state.markers[v.id] = m;
    }
  });

  if (fitBounds && filtered.length > 0) {
    state.map.fitBounds(bounds, { padding: [50, 50] });
  }
}

// --- STANDARD APP FUNCTIONS ---
window.expandIsland = () => {
  if (isIslandExpanded || !state.chatWithVendorId) return;
  const island = document.getElementById("dynamicIsland");
  island.classList.remove("hidden");
  requestAnimationFrame(() => {
    island.classList.add("expanded");
    isIslandExpanded = true;
    scrollToBottom();
  });
};

window.collapseIsland = (e) => {
  if (e) e.stopPropagation();
  const island = document.getElementById("dynamicIsland");
  island.classList.remove("expanded");
  isIslandExpanded = false;
  document.getElementById("attachMenu").classList.remove("active");
  document.getElementById("emojiPanel").classList.remove("active");
};

window.selectChat = (vid) => {
  if (!state.user) return requireLogin();
  state.chatWithVendorId = vid;
  const vendor = state.vendors.find((v) => v.id === vid) || {
    name: "Mitra Pikul",
  };
  document.getElementById("diChatName").innerText = vendor.name;
  const island = document.getElementById("dynamicIsland");
  island.classList.remove("hidden");
  renderChatInsideIsland();
  setTimeout(() => {
    island.classList.add("expanded");
    isIslandExpanded = true;
  }, 100);
  closeModal("vendorModal");
};

// --- [UPDATED] CHAT LOGIC WITH PAGINATION ---
async function renderChatInsideIsland() {
  const vid = state.chatWithVendorId;
  const chatBox = $("#diChatBox");
  chatBox.innerHTML = "";

  if (state.unsubChats) state.unsubChats();

  const cid = `${state.user.id}_${vid}`;

  // [BARU] Tambahkan limit(20) dan urutkan descending (terbaru)
  // Nanti kita reverse array-nya di client agar tampil urut dari atas ke bawah
  const q = query(
    collection(db, "chats", cid, "messages"),
    orderBy("ts", "desc"),
    limit(20),
  );

  state.unsubChats = onSnapshot(q, (s) => {
    // Reverse array agar pesan terlama ada di atas, terbaru di bawah
    const messages = s.docs.map((d) => d.data()).reverse();

    chatBox.innerHTML = messages
      .map((m) => {
        const isMe = m.from === state.user.id;
        let contentHtml = "";
        if (m.type === "image") {
          contentHtml = `<div class="bubble me"><img src="${m.text}" loading="lazy" /></div>`;
        } else if (m.type === "sticker") {
          contentHtml = `<div class="bubble sticker me"><img src="${m.text}" style="width:100px; height:auto; border:none;" /></div>`;
        } else if (m.type === "location") {
          const link = m.text.startsWith("http") ? m.text : "#";
          contentHtml = `<a href="${link}" target="_blank" class="bubble location me" style="text-decoration:none; color:white; display:flex; align-items:center; gap:8px;">
            <div style="background:rgba(255,255,255,0.2); width:32px; height:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:16px;">📍</div>
            <div style="display:flex; flex-direction:column;">
                <b style="font-size:13px; color:white;">Lokasi Saya</b>
                <span style="font-size:10px; opacity:0.8; color:rgba(255,255,255,0.7);">Klik untuk buka Maps</span>
            </div>
          </a>`;
        } else {
          contentHtml = `<div class="bubble ${isMe ? "me" : "them"}">${
            m.text
          }</div>`;
        }
        return `<div style="display:flex; justify-content:${
          isMe ? "flex-end" : "flex-start"
        }; margin-bottom:4px;">${contentHtml}</div>`;
      })
      .join("");
    scrollToBottom();
  });
}

function scrollToBottom() {
  const chatBox = document.getElementById("diChatBox");
  if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;
}

window.sendMessage = async (content = null, type = "text") => {
  if (!state.user) return requireLogin();
  if (!state.chatWithVendorId) return;
  if (!content) {
    const input = document.getElementById("diChatInput");
    content = input.value.trim();
    input.value = "";
    input.focus();
  }
  if (!content) return;
  const cid = `${state.user.id}_${state.chatWithVendorId}`;
  const vid = state.chatWithVendorId;
  await addDoc(collection(db, "chats", cid, "messages"), {
    text: content,
    type: type,
    from: state.user.id,
    ts: Date.now(),
  });
  let preview =
    type === "text"
      ? content
      : type === "image"
        ? "📷 Foto"
        : type === "sticker"
          ? "😊 Stiker"
          : "📍 Lokasi";
  const v = state.vendors.find((x) => x.id === vid);
  await setDoc(
    doc(db, "chats", cid),
    {
      userId: state.user.id,
      userName: state.user.name,
      vendorId: vid,
      vendorName: v ? v.name : "Unknown",
      lastMessage: preview,
      lastUpdate: Date.now(),
    },
    { merge: true },
  );
  scrollToBottom();
};

window.toggleAttachMenu = () => {
  const menu = document.getElementById("attachMenu");
  menu.classList.toggle("active");
  document.getElementById("emojiPanel").classList.remove("active");
};
window.triggerImageInput = () => {
  document.getElementById("imageInput").click();
  toggleAttachMenu();
};
window.handleImageUpload = async (event) => {
  const file = event.target.files[0];
  if (file) {
    const base64 = await compressImage(file, 500, 0.7);
    sendMessage(base64, "image");
  }
};
window.sendLocation = () => {
  toggleAttachMenu();
  if (!state.you || !state.you.ok) return showToast("⚠️ GPS belum aktif");
  const mapsUrl = `https://www.google.com/maps?q=${state.you.lat},${state.you.lon}`;
  sendMessage(mapsUrl, "location");
};
window.toggleEmojiPanel = () => {
  const panel = document.getElementById("emojiPanel");
  panel.classList.toggle("active");
  document.getElementById("attachMenu").classList.remove("active");
  const emojiGrid = document.getElementById("tabEmoji");
  if (emojiGrid.children.length === 0) {
    const emojis = [
      "😀",
      "😁",
      "😂",
      "😍",
      "😎",
      "😭",
      "😡",
      "👍",
      "👎",
      "🙏",
      "🔥",
      "✨",
      "❤️",
      "🛒",
      "📦",
      "🏍️",
    ];
    emojis.forEach((e) => {
      const span = document.createElement("div");
      span.className = "emoji-item";
      span.innerText = e;
      span.onclick = () => {
        document.getElementById("diChatInput").value += e;
      };
      emojiGrid.appendChild(span);
    });
  }
};
window.showTab = (type) => {
  document.getElementById("tabEmoji").style.display =
    type === "emoji" ? "grid" : "none";
  document.getElementById("tabSticker").style.display =
    type === "sticker" ? "grid" : "none";
  const tabs = document.querySelectorAll(".panel-tab");
  tabs[0].classList.toggle("active", type === "emoji");
  tabs[1].classList.toggle("active", type === "sticker");
};
window.sendSticker = (src) => {
  sendMessage(src, "sticker");
  document.getElementById("emojiPanel").classList.remove("active");
};
document
  .getElementById("diChatInput")
  .addEventListener("keypress", function (e) {
    if (e.key === "Enter") sendMessage();
  });

function renderInbox() {
  if (!state.user) {
    $("#inboxList").innerHTML =
      `<div class="empty-state-box">Login untuk melihat pesan.</div>`;
    return;
  }
  const list = state.vendors
    .map((v) => {
      return `<div class="listItem" onclick="selectChat('${v.id}')" style="cursor:pointer; display:flex; align-items:center; gap:12px;">
      <div style="width:45px; height:45px; background:#f1f5f9; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:20px;">${v.ico}</div>
      <div style="flex:1;">
        <b style="font-size:15px;">${v.name}</b>
        <div class="muted" style="font-size:13px;">Klik untuk chat</div>
      </div>
      <button class="btn small ghost">Chat</button>
    </div>`;
    })
    .join("");
  $("#inboxList").innerHTML =
    list || `<div class="empty-state-box">Belum ada pedagang.</div>`;
}

function renderHome() {
  let promoData =
    state.banners.length > 0
      ? state.banners
      : [
          {
            t: "Diskon 50%",
            d: "Pengguna Baru",
            c: "linear-gradient(135deg, #ff7a00, #ff4d00)",
            vid: null,
          },
        ];
  $("#promoList").innerHTML = promoData
    .map(
      (p) =>
        `<div class="promo-card" style="background: ${p.c};" onclick="${
          p.vid ? `openVendor('${p.vid}')` : ""
        }"><div class="promo-decor decor-1"></div><div class="promo-decor decor-2"></div><div class="promo-content">${
          p.vName
            ? `<div class="promo-tag">Promosi: ${p.vName}</div>`
            : `<div class="promo-tag">Info Promo</div>`
        }<h3 class="promo-title">${p.t}</h3><p class="promo-desc">${
          p.d
        }</p></div></div>`,
    )
    .join("");
  $("#promoDots").innerHTML = promoData
    .map(
      (_, i) =>
        `<div class="dot ${i === 0 ? "active" : ""}" id="dot-${i}"></div>`,
    )
    .join("");
  setupBannerScroll(promoData.length);
}
let bannerInterval;
function setupBannerScroll(count) {
  const slider = $("#promoList");
  if (bannerInterval) clearInterval(bannerInterval);
  slider.addEventListener("scroll", () => {
    const activeIndex = Math.round(
      slider.scrollLeft / (slider.offsetWidth * 0.9),
    );
    for (let i = 0; i < count; i++) {
      const dot = $(`#dot-${i}`);
      if (dot)
        i === activeIndex
          ? dot.classList.add("active")
          : dot.classList.remove("active");
    }
  });
}
window.setCategory = (c) => {
  state.activeCategory = c;
  renderVendors();
};
function renderVendors() {
  const q = ($("#search").value || "").toLowerCase();
  const cat = state.activeCategory.toLowerCase();
  let list = state.vendors.filter(
    (v) =>
      v.name.toLowerCase().includes(q) &&
      (cat === "semua" || v.type.includes(cat)),
  );
  if (state.you.ok) {
    list.sort((a, b) => {
      if (a.isLive && !b.isLive) return -1;
      if (!a.isLive && b.isLive) return 1;
      return getDistanceVal(a) - getDistanceVal(b);
    });
  }
  $("#vendorList").innerHTML =
    list
      .map((v) => {
        const isClosed = !v.isLive;
        const statusBadge = isClosed
          ? `<span class="chip closed">🔴 TUTUP</span>`
          : `<span class="chip" style="background:#dcfce7; color:#166534;"><span class="status-dot"></span> BUKA • ${distText(
              v,
            )}</span>`;
        const cardClass = isClosed ? "vendorCard closed" : "vendorCard open";
        const actionText = isClosed ? "Tutup" : "Lihat Menu";
        const actionColor = isClosed ? "color:#94a3b8" : "color:var(--primary)";
        const logoDisplay = v.logo ? `<img src="${v.logo}" />` : v.ico;
        return `
    <div class="${cardClass}" onclick="openVendor('${v.id}')">
        <div class="vIco">${logoDisplay}</div>
        <div class="vMeta">
            <b>${v.name}</b>
            <div class="muted">⭐ ${v.rating ? v.rating.toFixed(1) : "New"} • ${
              v.busy
            }</div>
            <div class="chips">
                <span class="chip">${v.type.toUpperCase()}</span>
                ${statusBadge}
            </div>
        </div>
        <b style="${actionColor}">${actionText}</b>
    </div>`;
      })
      .join("") || `<div class="card muted">Tidak ada pedagang aktif.</div>`;
}
$("#search").addEventListener("input", renderVendors);

function getEmojiForType(t) {
  t = t.toLowerCase();
  if (t === "semua") return "♾️";
  if (t.includes("bakso") || t.includes("mie")) return "🍜";
  if (t.includes("kopi") || t.includes("es") || t.includes("minum"))
    return "☕";
  if (t.includes("nasi") || t.includes("ayam") || t.includes("bebek"))
    return "🍚";
  if (t.includes("sate")) return "🍢";
  if (t.includes("snack") || t.includes("cemilan") || t.includes("roti"))
    return "🥪";
  return "🍴";
}
function renderMapChips() {
  const rawTypes = state.vendors.map((v) => v.type);
  const uniqueTypes = ["Semua", ...new Set(rawTypes)];
  const container = $("#mapChipsContainer");
  if (container) {
    container.innerHTML = uniqueTypes
      .map((type) => {
        const isActive = state.mapCategory.toLowerCase() === type.toLowerCase();
        const label = type.charAt(0).toUpperCase() + type.slice(1);
        const emoji = getEmojiForType(type);
        return `<div class="map-chip ${
          isActive ? "active" : ""
        }" onclick="filterMap('${type}')">${emoji} ${label}</div>`;
      })
      .join("");
  }
}
window.filterMap = (cat) => {
  state.mapCategory = cat;
  renderMapChips();
  updateMapMarkers(true);
  closeMapCard();
};

function selectVendorOnMap(v) {
  state.activeMapVendorId = v.id;
  $$(".vm-bubble").forEach((b) => b.classList.remove("active"));
  const el = document.querySelector(`#mark-${v.id} .vm-bubble`);
  if (el) el.classList.add("active");
  $("#mvcIcon").textContent = v.ico;
  $("#mvcName").textContent = v.name;
  $("#mvcDist").textContent = distText(v) + " dari Anda";
  if (!v.isLive) {
    $("#mvcType").textContent = "🔴 TUTUP";
    $("#mvcType").style.color = "red";
    $("#mvcType").style.background = "#fee2e2";
  } else {
    $("#mvcType").textContent = v.type.toUpperCase();
    $("#mvcType").style.color = "#666";
    $("#mvcType").style.background = "#eee";
  }
  $("#mvcBtn").onclick = () => openVendor(v.id);
  const card = $("#mapCard");
  card.classList.remove("hidden");
  void card.offsetWidth;
  card.classList.add("visible");
  if (state.routeLine) state.map.removeLayer(state.routeLine);
  if (state.you.ok) {
    state.routeLine = L.polyline(
      [
        [state.you.lat, state.you.lon],
        [v.lat, v.lon],
      ],
      {
        color: "#ff7a00",
        weight: 4,
        opacity: 0.7,
        dashArray: "10, 10",
        lineCap: "round",
      },
    ).addTo(state.map);
    state.map.fitBounds(state.routeLine.getBounds(), {
      padding: [50, 150],
      maxZoom: 16,
    });
  } else {
    state.map.setView([v.lat, v.lon], 16);
  }
}
window.closeMapCard = () => {
  state.activeMapVendorId = null;
  $("#mapCard").classList.remove("visible");
  if (state.routeLine) {
    state.map.removeLayer(state.routeLine);
    state.routeLine = null;
  }
  $$(".vm-bubble").forEach((b) => b.classList.remove("active"));
};
window.trackOrder = (vid) => {
  state.trackingVendorId = vid;
  state.mapCategory = "Semua";
  renderMapChips();
  window.go("Map");
};

const MENU_DEFAULTS = {
  bakso: [{ id: "m1", name: "Bakso Urat", price: 15000 }],
  kopi: [{ id: "k1", name: "Kopi Susu", price: 12000 }],
  nasi: [{ id: "n1", name: "Nasi Goreng", price: 18000 }],
};

async function getVendorStats(vendorId) {
  const q = query(
    collection(db, "orders"),
    where("vendorId", "==", vendorId),
    where("status", "==", "Selesai"),
  );
  const snap = await getDocs(q);
  const counts = {};
  snap.forEach((d) => {
    const data = d.data();
    if (data.items && Array.isArray(data.items)) {
      data.items.forEach((item) => {
        const key = item.name;
        counts[key] = (counts[key] || 0) + item.qty;
      });
    }
  });
  return counts;
}

window.openVendor = async (id) => {
  state.selectedVendorId = id;
  const v = state.vendors.find((x) => x.id === id);
  if (!v) return;

  $("#vTitle").textContent = v.name;
  $("#vMeta").textContent = v.type.toUpperCase();

  const isClosed = !v.isLive;
  let banner = "";
  if (isClosed) {
    banner = `<div class="shop-closed-banner">🔒 Maaf, Toko Sedang Tutup</div>`;
  }

  $("#menuList").innerHTML =
    `<div style="text-align:center; padding:20px; color:#999;">⏳ Memuat menu & data penjualan...</div>`;
  openModal("vendorModal");

  let salesCounts = {};
  try {
    salesCounts = await getVendorStats(id);
  } catch (e) {
    console.error("Gagal load stats", e);
  }

  let maxSold = 0;
  Object.values(salesCounts).forEach((qty) => {
    if (qty > maxSold) maxSold = qty;
  });

  const menuData =
    v.menu && v.menu.length > 0 ? v.menu : MENU_DEFAULTS[v.type] || [];

  $("#menuList").innerHTML =
    banner +
    menuData
      .map((m) => {
        const btnState = isClosed ? "disabled" : "";
        const btnText = isClosed ? "Tutup" : "+ Tambah";
        const btnClass = isClosed ? "btn small" : "btn small primary";
        const imgDisplay = m.image
          ? `<img src="${m.image}" class="menu-img" loading="lazy" />`
          : `<div class="menu-img">🍲</div>`;

        const sold = salesCounts[m.name] || 0;
        let badgesHtml = "";
        if (sold > 0) {
          let badgeContent = "";
          if (sold === maxSold) {
            badgeContent += `<div class="badge-best-seller">👑 Best Seller</div>`;
          }
          badgeContent += `<div class="badge-sold">🔥 ${sold} Terjual</div>`;
          badgesHtml = `<div class="badge-sold-container">${badgeContent}</div>`;
        }

        return `
    <div class="menu-item-card">
      ${imgDisplay}
      <div class="menu-info">
        <b>${m.name}</b>
        <div class="muted">${rupiah(m.price)}</div>
        ${badgesHtml}
      </div>
      <div class="menu-btn-container">
        <button class="${btnClass}" ${btnState} onclick="addToCart('${id}', '${
          m.id
        }', '${m.name}', ${m.price})">${btnText}</button>
      </div>
    </div>`;
      })
      .join("");
};

window.addToCart = (vid, mid, mName, mPrice) => {
  if (!state.user) return requireLogin();
  const v = state.vendors.find((x) => x.id === vid);
  if (v && !v.isLive) {
    return alert("Maaf, toko ini sedang tutup. Tidak bisa memesan.");
  }
  // Reset voucher jika ganti vendor
  if (state.cart.length > 0 && state.cart[0].vendorId !== vid) {
    if (!confirm("Ganti toko? Keranjang sebelumnya akan dihapus.")) return;
    state.cart = [];
    state.activeVoucher = null; // Reset voucher
  }

  if (!mName) {
    const type = v ? v.type : "bakso";
    const item = MENU_DEFAULTS[type].find((x) => x.id === mid);
    if (item) {
      mName = item.name;
      mPrice = item.price;
    }
  }
  const ex = state.cart.find((x) => x.itemId === mid && x.vendorId === vid);
  if (ex) ex.qty++;
  else
    state.cart.push({
      vendorId: vid,
      vendorName: v ? v.name : "Vendor",
      itemId: mid,
      name: mName,
      price: parseInt(mPrice),
      qty: 1,
    });
  saveCart();
  showToast("Masuk keranjang");
};
function updateFab() {
  const t = state.cart.reduce((a, b) => a + b.qty, 0);
  $("#cartBadge").textContent = t;
  t > 0
    ? $("#fabCart").classList.remove("hidden")
    : $("#fabCart").classList.add("hidden");
}
window.openGlobalCart = () => {
  if (!state.user) return requireLogin();
  if (!state.cart.length) return showToast("Keranjang kosong");
  renderCartModal();
  openModal("checkoutModal");
};
window.triggerProofUpload = () => {
  $("#paymentProofInput").click();
};
window.handleProofUpload = async (input) => {
  if (input.files && input.files[0]) {
    $("#proofText").textContent = "⏳ Mengompres...";
    try {
      const compressed = await compressImage(input.files[0], 600, 0.6);
      state.tempPaymentProof = compressed;
      $("#proofText").textContent = "✅ Bukti Siap (Klik Ganti)";
      $(".proof-upload").style.borderColor = "#22c55e";
      $(".proof-upload").style.background = "#f0fdf4";
    } catch (e) {
      alert("Gagal proses gambar. Coba lagi.");
      $("#proofText").textContent = "📷 Klik untuk upload bukti";
    }
    input.value = "";
  }
};

// --- NEW: VOUCHER LOGIC ---
window.checkVoucher = async () => {
  const code = $("#voucherInput").value.trim().toUpperCase();
  if (!code) return alert("Masukkan kode promo");

  if (state.cart.length === 0) return alert("Keranjang kosong");
  const vendorId = state.cart[0].vendorId;

  const btn = $("#btnCheckVoucher");
  const originalText = btn.textContent;
  btn.textContent = "⏳...";
  btn.disabled = true;

  try {
    // Query ke koleksi 'vouchers'
    const q = query(collection(db, "vouchers"), where("code", "==", code));
    const snap = await getDocs(q);

    if (snap.empty) {
      alert("Kode promo tidak ditemukan");
      state.activeVoucher = null;
    } else {
      const vData = snap.docs[0].data();
      const vId = snap.docs[0].id;

      // Validasi: Cek Vendor (Global atau Spesifik Toko)
      if (vData.vendorId && vData.vendorId !== vendorId) {
        alert("Kode promo ini tidak berlaku untuk toko ini.");
        state.activeVoucher = null;
      }
      // Validasi: Cek Kuota (Rebutan)
      else if (vData.quota <= 0) {
        alert("Yah, Voucher sudah habis! (Rebutan)");
        state.activeVoucher = null;
      } else {
        // Valid!
        state.activeVoucher = {
          id: vId,
          code: vData.code,
          type: vData.type, // 'percent' or 'fixed'
          value: vData.value,
          quota: vData.quota,
        };
        showToast("Voucher berhasil dipasang! 🎉");
      }
    }
  } catch (e) {
    console.error(e);
    alert("Gagal cek voucher");
  }

  btn.textContent = originalText;
  btn.disabled = false;
  renderCartModal(); // Update UI harga
};

window.removeVoucher = () => {
  // 1. Reset state voucher menjadi null
  state.activeVoucher = null;

  // 2. Render ulang modal keranjang agar input voucher muncul kembali
  renderCartModal();

  // 3. (Opsional) Beri notifikasi
  showToast("Voucher dilepas");
};

function renderCartModal() {
  window.setOrderTimeType("asap");
  const vendorId = state.cart[0].vendorId;
  const vendor = state.vendors.find((v) => v.id === vendorId);

  $("#checkoutItems").innerHTML = state.cart
    .map(
      (i, idx) =>
        `<div class="cart-item-row"><div style="flex:1"><div style="font-weight:bold; font-size:14px">${
          i.name
        }</div><div class="muted" style="font-size:12px">${rupiah(i.price)} • ${
          i.vendorName
        }</div></div><div class="cart-controls"><button class="ctrl-btn" onclick="updateCartQty(${idx}, -1)">-</button><span class="ctrl-qty">${
          i.qty
        }</span><button class="ctrl-btn add" onclick="updateCartQty(${idx}, 1)">+</button></div><button class="iconBtn" style="width:30px; height:30px; margin-left:10px; border-color:#fee; color:red; background:#fff5f5" onclick="deleteCartItem(${idx})">🗑</button></div>`,
    )
    .join("");

  // Perhitungan Harga
  const subTotal = state.cart.reduce((a, b) => a + b.price * b.qty, 0);
  let discount = 0;

  if (state.activeVoucher) {
    if (state.activeVoucher.type === "percent") {
      discount = subTotal * (state.activeVoucher.value / 100);
    } else {
      discount = state.activeVoucher.value;
    }
    // Max diskon tidak boleh melebihi subtotal
    if (discount > subTotal) discount = subTotal;
  }

  const finalTotal = subTotal - discount;

  // Render UI Total
  let totalHtml = "";
  if (state.activeVoucher) {
    totalHtml = `
        <div class="rowBetween muted" style="font-size:13px;"><span>Subtotal</span><span>${rupiah(subTotal)}</span></div>
        <div class="rowBetween" style="font-size:13px; color:green;"><span>Diskon (${state.activeVoucher.code})</span><span>- ${rupiah(discount)}</span></div>
        <div class="rowBetween" style="font-size:18px; font-weight:bold; margin-top:8px; border-top:1px dashed #ccc; padding-top:8px;"><span>Total</span><span>${rupiah(finalTotal)}</span></div>
      `;
  } else {
    totalHtml = `<b style="font-size:20px;">${rupiah(finalTotal)}</b>`;
  }

  $("#checkoutTotal").innerHTML = totalHtml;

  // Render UI Input Voucher (Inject HTML jika belum ada)
  const voucherArea = $("#voucherArea");
  if (!voucherArea) {
    // Insert Voucher Area sebelum Total jika belum ada di HTML
    const vDiv = document.createElement("div");
    vDiv.id = "voucherArea";
    vDiv.style.marginTop = "15px";
    vDiv.style.padding = "10px";
    vDiv.style.background = "#f8fafc";
    vDiv.style.borderRadius = "8px";
    $("#checkoutItems").after(vDiv);
  }

  if ($("#voucherArea")) {
    if (state.activeVoucher) {
      $("#voucherArea").innerHTML = `
            <div class="rowBetween" style="align-items:center;">
                <div style="color:green; font-weight:bold;">✅ ${state.activeVoucher.code} Terpasang</div>
                <button class="btn small ghost" style="color:red;" onclick="removeVoucher()">Hapus</button>
            </div>
            <div style="font-size:11px; color:#666; margin-top:4px;">Diskon: ${state.activeVoucher.type === "percent" ? state.activeVoucher.value + "%" : rupiah(state.activeVoucher.value)}</div>
          `;
    } else {
      $("#voucherArea").innerHTML = `
            <div style="display:flex; gap:8px;">
                <input type="text" id="voucherInput" placeholder="Punya kode promo?" style="flex:1; border:1px solid #ddd; padding:8px; border-radius:6px; font-size:14px; text-transform:uppercase;">
                <button id="btnCheckVoucher" class="btn small primary" onclick="checkVoucher()">Pakai</button>
            </div>
          `;
    }
  }

  const paySelect = $("#payMethod");
  const qrisCont = $("#qrisContainer");
  const qrisImg = $("#qrisImageDisplay");
  const qrisDynamicDiv = $("#qrisDynamicArea");
  const qrisCanvas = $("#qrisCanvas");

  paySelect.innerHTML = "";
  qrisCont.classList.add("hidden");
  if (vendor && vendor.paymentMethods) {
    if (vendor.paymentMethods.includes("cash"))
      paySelect.innerHTML += `<option value="cash">💵 Tunai</option>`;
    if (vendor.paymentMethods.includes("qris"))
      paySelect.innerHTML += `<option value="qris">📱 QRIS</option>`;
  } else {
    paySelect.innerHTML = `<option value="cash">💵 Tunai</option>`;
  }

  // Update QRIS Logic with Final Total
  paySelect.onchange = () => {
    if (paySelect.value === "qris") {
      qrisCont.classList.remove("hidden");
      if (vendor.qrisData) {
        qrisImg.style.display = "none";
        $("#qrisNominalDisplay").textContent = rupiah(finalTotal); // Use Final Total
        $("#qrisNominalDisplay").style.display = "block";
        if (qrisDynamicDiv) qrisDynamicDiv.style.display = "flex";
        try {
          const dynamicString = createDynamicQRIS(vendor.qrisData, finalTotal);
          qrisCanvas.innerHTML = "";
          new QRCode(qrisCanvas, {
            text: dynamicString,
            width: 200,
            height: 200,
            correctLevel: QRCode.CorrectLevel.L,
          });
        } catch (err) {
          alert("Gagal membuat QRIS Dinamis. Menggunakan statis.");
          qrisImg.src = vendor.qrisImage;
          qrisImg.style.display = "block";
        }
      } else if (vendor.qrisImage) {
        if (qrisDynamicDiv) qrisDynamicDiv.style.display = "none";
        $("#qrisNominalDisplay").style.display = "none";
        qrisImg.src = vendor.qrisImage;
        qrisImg.style.display = "block";
      } else {
        alert("Toko ini belum mengatur pembayaran QRIS dengan benar.");
      }
      state.tempPaymentProof = null;
    } else {
      qrisCont.classList.add("hidden");
      state.tempPaymentProof = null;
    }
  };

  // Trigger change manual agar QRIS update nominal jika user ganti voucher saat dropdown sudah QRIS
  if (paySelect.value === "qris") paySelect.onchange();
}

$("#placeOrderBtn").addEventListener("click", async () => {
  if (!state.user) return requireLogin();

  let scheduleData = null; // Default null (berarti ASAP)

  if (state.orderTimeType === "po") {
    const d = $("#poDate").value;
    const t = $("#poTime").value;

    if (!d || !t) {
      return alert("Mohon lengkapi Tanggal dan Jam untuk Pre-Order!");
    }

    // Cek apakah tanggal di masa lalu
    const selectedTime = new Date(d + "T" + t);
    const now = new Date();
    if (selectedTime < now) {
      return alert("Waktu Pre-Order tidak boleh di masa lalu.");
    }

    scheduleData = {
      date: d,
      time: t,
      full: selectedTime.toISOString(), // Untuk sorting kalau perlu
    };
  }

  // [BARU] VALIDASI PENGIRIMAN
  let deliveryAddress = null;
  if (state.deliveryMethod === "delivery") {
    deliveryAddress = $("#deliveryAddress").value.trim();
    if (!deliveryAddress) return alert("Mohon isi alamat pengantaran!");
  }
  // ---------------------------

  const btn = $("#placeOrderBtn");
  btn.disabled = true;
  btn.textContent = "Memproses...";
  try {
    let phone = state.user.phone;
    if (!phone || phone.length < 9) {
      phone = prompt(
        "Wajib isi Nomor WhatsApp aktif untuk konfirmasi pesanan:",
      );
      if (!phone || phone.length < 9) {
        alert("Nomor WA tidak valid. Pesanan dibatalkan.");
        btn.disabled = false;
        btn.textContent = "Pesan & Verifikasi";
        return;
      }
      await updateDoc(doc(db, "users", state.user.id), { phone: phone });
      state.user.phone = phone;
    }

    // --- FINAL CALCULATION ---
    const subTotal = state.cart.reduce((a, b) => a + b.price * b.qty, 0);
    let discount = 0;
    let voucherCodeUsed = null;

    // Cek Voucher Terakhir (Rebutan)
    if (state.activeVoucher) {
      const vRef = doc(db, "vouchers", state.activeVoucher.id);
      const vSnap = await getDoc(vRef);

      if (vSnap.exists() && vSnap.data().quota > 0) {
        // Apply Discount
        if (state.activeVoucher.type === "percent") {
          discount = subTotal * (state.activeVoucher.value / 100);
        } else {
          discount = state.activeVoucher.value;
        }
        if (discount > subTotal) discount = subTotal;
        voucherCodeUsed = state.activeVoucher.code;

        // KURANGI KUOTA (Atomically)
        await updateDoc(vRef, {
          quota: increment(-1),
        });
      } else {
        alert("Maaf! Voucher baru saja habis digunakan orang lain.");
        state.activeVoucher = null;
        renderCartModal();
        btn.disabled = false;
        btn.textContent = "Pesan & Verifikasi";
        return;
      }
    }

    const total = subTotal - discount;
    const vName = state.cart[0].vendorName;
    const vId = state.cart[0].vendorId;
    const payment = $("#payMethod").value;

    if (payment === "qris" && !state.tempPaymentProof) {
      alert("Wajib upload bukti transfer untuk pembayaran QRIS!");
      btn.disabled = false;
      btn.textContent = "Pesan & Verifikasi";
      return;
    }
    const securePin = generatePin();
    await addDoc(collection(db, "orders"), {
      userId: state.user.id,
      userName: state.user.name,
      userPhone: phone,
      vendorId: vId,
      vendorName: vName,
      items: state.cart,
      subTotal: subTotal, // Simpan harga asli
      discount: discount, // Simpan diskon
      voucherCode: voucherCodeUsed, // Simpan kode
      total: total,
      note: $("#orderNote").value,
      paymentMethod: payment,
      paymentProof: state.tempPaymentProof || null,
      isPaymentVerified: payment === "cash",
      securePin: securePin,
      status: payment === "qris" ? "Menunggu Konfirmasi Bayar" : "Diproses",
      createdAt: new Date().toISOString(),
      orderType: state.orderTimeType, // 'asap' atau 'po'
      schedule: scheduleData, // null atau object {date, time}
      // [BARU] Data Pengiriman
      deliveryMethod: state.deliveryMethod,
      deliveryAddress: deliveryAddress,
    });

    state.cart = [];
    state.tempPaymentProof = null;
    state.activeVoucher = null; // Reset Voucher
    localStorage.removeItem("pikul_cart");
    updateFab();
    closeModal("checkoutModal");
    window.go("Orders");
    showToast("Pesanan dibuat!");
  } catch (e) {
    alert(e.message);
  }
  btn.disabled = false;
  btn.textContent = "Pesan & Verifikasi";
});

window.updateCartQty = (idx, change) => {
  const item = state.cart[idx];
  item.qty += change;
  if (item.qty <= 0) {
    if (confirm("Hapus?")) state.cart.splice(idx, 1);
    else item.qty = 1;
  }
  saveCart();
  if (!state.cart.length) closeModal("checkoutModal");
  else renderCartModal();
};
window.deleteCartItem = (idx) => {
  if (confirm("Hapus?")) {
    state.cart.splice(idx, 1);
    saveCart();
    if (!state.cart.length) closeModal("checkoutModal");
    else renderCartModal();
  }
};
window.switchOrderTab = (tab) => {
  state.activeOrderTab = tab;
  $$(".segment-btn").forEach((b) => b.classList.remove("active"));
  tab === "active"
    ? $$(".segment-btn")[0].classList.add("active")
    : $$(".segment-btn")[1].classList.add("active");
  renderOrders();
};
function renderOrders() {
  const list = $("#ordersList");
  if (!state.user) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">🔒</span><p>Login untuk melihat pesanan.</p><button class="btn small primary" onclick="requireLogin()">Login Disini</button></div>`;
    return;
  }
  const filtered = state.orders.filter((o) =>
    state.activeOrderTab === "active"
      ? o.status !== "Selesai" && !o.status.includes("Dibatalkan")
      : o.status === "Selesai" || o.status.includes("Dibatalkan"),
  );
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">${
      state.activeOrderTab === "active" ? "🥘" : "🧾"
    }</span><p>Kosong.</p><button class="btn small primary" onclick="go('Home')">Jajan Yuk</button></div>`;
    return;
  }
  list.innerHTML = filtered
    .map((o) => {
      const items = (o.items || [])
        .map((i) => `${i.qty}x ${i.name}`)
        .join(", ");
      let scheduleLabel = "";
      if (o.orderType === "po" && o.schedule) {
        // Format tanggal cantik (Contoh: 20 Jan, 14:00)
        const dateObj = new Date(o.schedule.date);
        const dateStr = dateObj.toLocaleDateString("id-ID", {
          day: "numeric",
          month: "short",
        });
        scheduleLabel = `<div style="background: #eff6ff; color: #1e40af; border: 1px solid #dbeafe; padding: 6px 10px; border-radius: 8px; font-size: 12px; margin-bottom: 8px; display: inline-block;">
        📅 <b>Pre-Order:</b> ${dateStr} • Jam ${o.schedule.time}
    </div>`;
      }
      let statusBadge = "",
        statusIcon = "⏳",
        statusDesc = "Menunggu...",
        actionButtons = "";
      if (o.status === "Menunggu Konfirmasi Bayar") {
        statusBadge = "orange";
        statusIcon = "💰";
        statusDesc = "Penjual sedang cek bukti transfer...";
      } else if (o.status === "Diproses") {
        statusBadge = "blue";
        statusIcon = "👨‍🍳";
        statusDesc = "Sedang dimasak...";
      } else if (
        o.status === "Siap Diambil/Diantar" ||
        o.status === "Dalam perjalanan"
      ) {
        statusBadge = "orange";
        statusIcon = "🛵";
        statusDesc = "Pesanan siap! Tunjukkan PIN.";
        actionButtons = `<div style="background:#f0fdf4; border:1px solid #22c55e; color:#15803d; padding:8px; border-radius:8px; text-align:center; margin-top:8px;"><small>PIN Keamanan:</small><br><b style="font-size:18px; letter-spacing:2px;">${o.securePin}</b><div style="font-size:10px;">Berikan ke penjual saat terima pesanan</div></div><button class="btn small ghost" onclick="trackOrder('${o.vendorId}')" style="width:100%; margin-top:5px;">🗺️ Lacak Posisi</button>`;
      } else if (o.status === "Selesai") {
        statusBadge = "green";
        statusIcon = "✅";
        statusDesc = "Selesai.";
        const rateBtn = !o.rating
          ? `<button class="btn small primary" onclick="rate('${o.id}')" style="flex:1">⭐ Nilai</button>`
          : `<div class="pill" style="flex:1; text-align:center">Rating: ${o.rating}⭐</div>`;
        actionButtons = `${rateBtn}<button class="btn small ghost" onclick="reorder('${o.id}')" style="flex:1">🔄 Pesan Lagi</button>`;
      } else if (o.status.includes("Dibatalkan")) {
        statusBadge = "red";
        statusIcon = "❌";
        statusDesc = o.status;
      }
      // Tampilkan info diskon di riwayat
      const discountInfo = o.discount
        ? `<span style="font-size:11px; color:green; display:block;">Hemat: ${rupiah(o.discount)} (${o.voucherCode})</span>`
        : "";

      return `<div class="order-card"><div class="oc-header"><div><b style="font-size:15px">${
        o.vendorName
      }</b><div class="muted" style="font-size:11px">${new Date(
        o.createdAt,
      ).toLocaleString([], {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })}</div></div><span class="badge ${statusBadge}">${
        o.status
      }</span></div><div class="oc-body">${scheduleLabel} <div style="font-size:13px; margin-bottom:12px">${items}</div>${
        state.activeOrderTab === "active"
          ? `<div class="step-compact"><div class="step-icon">${statusIcon}</div><div><b style="font-size:13px; display:block">${o.status}</b><span class="muted" style="font-size:11px">${statusDesc}</span></div></div>`
          : `<div class="rowBetween"><span class="muted" style="font-size:12px">Total Bayar</span><div style="text-align:right;">${discountInfo}<b style="font-size:16px">${rupiah(
              o.total,
            )}</b></div></div>`
      }</div>${
        actionButtons
          ? `<div class="oc-footer" style="display:block">${actionButtons}</div>`
          : ""
      }</div>`;
    })
    .join("");
}
$("#chatVendorBtn").addEventListener("click", () => {
  if (!state.user) return requireLogin();
  if (state.selectedVendorId) {
    state.chatWithVendorId = state.selectedVendorId;
    closeModal("vendorModal");
    window.selectChat(state.selectedVendorId);
  } else {
    showToast("Error: ID Vendor");
  }
});
function getChatId() {
  return `${state.user.id}_${state.chatWithVendorId}`;
}
window.go = (n) => {
  // Cek login untuk halaman tertentu (kecuali Profile, biar Tamu bisa buka Profile untuk Login)
  if ((n === "Orders" || n === "Messages") && !state.user) {
    requireLogin();
    return;
  }

  // Sembunyikan semua layar, tampilkan yang dipilih
  Object.values(screens).forEach((e) => e.classList.add("hidden"));
  screens[n].classList.remove("hidden");

  // Atur Header (sembunyikan di halaman chat mobile)
  if (n === "Messages" && window.innerWidth < 768)
    $("#mainHeader").classList.add("hidden");
  else $("#mainHeader").classList.remove("hidden");

  // Update Navigasi Aktif
  $$(".nav").forEach((b) => b.classList.toggle("active", b.dataset.go === n));

  // --- LOGIKA KHUSUS PER HALAMAN ---

  if (n === "Map") {
    initMap();
    setTimeout(() => state.map.invalidateSize(), 300);
  }

  if (n === "Messages") {
    renderInbox();
  }

  // [PENTING] Tambahkan ini agar halaman Profile dimuat!
  if (n === "Profile") {
    renderProfile();
  }
};
$$(".nav").forEach((b) =>
  b.addEventListener("click", () => window.go(b.dataset.go)),
);
/* --- GANTI FUNCTION renderProfile() LAMA DENGAN INI --- */
function renderProfile() {
  const container = $("#profileContent");
  const logoutBtn = $("#mobileProfileLogout"); // Tombol keluar lama (jika ada di HTML)
  const headerLogout = $("#logoutBtn"); // Tombol keluar di header atas

  // Bersihkan tombol logout lama di bawah agar tidak duplikat
  if (logoutBtn) logoutBtn.style.display = "none";

  if (state.user) {
    // --- KONDISI SUDAH LOGIN ---
    // Tampilkan tombol logout di header
    if (headerLogout) headerLogout.style.display = "flex";
    headerLogout.onclick = () => doLogout();

    container.innerHTML = `
      <div class="card" style="background: linear-gradient(135deg, #ff7a00, #ff5e00); color: white; border:none;">
        <div class="rowBetween">
          <div style="display: flex; gap: 16px; align-items: center">
            <div style="width: 60px; height: 60px; background: rgba(255,255,255,0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 30px; border: 2px solid rgba(255,255,255,0.3);">
              👤
            </div>
            <div>
              <b id="pName" style="display: block; font-size: 18px; margin-bottom: 4px;">${state.user.name}</b>
              <span id="pEmail" style="font-size: 13px; opacity: 0.9;">${state.user.email}</span>
              <div style="font-size: 12px; margin-top: 4px; opacity: 0.8;">${state.user.phone || "No HP belum diatur"}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="rowBetween" style="margin-bottom: 10px">
            <span class="muted">Saldo PIKULPay</span>
            <b class="big" style="color: var(--primary)" id="wallet">${rupiah(state.user.wallet)}</b>
        </div>
        <button class="btn primary" onclick="openTopupModal()" style="width: 100%; display:flex; justify-content:center; align-items:center; gap:8px;">
            <span>➕</span> Isi Saldo
        </button>
      </div>

      <h3 style="margin: 20px 0 10px; font-size: 16px;">Pengaturan</h3>
      <div class="profile-menu-list">
        <div class="profile-menu-item" onclick="alert('Fitur Edit Profil akan segera hadir!')">
            <div style="display:flex; align-items:center;">
                <div class="p-icon">✏️</div>
                <b>Edit Profil</b>
            </div>
            <span class="muted">›</span>
        </div>
        
        <div class="profile-menu-item" onclick="alert('Hubungi CS di WA: 085775603396')">
            <div style="display:flex; align-items:center;">
                <div class="p-icon">🎧</div>
                <b>Bantuan & CS</b>
            </div>
            <span class="muted">›</span>
        </div>

        <div class="profile-menu-item" onclick="alert('Versi Aplikasi: v1.0.0 Beta')">
            <div style="display:flex; align-items:center;">
                <div class="p-icon">ℹ️</div>
                <b>Tentang Aplikasi</b>
            </div>
            <span class="muted">v1.0</span>
        </div>

        <div class="profile-menu-item" onclick="doLogout()" style="border-color: #fee2e2; background: #fef2f2;">
            <div style="display:flex; align-items:center;">
                <div class="p-icon" style="background: #fee2e2; color: #ef4444;">🚪</div>
                <b style="color: #ef4444;">Keluar Akun</b>
            </div>
        </div>
      </div>
    `;
  } else {
    // --- KONDISI BELUM LOGIN (TAMU) ---
    // Sembunyikan tombol logout di header
    if (headerLogout) headerLogout.style.display = "none";

    container.innerHTML = `
      <div class="card" style="text-align: center; padding: 40px 20px; border: 1px dashed var(--border);">
        <div style="font-size: 60px; margin-bottom: 16px; animation: bounce 2s infinite;">👋</div>
        <h2 style="margin: 0 0 8px 0;">Halo, Tamu!</h2>
        <p class="muted" style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.5;">
            Kamu sedang dalam mode tamu.<br>
            Silakan masuk untuk melihat saldo, riwayat pesanan, dan menyimpan alamat.
        </p>
        
        <button class="btn primary full" onclick="requireLogin()" style="padding: 16px; font-size: 16px; box-shadow: 0 4px 15px rgba(255,122,0,0.3);">
            🔐 Masuk / Daftar Akun
        </button>
        
        <div style="margin-top: 20px; font-size: 12px; color: #94a3b8;">
            Belum punya akun? Klik tombol di atas untuk mendaftar.
        </div>
      </div>

      <div class="profile-menu-list">
        <div class="profile-menu-item" onclick="alert('Silakan login terlebih dahulu.')">
            <div style="display:flex; align-items:center;">
                <div class="p-icon" style="background: #f1f5f9; color: #64748b;">⚙️</div>
                <b style="color: #64748b;">Pengaturan Aplikasi</b>
            </div>
            <span class="muted">🔒</span>
        </div>
        <div class="profile-menu-item" onclick="alert('Hubungi CS di WA: 08123456789')">
            <div style="display:flex; align-items:center;">
                <div class="p-icon">🎧</div>
                <b>Pusat Bantuan</b>
            </div>
            <span class="muted">›</span>
        </div>
      </div>
    `;
  }
}

window.doLogout = () => {
  if (confirm("Apakah Anda yakin ingin keluar dari akun?")) {
    // 1. Hapus data login
    localStorage.removeItem("pikul_user_id");
    state.user = null;
    state.cart = [];
    state.orders = [];

    // 2. Reset tampilan
    renderProfile(); // Render ulang profil jadi mode Tamu
    renderOrders(); // Kosongkan list order

    // 3. Reset nama di Header
    const userNameEl = $("#userName");
    if (userNameEl) userNameEl.textContent = "Tamu";

    // 4. Pindah ke Home & Tampilkan pesan
    window.go("Home");
    showToast("Berhasil Keluar Akun");

    // Opsional: Reload halaman agar benar-benar bersih (hilangkan comment jika perlu)
    // location.reload();
  }
};
function showToast(m, type = "info") {
  let c = $(".toast-container");
  if (!c) {
    c = document.createElement("div");
    c.className = "toast-container";
    document.body.appendChild(c);
  }
  const e = document.createElement("div");
  e.className = "toast";
  e.innerHTML = m;
  c.appendChild(e);
  setTimeout(() => e.remove(), 3000);
}
function initTheme() {
  const d = localStorage.getItem("pikul_theme") === "dark";
  if (d) document.body.setAttribute("data-theme", "dark");
}
function showAuth() {
  $("#auth").classList.remove("hidden");
  $("#app").classList.add("hidden");
}
function showApp() {
  $("#auth").classList.add("hidden");
  $("#app").classList.remove("hidden");
  setTimeout(() => $("#splash").remove(), 500);
}
function distText(v) {
  if (!state.you.ok) return "? km";
  const d =
    Math.sqrt(
      Math.pow(v.lat - state.you.lat, 2) + Math.pow(v.lon - state.you.lon, 2),
    ) * 111;
  return d.toFixed(1) + " km";
}
function openModal(id) {
  $("#" + id).classList.remove("hidden");
}
function closeModal(id) {
  $("#" + id).classList.add("hidden");
}
$$("[data-close]").forEach((el) =>
  el.addEventListener("click", () => closeModal(el.dataset.close)),
);

window.openTopupModal = () => {
  state.topupAmount = 0;
  state.tempTopupProof = null;
  $("#topupProofText").textContent = "📷 Upload Bukti";
  $(".proof-upload").style.background = "#f8fafc";
  $(".proof-upload").style.borderColor = "#cbd5e1";
  const amounts = [
    10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000, 50000, 100000,
  ];
  const grid = $("#topupGrid");
  grid.innerHTML = amounts
    .map(
      (amt) =>
        `<div class="amount-btn" onclick="selectTopupAmount(${amt}, this)">${rupiah(
          amt,
        )}</div>`,
    )
    .join("");
  openModal("topupModal");
};
window.selectTopupAmount = (amt, el) => {
  state.topupAmount = amt;
  $$(".amount-btn").forEach((b) => b.classList.remove("active"));
  el.classList.add("active");
};
window.triggerTopupProof = () => {
  $("#topupProofInput").click();
};
window.handleTopupProof = async (input) => {
  if (input.files && input.files[0]) {
    try {
      const compressed = await compressImage(input.files[0], 500, 0.7);
      state.tempTopupProof = compressed;
      $("#topupProofText").textContent = "✅ Foto Tersimpan";
      $(".proof-upload").style.background = "#f0fdf4";
      $(".proof-upload").style.borderColor = "#22c55e";
    } catch (e) {
      alert("Gagal proses gambar");
    }
  }
};
window.copyToClipboard = (text) => {
  navigator.clipboard.writeText(text);
  showToast("Nomor rekening disalin!");
};
window.submitTopupRequest = async () => {
  if (!state.user) return requireLogin();
  if (state.topupAmount === 0) return alert("Pilih nominal topup dulu.");
  if (!state.tempTopupProof) return alert("Wajib upload bukti transfer.");
  const btn = $("#btnSubmitTopup");
  btn.disabled = true;
  btn.textContent = "Mengirim...";
  try {
    await addDoc(collection(db, "topups"), {
      userId: state.user.id,
      userName: state.user.name,
      amount: state.topupAmount,
      proof: state.tempTopupProof,
      status: "pending",
      timestamp: Date.now(),
      method: "transfer",
    });
    closeModal("topupModal");
    showToast("✅ Permintaan Topup dikirim. Tunggu admin verifikasi.");
    state.topupAmount = 0;
    state.tempTopupProof = null;
  } catch (e) {
    alert("Gagal kirim: " + e.message);
  }
  btn.disabled = false;
  btn.textContent = "Ajukan Isi Saldo";
};

let tempRatingOid = null;
let tempRating = 0;
window.rate = (oid) => {
  tempRatingOid = oid;
  tempRating = 0;
  updateStarUI(0);
  $("#rateModal").classList.remove("hidden");
};
window.updateStarUI = (n) => {
  tempRating = n;
  const stars = [1, 2, 3, 4, 5]
    .map(
      (i) =>
        `<span onclick="updateStarUI(${i})" style="color: ${
          i <= n ? "#ffc107" : "#e2e8f0"
        }; transition:0.2s; cursor:pointer;">★</span>`,
    )
    .join("");
  $("#starContainer").innerHTML = stars;
};
window.submitRating = async () => {
  if (tempRating === 0) return alert("Pilih minimal 1 bintang");
  const btn = $("#btnSubmitRate");
  btn.textContent = "Mengirim...";
  try {
    await updateDoc(doc(db, "orders", tempRatingOid), { rating: tempRating });
    showToast("Terima kasih atas penilaiannya!");
    $("#rateModal").classList.add("hidden");
    const o = state.orders.find((x) => x.id === tempRatingOid);
    if (o) o.rating = tempRating;
    renderOrders();
  } catch (e) {
    alert("Gagal mengirim rating");
  }
  btn.textContent = "Kirim Penilaian";
};

function generateCRC16(str) {
  let crc = 0xffff;
  for (let c = 0; c < str.length; c++) {
    crc ^= str.charCodeAt(c) << 8;
    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) crc = (crc << 1) ^ 0x1021;
      else crc = crc << 1;
    }
  }
  let hex = (crc & 0xffff).toString(16).toUpperCase();
  return hex.padStart(4, "0");
}
function createDynamicQRIS(rawString, amount) {
  if (!rawString || rawString.length < 20) return rawString;
  let qris = rawString.trim();
  let newString = "";
  let i = 0;
  let addedAmount = false;
  while (i < qris.length) {
    if (i + 4 > qris.length) break;
    let tag = qris.substring(i, i + 2);
    let lenStr = qris.substring(i + 2, i + 4);
    let len = parseInt(lenStr, 10);
    if (isNaN(len) || i + 4 + len > qris.length) break;
    let value = qris.substring(i + 4, i + 4 + len);
    if (tag === "63") break;
    if (tag === "01") value = "12";
    if (tag === "54") {
      i += 4 + len;
      continue;
    }
    if (tag === "58" && !addedAmount) {
      let amtStr = Math.floor(amount).toString();
      let amtLen = amtStr.length.toString().padStart(2, "0");
      newString += "54" + amtLen + amtStr;
      addedAmount = true;
    }
    newString += tag + lenStr.padStart(2, "0") + value;
    i += 4 + len;
  }
  if (!addedAmount) {
    let amtStr = Math.floor(amount).toString();
    let amtLen = amtStr.length.toString().padStart(2, "0");
    newString += "54" + amtLen + amtStr;
  }
  newString += "6304";
  let crc = generateCRC16(newString);
  return newString + crc;
}

window.setOrderTimeType = (type) => {
  state.orderTimeType = type;

  // Update UI Tab
  document
    .getElementById("btnAsap")
    .classList.toggle("active", type === "asap");
  document.getElementById("btnPo").classList.toggle("active", type === "po");

  // Tampilkan/Sembunyikan Input Tanggal
  const inputContainer = document.getElementById("poInputContainer");
  if (type === "po") {
    inputContainer.classList.remove("hidden");

    // Set default tanggal besok & jam 12:00 biar user ga bingung
    if (!document.getElementById("poDate").value) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      document.getElementById("poDate").value = tomorrow
        .toISOString()
        .split("T")[0];
      document.getElementById("poTime").value = "12:00";
    }
  } else {
    inputContainer.classList.add("hidden");
  }
};

initAuth();
