// --- BAGIAN 1: FIREBASE CLOUD MESSAGING (UNTUK NOTIFIKASI) ---
importScripts(
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js",
);
importScripts(
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js",
);

// ⚠️ WAJIB: Copy-Paste isi variabel firebaseConfig dari file 'firebase-config.js' Anda ke sini
// Hapus 'export const', jadikan variabel biasa 'const'
const firebaseConfig = {
  apiKey: "AIzaSyAKuZJteaWDWwDFWBqU_plfTbRruIwlf9c",
  authDomain: "pikul-63c68.firebaseapp.com",
  databaseURL:
    "https://pikul-63c68-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "pikul-63c68",
  storageBucket: "pikul-63c68.firebasestorage.app",
  messagingSenderId: "1031367560676",
  appId: "1:1031367560676:web:6e5a081a1467dfeda88bf1",
};

// Inisialisasi Firebase di Service Worker
firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

// Handler pesan saat aplikasi di background (Layar mati / Tutup Apps)
messaging.onBackgroundMessage((payload) => {
  console.log("[sw.js] Pesan background diterima:", payload);

  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: "./pikul.jpeg", // Icon aplikasi
    badge: "./pikul.jpeg", // Icon kecil di status bar (Android)
    vibrate: [200, 100, 200],
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// --- BAGIAN 2: CACHING & OFFLINE (LOGIKA LAMA ANDA) ---

const CACHE_NAME = "pikul-app-v4"; // Saya update ke v4 agar cache lama terhapus
const ASSETS_TO_CACHE = [
  // --- ROOT (CUSTOMER) ---
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./firebase-config.js",
  "./pikul.jpeg",
  "./manifest.json",
  "./seller/manifest-kasir.json",
  "./Kasir.png",

  // --- SELLER ---
  "./seller/",
  "./seller/index.html",
  "./seller/kasir.html",
  "./seller/styles.css",
  "./seller/seller.js",
  "./Mitra-Pikul.png",
  "./seller/orderan-baru.mp3", // Tambahkan audio agar tercache

  // --- ADMIN ---
  "./admin/",
  "./admin/index.html",
  "./admin/styles.css",
  "./admin/admin.js",
  "./Admin-Pikul.png",

  // --- EXTERNAL LIBS ---
  "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
  "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js",
];

// 1. INSTALL: Simpan semua file ke cache
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("Membuka cache PIKUL...");
      return cache.addAll(ASSETS_TO_CACHE);
    }),
  );
  self.skipWaiting();
});

// 2. ACTIVATE: Hapus cache lama jika ada update versi
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log("Menghapus cache lama:", cache);
            return caches.delete(cache);
          }
        }),
      );
    }),
  );
  self.clients.claim();
});

// 3. FETCH: Strategi "Stale-While-Revalidate"
self.addEventListener("fetch", (event) => {
  // Abaikan request ke Firestore/Google Maps/Firebase Messaging (biarkan online)
  if (
    event.request.url.includes("firestore") ||
    event.request.url.includes("googleapis") ||
    event.request.url.includes("fcm") ||
    event.request.url.includes("google-analytics")
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          // Update cache dengan versi terbaru dari network
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type === "basic"
          ) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Jika offline dan tidak ada di cache
        });

      // Return cache jika ada, jika tidak tunggu network
      return cachedResponse || fetchPromise;
    }),
  );
});
