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
  updateDoc,
  orderBy,
  setDoc,
  deleteDoc,
  serverTimestamp,
  limit, // Import limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
// [BARU] Import Messaging
import {
  getMessaging,
  getToken,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js";
import { firebaseConfig } from "../firebase-config.js";

const audioOrderanBaru = new Audio("orderan-baru.mp3");

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const messaging = getMessaging(app); // [BARU] Init Messaging

const $ = (q) => document.querySelector(q);
const $$ = (q) => document.querySelectorAll(q);
function rupiah(n) {
  return "Rp " + (n || 0).toLocaleString("id-ID");
}

let state = {
  vendor: null,
  watchId: null,
  wakeLock: null,
  map: null,
  marker: null,
  locMode: "gps",
  activeChatId: null,
  unsubMsg: null,
  unsubOrders: null,
  ordersLimit: 20,
  orders: [],
  vouchers: [],
  editingMenuIndex: null,
  tempMenuImage: null,
  tempPayProof: null,
  pendingSub: null,
  approvedSub: null,
  unreadCount: 0,
  menuSalesCounts: {},
  firstLoad: true,
};

// --- GLOBAL EXPORTS ---
window.triggerPayProofUpload = () => $("#payProofInput").click();
window.closePayModal = () => $("#payModal").classList.add("hidden");
window.triggerMenuImageUpload = () => $("#mImageInput").click();
window.closeModal = (id) => {
  if (!id) {
    $(".modal:not(.hidden)").forEach((m) => m.classList.add("hidden"));
  } else {
    $("#" + id).classList.add("hidden");
  }
};

window.loadMoreOrders = () => {
  const btn = document.getElementById("btnLoadMore");
  if (btn) btn.textContent = "Memuat...";
  state.ordersLimit += 20;
  subscribeToOrders();
};

// --- HELPER FUNCTIONS ---
function compressImage(file, maxWidth = 500, quality = 0.7) {
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

function extractQRFromImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        if (typeof jsQR !== "undefined") {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code) resolve(code.data);
          else resolve(null);
        } else {
          resolve(null);
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function formatWA(phone) {
  if (!phone) return "";
  let p = phone.replace(/[^0-9]/g, "");
  if (p.startsWith("08")) p = "62" + p.substring(1);
  if (p.startsWith("8")) p = "62" + p;
  return p;
}

// --- SCREEN WAKE LOCK API ---
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      state.wakeLock = await navigator.wakeLock.request("screen");
      console.log("💡 Layar dipaksa menyala (Wake Lock Aktif)");
      state.wakeLock.addEventListener("release", () => {
        console.log("💡 Wake Lock terlepas");
      });
    }
  } catch (err) {
    console.error(`Wake Lock Error: ${err.name}, ${err.message}`);
  }
}

async function releaseWakeLock() {
  if (state.wakeLock !== null) {
    await state.wakeLock.release();
    state.wakeLock = null;
    console.log("🌑 Wake Lock dinonaktifkan");
  }
}

document.addEventListener("visibilitychange", async () => {
  if (
    state.wakeLock !== null &&
    document.visibilityState === "visible" &&
    state.vendor &&
    state.vendor.isLive
  ) {
    await requestWakeLock();
  }
});

// --- AUTH ---
window.switchAuthMode = (mode) => {
  if (mode === "login") {
    $("#loginForm").classList.remove("hidden");
    $("#registerForm").classList.add("hidden");
  } else {
    $("#loginForm").classList.add("hidden");
    $("#registerForm").classList.remove("hidden");
  }
};
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#email").value.trim(),
    password = $("#password").value,
    btn = e.target.querySelector("button");
  btn.disabled = true;
  btn.textContent = "Memproses...";
  try {
    const q = query(collection(db, "vendors"), where("email", "==", email));
    const snap = await getDocs(q);
    if (snap.empty) {
      alert("Email tidak ditemukan.");
      btn.disabled = false;
      btn.textContent = "Masuk";
      return;
    }
    const vData = snap.docs[0].data();
    if (vData.password && vData.password !== password) {
      alert("Password salah!");
      btn.disabled = false;
      btn.textContent = "Masuk";
      return;
    }
    state.vendor = { id: snap.docs[0].id, ...vData };
    localStorage.setItem("pikul_seller_id", state.vendor.id);
    initApp();
  } catch (err) {
    alert("Error: " + err.message);
  }
  btn.disabled = false;
  btn.textContent = "Masuk Dashboard";
});
$("#registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#regName").value.trim(),
    type = $("#regType").value,
    email = $("#regEmail").value.trim(),
    password = $("#regPass").value,
    btn = e.target.querySelector("button");

  if (password.length < 6) return alert("Password minimal 6 karakter");

  btn.disabled = true;
  btn.textContent = "Mendaftar...";
  try {
    const q = query(collection(db, "vendors"), where("email", "==", email));
    const snap = await getDocs(q);
    if (!snap.empty) {
      alert("Email sudah terdaftar.");
      btn.disabled = false;
      btn.textContent = "Daftar";
      return;
    }

    const newVendor = {
      email,
      password,
      name,
      type,
      ico: "🏪",
      rating: 5.0,
      busy: "Buka",
      lat: -6.2,
      lon: 106.8,
      menu: [],
      subscriptionExpiry: 0,
      isLive: false,
      locationMode: "gps",
      paymentMethods: ["cash"],
      qrisImage: null,
      logo: null,
      qrisData: null,
    };
    const ref = await addDoc(collection(db, "vendors"), newVendor);
    state.vendor = { id: ref.id, ...newVendor };
    localStorage.setItem("pikul_seller_id", state.vendor.id);
    initApp();
  } catch (err) {
    alert("Gagal daftar: " + err.message);
  }
  btn.disabled = false;
  btn.textContent = "Daftar Sekarang";
});
window.logout = () => {
  if (confirm("Keluar dari Mitra?")) {
    localStorage.removeItem("pikul_seller_id");
    location.reload();
  }
};

// --- INIT APP ---
async function initApp() {
  const vid = localStorage.getItem("pikul_seller_id");
  if (!vid) return $("#auth").classList.remove("hidden");

  try {
    const docSnap = await getDoc(doc(db, "vendors", vid));
    if (!docSnap.exists()) {
      localStorage.removeItem("pikul_seller_id");
      return $("#auth").classList.remove("hidden");
    }
    state.vendor = { id: docSnap.id, ...docSnap.data() };
    $("#auth").classList.add("hidden");
    $(".app-layout").classList.remove("hidden");

    // Realtime Listeners
    onSnapshot(doc(db, "vendors", state.vendor.id), (doc) => {
      if (doc.exists()) {
        state.vendor = { id: doc.id, ...doc.data() };
        renderUI();
        renderPaymentSettings();
      }
    });

    onSnapshot(
      query(
        collection(db, "subscriptions"),
        where("vendorId", "==", state.vendor.id),
      ),
      (snap) => {
        const pending = snap.docs.find((d) => d.data().status === "pending");
        const approved = snap.docs.find((d) => d.data().status === "approved");
        state.pendingSub = !!pending;
        state.approvedSub = approved
          ? { id: approved.id, ...approved.data() }
          : null;
        renderUI();
      },
    );

    onSnapshot(
      query(
        collection(db, "vouchers"),
        where("vendorId", "==", state.vendor.id),
      ),
      (snap) => {
        state.vouchers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderVoucherList();
      },
    );

    // Init FCM untuk Seller
    initFCM(state.vendor.id);

    subscribeToOrders();
    listenForChats();
    initBubbleDrag();
    goSeller("Home");
  } catch (e) {
    console.error(e);
    $("#auth").classList.remove("hidden");
  }
}

// --- [BARU] FCM LOGIC ---
async function initFCM(vendorId) {
  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      // GANTI 'GANTI_DENGAN_VAPID_KEY_ANDA' dengan Key dari Firebase Console
      const token = await getToken(messaging, {
        vapidKey: "GANTI_DENGAN_VAPID_KEY_ANDA",
      });
      if (token) {
        console.log("Seller FCM Token:", token);
        // await updateDoc(doc(db, "vendors", vendorId), { fcmToken: token });
      }
    }
  } catch (e) {
    console.error("FCM Error", e);
  }
}

// --- ORDERS SUBSCRIPTION (PAGINATION) ---
function subscribeToOrders() {
  if (state.unsubOrders) {
    state.unsubOrders();
  }

  const qOrd = query(
    collection(db, "orders"),
    where("vendorId", "==", state.vendor.id),
    orderBy("createdAt", "desc"),
    limit(state.ordersLimit),
  );

  state.unsubOrders = onSnapshot(
    qOrd,
    (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === "added" && !state.firstLoad) {
          const data = change.doc.data();
          const isRecent =
            Date.now() - new Date(data.createdAt).getTime() < 60000;
          if (isRecent) {
            console.log("🔔 Ada orderan baru!");
            audioOrderanBaru
              .play()
              .catch((e) => console.log("Audio block:", e));
            if (navigator.vibrate) navigator.vibrate([500, 200, 500]);
          }
        }
      });

      state.orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderOrdersList();
      calculateStats();
      state.firstLoad = false;
    },
    (error) => {
      console.error("Firestore Error:", error);
      if (error.message.includes("index")) {
        alert(
          "⚠️ PERHATIAN ADMIN/DEV:\nQuery membutuhkan Index Firestore.\nBuka Console (F12) untuk link.",
        );
      }
    },
  );
}

// --- NAVIGATION ---
window.goSeller = (screen) => {
  $$(".nav-item").forEach((n) => n.classList.remove("active"));
  $$(".sb-item").forEach((n) => n.classList.remove("active"));

  $("#sellerHome").classList.add("hidden");
  $("#sellerOrders").classList.add("hidden");
  $("#sellerPromo").classList.add("hidden");

  if (screen === "Home") {
    $$(".nav-item")[0].classList.add("active");
    $$(".sb-item")[0].classList.add("active");
    $("#sellerHome").classList.remove("hidden");
  } else if (screen === "Orders") {
    $$(".nav-item")[1].classList.add("active");
    $$(".sb-item")[1].classList.add("active");
    $("#sellerOrders").classList.remove("hidden");
  } else if (screen === "Promo") {
    $$(".nav-item")[2].classList.add("active");
    $$(".sb-item")[2].classList.add("active");
    $("#sellerPromo").classList.remove("hidden");
    renderVoucherList();
  }
};

// --- VOUCHER MANAGEMENT ---
window.openVoucherModal = () => {
  $("#voucherModal").classList.remove("hidden");
};

window.submitVoucher = async () => {
  const code = $("#vCode").value.trim().toUpperCase();
  const type = $("#vType").value;
  const value = Number($("#vValue").value);
  const quota = Number($("#vQuota").value);

  if (!code) return alert("Kode promo wajib diisi");
  if (value <= 0) return alert("Nilai potongan harus lebih dari 0");
  if (quota <= 0) return alert("Kuota harus lebih dari 0");

  const exists = state.vouchers.find((v) => v.code === code);
  if (exists) return alert("Kode promo ini sudah ada di daftar aktif.");

  const btn = $("#voucherModal .btn.primary");
  const oriText = btn ? btn.textContent : "Simpan";
  if (btn) {
    btn.textContent = "Menyimpan...";
    btn.disabled = true;
  }

  try {
    await addDoc(collection(db, "vouchers"), {
      vendorId: state.vendor.id,
      code: code,
      type: type,
      value: value,
      quota: quota,
      initialQuota: quota,
      createdAt: serverTimestamp(),
    });

    $("#vCode").value = "";
    $("#vValue").value = "";
    $("#vQuota").value = "";
    closeModal("voucherModal");
    alert("Voucher berhasil diterbitkan! 🎉");
  } catch (e) {
    alert("Gagal: " + e.message);
  }

  if (btn) {
    btn.textContent = oriText;
    btn.disabled = false;
  }
};

function renderVoucherList() {
  const list = $("#voucherListContainer");
  if (!list) return;
  list.innerHTML = "";

  if (state.vouchers.length === 0) {
    list.innerHTML = `
            <div style="grid-column: 1 / -1; text-align:center; padding:50px; border:2px dashed #e2e8f0; border-radius:12px; color:#94a3b8;">
                <div style="font-size:40px; margin-bottom:10px;">🎫</div>
                Belum ada voucher aktif.<br>Buat satu untuk menarik pembeli!
            </div>`;
    return;
  }

  state.vouchers.forEach((v) => {
    const initial = v.initialQuota || v.quota;
    const used = initial - v.quota;
    const percentUsed = (used / initial) * 100;

    const valueDisplay =
      v.type === "percent"
        ? `<span style="font-size:24px">${v.value}%</span>`
        : `<span style="font-size:14px; font-weight:normal; color:#64748b;">Rp</span> ${v.value.toLocaleString("id-ID")}`;

    const progressColor = percentUsed > 80 ? "#ef4444" : "#22c55e";

    const card = document.createElement("div");
    card.className = "voucher-ticket";
    card.innerHTML = `
            <div class="ticket-left">
                <div class="v-label">KODE PROMO</div>
                <div class="v-code">${v.code}</div>
                <div style="margin-top:8px;">
                    <div class="v-label">DISKON</div>
                    <div class="v-value">${valueDisplay}</div>
                </div>
                <div class="used-badge">
                      🔥 Terpakai: ${used}x
                </div>
            </div>
            
            <div class="ticket-right">
                <div style="width:100%">
                    <div class="v-label">KUOTA</div>
                    <div style="font-size:16px; font-weight:bold; color:#334155;">${v.quota}</div>
                    
                    <div class="quota-track">
                        <div class="quota-fill" style="width: ${100 - percentUsed}%; background:${progressColor}"></div>
                    </div>
                    <div class="quota-text">dari ${initial}</div>
                </div>

                <button class="btn-del-mini" onclick="deleteVoucher('${v.id}')">
                    🗑 Hapus
                </button>
            </div>
        `;
    list.appendChild(card);
  });
}

window.deleteVoucher = async (vid) => {
  if (confirm("Hapus voucher? Pembeli tidak bisa menggunakannya lagi.")) {
    await deleteDoc(doc(db, "vouchers", vid));
  }
};

// --- UI & OTHER LOGIC ---
function renderUI() {
  if (!state.vendor) return;
  $("#vName").textContent = state.vendor.name;
  $("#vNameDisplay").textContent = state.vendor.name;
  if (state.vendor.logo) {
    $("#shopLogoPreview").src = state.vendor.logo;
    $("#shopLogoPreview").classList.remove("hidden");
    $("#shopLogoPlaceholder").classList.add("hidden");
  }
  const isExpired = state.vendor.subscriptionExpiry < Date.now();
  $("#subAlert").classList.add("hidden");
  $("#subPending").classList.add("hidden");
  $("#subActivation").classList.add("hidden");
  $("#subActive").classList.add("hidden");

  if (state.pendingSub) {
    $("#subPending").classList.remove("hidden");
    disableShop();
  } else if (
    isExpired &&
    state.approvedSub &&
    state.approvedSub.method === "cash"
  ) {
    $("#subActivation").classList.remove("hidden");
    disableShop();
  } else if (isExpired) {
    $("#subAlert").classList.remove("hidden");
    disableShop();
  } else {
    $("#subActive").classList.remove("hidden");
    $("#expDate").textContent = new Date(
      state.vendor.subscriptionExpiry,
    ).toLocaleDateString();
    enableShop();
  }

  // --- Render Menu ---
  $("#menuList").innerHTML =
    (state.vendor.menu || [])
      .map((m, idx) => {
        const soldCount = state.menuSalesCounts[m.name] || 0;
        return `
    <div class="menu-card">
      <div style="display:flex; align-items:center;">
        ${m.image ? `<img src="${m.image}" class="menu-thumb" />` : '<div class="menu-thumb" style="display:flex;align-items:center;justify-content:center;">🍲</div>'}
        <div>
            <div style="font-weight:700">${m.name}</div>
            <div style="color:var(--text-muted); font-size:13px;">${rupiah(m.price)}</div>
            ${soldCount > 0 ? `<div class="sold-count">🔥 ${soldCount} Terjual</div>` : ""}
        </div>
      </div>
      <div class="menu-actions">
        <button class="btn-icon-action btn-edit" onclick="openEditMenu(${idx})">✎</button>
        <button class="btn-icon-action btn-del" onclick="deleteMenu(${idx})">🗑</button>
      </div>
    </div>`;
      })
      .join("") || `<div class="empty-state-box">Belum ada menu.</div>`;
}

function disableShop() {
  $("#statusToggle").disabled = true;
  $("#statusToggle").checked = false;
  $("#locationControls").classList.add("hidden");
  $("#statusText").textContent = "Tidak Aktif";
  $("#statusText").className = "status-indicator offline";
  stopGPS();
  releaseWakeLock();
}

function enableShop() {
  $("#statusToggle").disabled = false;
  $("#statusToggle").checked = state.vendor.isLive;
  if (state.vendor.isLive) {
    $("#statusText").textContent = "Toko Buka (Online)";
    $("#statusText").className = "status-indicator online";
    $("#locationControls").classList.remove("hidden");
    if (!state.map) initMap();
    state.locMode = state.vendor.locationMode || "gps";
    updateModeButtons();
    handleLocationLogic();
    requestWakeLock();
  } else {
    $("#statusText").textContent = "Toko Tutup (Offline)";
    $("#statusText").className = "status-indicator offline";
    $("#locationControls").classList.add("hidden");
    stopGPS();
    releaseWakeLock();
  }
}

// --- CHAT LOGIC ---
function listenForChats() {
  const q = query(
    collection(db, "chats"),
    where("vendorId", "==", state.vendor.id),
  );
  onSnapshot(q, (snap) => {
    if (!snap.empty) {
      if (!$("#floatingChatWindow").classList.contains("active")) {
        $("#floatingBubble").classList.remove("hidden");
      }
      state.unreadCount = 0;
      if (state.unreadCount > 0) {
        $("#bubbleBadge").textContent = state.unreadCount;
        $("#bubbleBadge").classList.add("visible");
      }
    }
  });
}

function initBubbleDrag() {
  const bubble = document.getElementById("floatingBubble");
  let isDragging = false;
  let hasMoved = false;
  let startX, startY, initialLeft, initialTop;

  const startDrag = (e) => {
    const evt = e.type === "touchstart" ? e.touches[0] : e;
    startX = evt.clientX;
    startY = evt.clientY;
    const rect = bubble.getBoundingClientRect();
    initialLeft = rect.left;
    initialTop = rect.top;
    isDragging = true;
    hasMoved = false;
  };

  const onDrag = (e) => {
    if (!isDragging) return;
    e.preventDefault();
    hasMoved = true;
    const evt = e.type === "touchmove" ? e.touches[0] : e;
    const dx = evt.clientX - startX;
    const dy = evt.clientY - startY;
    bubble.style.left = `${initialLeft + dx}px`;
    bubble.style.top = `${initialTop + dy}px`;
    bubble.style.right = "auto";
    bubble.style.bottom = "auto";
  };

  const stopDrag = () => {
    isDragging = false;
  };
  const onClickBubble = () => {
    if (!hasMoved) openChatWindow();
  };

  bubble.addEventListener("mousedown", startDrag);
  window.addEventListener("mousemove", onDrag);
  window.addEventListener("mouseup", stopDrag);
  bubble.addEventListener("click", onClickBubble);
  bubble.addEventListener("touchstart", startDrag);
  window.addEventListener("touchmove", onDrag, { passive: false });
  window.addEventListener("touchend", stopDrag);
}

window.openChatWindow = () => {
  $("#floatingChatWindow").classList.add("active");
  $("#floatingBubble").classList.add("hidden");
  loadChatList();
  $("#viewChatList").classList.remove("hidden");
  $("#viewChatRoom").classList.remove("active");
};
window.closeChatWindow = () => {
  $("#floatingChatWindow").classList.remove("active");
  $("#floatingBubble").classList.remove("hidden");
};

function loadChatList() {
  const q = query(
    collection(db, "chats"),
    where("vendorId", "==", state.vendor.id),
  );
  onSnapshot(q, (snap) => {
    let list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => b.lastUpdate - a.lastUpdate);
    $("#chatListContent").innerHTML =
      list
        .map(
          (c) =>
            `<div class="chat-entry" onclick="openChatRoom('${c.id}', '${c.userName}')">
            <div class="chat-avatar">👤</div>
            <div class="chat-info">
                <span class="chat-name">${c.userName}</span>
                <span class="chat-last">${c.lastMessage}</span>
            </div>
        </div>`,
        )
        .join("") ||
      '<div style="text-align:center; padding:20px; color:#999;">Belum ada chat.</div>';
  });
}

// --- [UPDATED] CHAT ROOM (PAGINATION) ---
window.openChatRoom = (chatId, userName) => {
  state.activeChatId = chatId;
  $("#viewChatRoom").classList.add("active");
  $("#roomTitle").textContent = userName;

  if (state.unsubMsg) state.unsubMsg();

  // [BARU] Limit 20 pesan terakhir dan urut descending
  const q = query(
    collection(db, "chats", chatId, "messages"),
    orderBy("ts", "desc"),
    limit(20),
  );

  state.unsubMsg = onSnapshot(q, (snap) => {
    // Reverse array agar pesan tampil dari atas ke bawah
    const messages = snap.docs.map((d) => d.data()).reverse();

    $("#msgBox").innerHTML = messages
      .map((m) => {
        const isMe = m.from === state.vendor.id;
        let contentHtml = "";
        if (m.type === "image")
          contentHtml = `<div class="bubble me"><img src="${m.text}" loading="lazy" /></div>`;
        else if (m.type === "sticker")
          contentHtml = `<div class="bubble sticker me"><img src="${m.text}" style="width:100px; border:none;" /></div>`;
        else if (m.type === "location") {
          const link = m.text.startsWith("http") ? m.text : "#";
          contentHtml = `<a href="${link}" target="_blank" class="bubble location ${isMe ? "me" : "them"}"><span>📍</span> Lokasi Toko</a>`;
        } else
          contentHtml = `<div class="bubble ${isMe ? "me" : "them"}">${m.text}</div>`;
        return `<div style="display:flex; justify-content:${isMe ? "flex-end" : "flex-start"}; margin-bottom: 6px;">${contentHtml}</div>`;
      })
      .join("");
    scrollToBottom();
  });
};

window.backToChatList = () => {
  $("#viewChatRoom").classList.remove("active");
  state.activeChatId = null;
  if (state.unsubMsg) state.unsubMsg();
};

function scrollToBottom() {
  const chatBox = document.getElementById("msgBox");
  if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;
}

window.sendMessage = async (content = null, type = "text") => {
  if (!state.activeChatId) return;
  if (!content) {
    const input = document.getElementById("replyInput");
    content = input.value.trim();
    input.value = "";
    input.focus();
  }
  if (!content) return;
  await addDoc(collection(db, "chats", state.activeChatId, "messages"), {
    text: content,
    type: type,
    from: state.vendor.id,
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
  await updateDoc(doc(db, "chats", state.activeChatId), {
    lastMessage: "Anda: " + preview,
    lastUpdate: Date.now(),
  });
  scrollToBottom();
};
$("#sendReplyBtn").addEventListener("click", () => sendMessage());
$("#replyInput").addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendMessage();
});

// --- MAP & GPS ---
function initMap() {
  if (state.map) return;
  state.map = L.map("sellerMap").setView(
    [state.vendor.lat, state.vendor.lon],
    15,
  );
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OSM",
  }).addTo(state.map);
  const icon = L.divIcon({
    className: "vendor-pin",
    html: `<div style="background:white; padding:4px; border-radius:8px; border:2px solid #ff7a00; font-size:20px; text-align:center; width:40px;">${state.vendor.ico || "🏪"}</div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 40],
  });
  state.marker = L.marker([state.vendor.lat, state.vendor.lon], {
    icon: icon,
    draggable: false,
  }).addTo(state.map);
  state.marker.on("dragend", async (e) => {
    const { lat, lng } = e.target.getLatLng();
    await updateDoc(doc(db, "vendors", state.vendor.id), { lat, lon: lng });
  });
}
window.setLocMode = async (mode) => {
  state.locMode = mode;
  updateModeButtons();
  await updateDoc(doc(db, "vendors", state.vendor.id), { locationMode: mode });
  handleLocationLogic();
};
function updateModeButtons() {
  $$(".mode-tab").forEach((b) => b.classList.remove("active"));
  state.locMode === "gps"
    ? $$(".mode-tab")[0].classList.add("active")
    : $$(".mode-tab")[1].classList.add("active");
  $("#manualHint").classList.toggle("hidden", state.locMode !== "manual");
}
function handleLocationLogic() {
  if (!state.map || !state.marker) return;
  if (state.locMode === "gps") {
    state.marker.dragging.disable();
    startGPS();
  } else {
    stopGPS();
    state.marker.dragging.enable();
  }
}
function startGPS() {
  if (!navigator.geolocation) {
    alert("Browser tidak support GPS.");
    return;
  }
  if (state.watchId) return;
  const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
  state.watchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      await updateDoc(doc(db, "vendors", state.vendor.id), { lat, lon });
      if (state.marker) state.marker.setLatLng([lat, lon]);
      if (state.map) state.map.setView([lat, lon], 16);
    },
    (err) => {
      console.error("GPS Error:", err);
    },
    options,
  );
}
function stopGPS() {
  if (state.watchId) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
}

// --- PAYMENT & QRIS ---
window.updatePaymentMethod = async () => {
  const cash = $("#chkCash").checked;
  const qris = $("#chkQris").checked;
  let newMethods = [];
  if (cash) newMethods.push("cash");
  if (qris) newMethods.push("qris");
  if (newMethods.length === 0) {
    alert("Pilih minimal satu.");
    $("#chkCash").checked = true;
    return;
  }
  await updateDoc(doc(db, "vendors", state.vendor.id), {
    paymentMethods: newMethods,
  });
};
window.saveQrisData = async () => {
  const rawString = $("#qrisDataInput").value.trim();
  if (rawString.length < 20 || !rawString.startsWith("000201")) {
    return alert("Format QRIS tidak valid. Harus diawali '000201'.");
  }
  try {
    await updateDoc(doc(db, "vendors", state.vendor.id), {
      qrisData: rawString,
    });
    alert("✅ Data QRIS Dinamis berhasil disimpan!");
    renderPaymentSettings();
  } catch (e) {
    alert("Gagal simpan: " + e.message);
  }
};
window.handleQrisUpload = async (input) => {
  if (input.files[0]) {
    const file = input.files[0];
    try {
      const c = await compressImage(file, 500, 0.7);
      const decodedText = await extractQRFromImage(file);
      let updateData = { qrisImage: c };
      if (decodedText && decodedText.startsWith("000201")) {
        updateData.qrisData = decodedText;
        $("#qrisDataInput").value = decodedText;
        alert("✅ Gambar QRIS terupload & Kode berhasil diekstrak otomatis!");
      } else {
        alert("✅ Gambar QRIS terupload. (Kode tidak terbaca otomatis)");
      }
      await updateDoc(doc(db, "vendors", state.vendor.id), updateData);
      renderPaymentSettings();
    } catch (e) {
      alert(e.message);
    }
    input.value = "";
  }
};
function renderPaymentSettings() {
  const methods = state.vendor.paymentMethods || ["cash"];
  const hasQris = methods.includes("qris");
  $("#chkCash").checked = methods.includes("cash");
  $("#chkQris").checked = hasQris;
  const qrisConfig = $("#qrisConfig");
  const qrisStatus = $("#qrisStatus");
  const qrisImg = $("#qrisImg");
  const qrisPh = $("#qrisPlaceholder");

  if (hasQris) {
    qrisConfig.classList.remove("hidden");
    const hasData = !!state.vendor.qrisData;
    const hasImage = !!state.vendor.qrisImage;
    if (state.vendor.qrisData)
      $("#qrisDataInput").value = state.vendor.qrisData;
    if (hasData) {
      qrisStatus.textContent = "✅ Dinamis Aktif";
      qrisStatus.style.color = "#10b981";
    } else if (hasImage) {
      qrisStatus.textContent = "⚠️ Statis (Gambar Saja)";
      qrisStatus.style.color = "#f59e0b";
    } else {
      qrisStatus.textContent = "❌ Belum Setup";
      qrisStatus.style.color = "#ef4444";
    }
    if (hasImage) {
      qrisImg.src = state.vendor.qrisImage;
      qrisImg.classList.remove("hidden");
      qrisPh.classList.add("hidden");
      $(".qris-preview").classList.add("has-image");
    } else {
      qrisImg.classList.add("hidden");
      qrisPh.classList.remove("hidden");
      $(".qris-preview").classList.remove("has-image");
    }
  } else {
    qrisConfig.classList.add("hidden");
    qrisStatus.textContent = "Belum Aktif";
    qrisStatus.style.color = "#94a3b8";
  }
}
window.triggerQrisUpload = () => $("#qrisInput").click();

// --- MENU CRUD ---
window.triggerLogoUpload = () => $("#shopLogoInput").click();
window.handleLogoUpload = async (input) => {
  if (input.files[0]) {
    try {
      const c = await compressImage(input.files[0], 300, 0.7);
      await updateDoc(doc(db, "vendors", state.vendor.id), { logo: c });
      alert("Logo Updated!");
    } catch (e) {
      alert("Error: " + e.message);
    }
    input.value = "";
  }
};
$("#addMenuBtn").addEventListener("click", () => {
  state.editingMenuIndex = null;
  state.tempMenuImage = null;
  $("#menuModalTitle").textContent = "Tambah Menu";
  $("#mName").value = "";
  $("#mPrice").value = "";
  $("#mImagePreview").classList.add("hidden");
  $("#mImagePlaceholder").classList.remove("hidden");
  $("#menuModal").classList.remove("hidden");
});
window.openEditMenu = (idx) => {
  state.editingMenuIndex = idx;
  const item = state.vendor.menu[idx];
  state.tempMenuImage = item.image || null;
  $("#menuModalTitle").textContent = "Edit Menu";
  $("#mName").value = item.name;
  $("#mPrice").value = item.price;
  if (state.tempMenuImage) {
    $("#mImagePreview").src = state.tempMenuImage;
    $("#mImagePreview").classList.remove("hidden");
    $("#mImagePlaceholder").classList.add("hidden");
  } else {
    $("#mImagePreview").classList.add("hidden");
    $("#mImagePlaceholder").classList.remove("hidden");
  }
  $("#menuModal").classList.remove("hidden");
};
window.handleMenuImageUpload = async (input) => {
  if (input.files[0]) {
    try {
      const c = await compressImage(input.files[0], 500, 0.8);
      state.tempMenuImage = c;
      $("#mImagePreview").src = c;
      $("#mImagePreview").classList.remove("hidden");
      $("#mImagePlaceholder").classList.add("hidden");
    } catch (e) {
      alert(e.message);
    }
    input.value = "";
  }
};
$("#menuForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#mName").value,
    price = parseInt($("#mPrice").value);
  let updMenu = [...(state.vendor.menu || [])];
  const newItem = {
    id:
      state.editingMenuIndex !== null
        ? updMenu[state.editingMenuIndex].id
        : "m" + Date.now(),
    name,
    price,
    image: state.tempMenuImage,
  };
  if (state.editingMenuIndex !== null)
    updMenu[state.editingMenuIndex] = newItem;
  else updMenu.push(newItem);
  await updateDoc(doc(db, "vendors", state.vendor.id), { menu: updMenu });
  closeModal("menuModal");
});
window.deleteMenu = async (idx) => {
  if (confirm("Hapus?")) {
    const upd = [...state.vendor.menu];
    upd.splice(idx, 1);
    await updateDoc(doc(db, "vendors", state.vendor.id), { menu: upd });
  }
};

// --- SUBSCRIPTIONS ---
window.redeemCode = async () => {
  const inputCode = parseInt($("#activationCode").value);
  if (!state.approvedSub || !state.approvedSub.activationCode)
    return alert("Data kode tidak ditemukan.");
  if (inputCode === state.approvedSub.activationCode) {
    const now = Date.now();
    await updateDoc(doc(db, "vendors", state.vendor.id), {
      subscriptionExpiry: now + 30 * 24 * 60 * 60 * 1000,
    });
    await updateDoc(doc(db, "subscriptions", state.approvedSub.id), {
      status: "redeemed",
    });
    alert("Kode Benar! Akun Anda aktif.");
  } else {
    alert("Kode Salah!");
  }
};
$("#payBtn").addEventListener("click", () =>
  $("#payModal").classList.remove("hidden"),
);
window.selectPayMethod = (method) => {
  if (method === "cash") {
    $("#payCash").classList.remove("hidden");
    $("#payQris").classList.add("hidden");
  } else {
    $("#payCash").classList.add("hidden");
    $("#payQris").classList.remove("hidden");
  }
};
window.handlePayProof = async (input) => {
  if (input.files && input.files[0]) {
    try {
      state.tempPayProof = await compressImage(input.files[0], 500, 0.6);
      $("#payProofText").textContent = "✅ Bukti Siap";
    } catch (e) {
      alert("Gagal proses gambar");
    }
  }
};
window.submitSubscription = async (method) => {
  if (method === "qris" && !state.tempPayProof)
    return alert("Mohon upload bukti transfer dulu.");
  await addDoc(collection(db, "subscriptions"), {
    vendorId: state.vendor.id,
    vendorName: state.vendor.name,
    amount: 5000,
    timestamp: Date.now(),
    type: "Premium Bulanan",
    method: method,
    proof: state.tempPayProof || null,
    status: "pending",
  });
  $("#payModal").classList.add("hidden");
  alert("Permintaan dikirim! Tunggu validasi Admin.");
};

// --- ORDER STATS ---
function calculateStats() {
  const now = new Date();
  const d = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const w = new Date(now.setDate(now.getDate() - now.getDay())).setHours(
    0,
    0,
    0,
    0,
  );
  const m = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1,
  ).getTime();
  let today = 0,
    week = 0,
    month = 0,
    total = 0;
  let counts = {};

  state.orders.forEach((o) => {
    if (o.status === "Selesai") {
      const t = new Date(o.createdAt).getTime();
      const val = o.total || 0;
      if (t >= d) today += val;
      if (t >= w) week += val;
      if (t >= m) month += val;
      total += val;
      if (o.items && Array.isArray(o.items)) {
        o.items.forEach((i) => {
          counts[i.name] = (counts[i.name] || 0) + i.qty;
        });
      }
    }
  });
  state.menuSalesCounts = counts;
  $("#statToday").textContent = rupiah(today);
  $("#statWeek").textContent = rupiah(week);
  $("#statMonth").textContent = rupiah(month);
  $("#statTotal").textContent = rupiah(total);
  if (state.vendor) renderUI();
}

function renderOrdersList() {
  const list = state.orders.sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  );
  const activeOrders = list.filter(
    (o) => o.status !== "Selesai" && !o.status.includes("Dibatalkan"),
  );
  const historyOrders = list.filter(
    (o) => o.status === "Selesai" || o.status.includes("Dibatalkan"),
  );
  $("#incomingCount").textContent = activeOrders.length;

  const renderItem = (o, active) => {
    const itemsUI = (o.items || [])
      .map((i) => `${i.qty}x ${i.name}`)
      .join(", ");
    let stCls =
      o.status === "Diproses"
        ? "status-process"
        : o.status === "Siap Diambil/Diantar"
          ? "status-deliv"
          : "status-done";
    if (o.status.includes("Dibatalkan")) stCls = "status-cancel";
    let btn = "";

    // --- LOGIKA TAMPILAN PRE-ORDER & DELIVERY DI SINI ---
    let scheduleBadge = "";
    if (o.orderType === "po" && o.schedule) {
      const dateObj = new Date(o.schedule.date);
      const dateStr = dateObj.toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
      });
      scheduleBadge = `<div style="background: #eff6ff; color: #1e40af; border: 1px solid #dbeafe; padding: 6px 10px; border-radius: 6px; font-size: 13px; margin-bottom: 10px; font-weight:bold; display:block;">
        📅 Pre-Order: ${dateStr} • Jam ${o.schedule.time}
      </div>`;
    }

    // [BARU] Delivery Badge
    let deliveryBadge = "";
    if (o.deliveryMethod === "delivery") {
      deliveryBadge = `<div style="background:#fff7ed; color:#c2410c; border:1px solid #ffedd5; padding:6px; border-radius:6px; font-size:12px; margin-bottom:8px; display:block;">
            🛵 <b>Minta Diantar</b><br>
            <span style="font-size:11px">${o.deliveryAddress || "-"}</span>
        </div>`;
    } else {
      deliveryBadge = `<div style="background:#f0fdf4; color:#15803d; border:1px solid #dcfce7; padding:6px; border-radius:6px; font-size:12px; margin-bottom:8px; display:block;">
            🛍️ <b>Ambil Sendiri (Pickup)</b>
        </div>`;
    }
    // -----------------------------------------

    if (active) {
      if (o.status === "Menunggu Konfirmasi Bayar") {
        const proofBtn = o.paymentProof
          ? `<button class="btn small info" onclick="viewProof('${o.id}')" style="width:100%; margin-bottom:8px; border:1px solid #0ea5e9; background:#e0f2fe; color:#0284c7;">📄 Lihat Bukti Transfer</button>`
          : "";

        btn = `<div style="background:#f8fafc; padding:10px; border-radius:8px; margin-bottom:10px;">
                  ${proofBtn}
                  <div style="display:flex; gap:8px;">
                      <button class="btn full" style="background:#ef4444; color:white;" onclick="updStat('${o.id}','Dibatalkan (Bukti Salah)')">Tolak</button>
                      <button class="btn primary full" onclick="updStat('${o.id}','Diproses')">Terima</button>
                  </div>
                 </div>`;
      } else if (o.status === "Diproses") {
        // [BARU] Logic Tombol sesuai Delivery Method
        if (o.deliveryMethod === "delivery") {
          btn = `<button class="btn primary full" onclick="updStat('${o.id}','Siap Diambil/Diantar')">🛵 Mulai Antar</button>`;
        } else {
          btn = `<button class="btn primary full" onclick="updStat('${o.id}','Siap Diambil/Diantar')">✅ Siap Diambil</button>`;
        }
      } else if (o.status === "Siap Diambil/Diantar") {
        btn = `<div style="display:flex; gap:8px;"><input id="pin-${o.id}" placeholder="PIN (4 digit)" style="width:100px; padding:8px; border:1px solid #ccc; border-radius:8px; font-size:14px;" maxlength="4" /><button class="btn full" style="background:#10b981; color:white;" onclick="verifyPin('${o.id}', '${o.securePin}')">Verifikasi</button></div>`;
      }
    }
    const waNum = formatWA(o.userPhone);
    const waBtn = waNum
      ? `<a href="https://wa.me/${waNum}?text=Halo" target="_blank" style="font-size:12px; color:#22c55e; text-decoration:none; font-weight:600; background:#f0fdf4; padding:4px 8px; border-radius:6px; border:1px solid #22c55e;">📞 WhatsApp</a>`
      : `<span class="muted" style="font-size:12px">No WA Tidak Ada</span>`;
    const deleteBtn = `<button onclick="deleteOrder('${o.id}')" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:12px; text-decoration:underline; margin-left:auto;">🗑️ Hapus Pesanan</button>`;

    const historyProofBtn =
      !active && o.paymentMethod === "qris" && o.paymentProof
        ? `<button onclick="viewProof('${o.id}')" style="background:none; border:none; color:#0ea5e9; cursor:pointer; font-size:12px; text-decoration:underline; margin-right:10px;">📄 Bukti</button>`
        : "";

    // Show Voucher Info if Used
    let voucherInfo = "";
    if (o.discount > 0) {
      voucherInfo = `<div style="color:green; font-size:12px; margin-top:4px;">🏷️ Hemat ${rupiah(o.discount)} (${o.voucherCode || "Promo"})</div>`;
    }

    return `<div class="order-item"><div class="ord-head"><div><b>${
      o.userName
    }</b> <span style="color:#94a3b8; font-size:12px;">• ${new Date(
      o.createdAt,
    ).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}</span><div style="margin-top:6px;">${waBtn}</div></div><span class="ord-status ${stCls}">${
      o.status
    }</span></div>
    <div class="ord-body">
      ${scheduleBadge} 
      ${deliveryBadge}
      <p style="margin:0 0 10px 0; font-size:14px; line-height:1.5;">${itemsUI}</p>${
        o.note
          ? `<div style="background:#fff1f2; color:#be123c; padding:8px; border-radius:8px; font-size:12px; margin-bottom:10px;">📝 ${o.note}</div>`
          : ""
      }<div class="rowBetween"><span class="muted">Total (${
        o.paymentMethod === "qris" ? "QRIS" : "Tunai"
      })</span><div style="text-align:right;">${voucherInfo}<b style="font-size:16px;">${rupiah(
        o.total,
      )}</b></div></div><div style="display:flex; margin-top:8px;">${historyProofBtn}${deleteBtn}</div></div>${
        btn ? `<div class="ord-foot">${btn}</div>` : ""
      }</div>`;
  };

  $("#incomingOrdersList").innerHTML =
    activeOrders.map((o) => renderItem(o, true)).join("") ||
    `<div class="empty-state-box">Tidak ada pesanan aktif.</div>`;

  // Render History dan tombol Load More
  let historyHtml = historyOrders.map((o) => renderItem(o, false)).join("");

  if (state.orders.length >= state.ordersLimit) {
    historyHtml += `
        <div style="text-align:center; margin: 20px 0;">
            <button id="btnLoadMore" class="btn secondary" onclick="loadMoreOrders()" style="width:100%; padding:12px;">
                📂 Muat Lebih Banyak (Riwayat)
            </button>
        </div>
      `;
  }

  $("#historyOrdersList").innerHTML = historyHtml;
}

window.updStat = async (oid, st) => {
  await updateDoc(doc(db, "orders", oid), { status: st });
};
window.verifyPin = async (oid, correctPin) => {
  const inputPin = document.getElementById(`pin-${oid}`).value;
  if (inputPin === correctPin) {
    if (confirm("PIN Benar! Selesaikan pesanan?"))
      await updateDoc(doc(db, "orders", oid), { status: "Selesai" });
  } else {
    alert("PIN SALAH!");
  }
};
window.viewProof = (oid) => {
  const order = state.orders.find((o) => o.id === oid);
  if (order && order.paymentProof) {
    $("#proofImageFull").src = order.paymentProof;
    $("#proofModal").classList.remove("hidden");
  } else {
    alert("Bukti tidak ditemukan");
  }
};
window.deleteOrder = async (oid) => {
  if (confirm("HAPUS PERMANEN?")) {
    await deleteDoc(doc(db, "orders", oid));
  }
};
$("#statusToggle").addEventListener("change", async (e) => {
  if (state.vendor.subscriptionExpiry < Date.now()) {
    e.target.checked = false;
    alert("Masa aktif habis.");
    return;
  }
  await updateDoc(doc(db, "vendors", state.vendor.id), {
    isLive: e.target.checked,
  });
});

$$("[data-close]").forEach((b) =>
  b.addEventListener("click", (e) => window.closeModal(e.target.dataset.close)),
);

initApp();
