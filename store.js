/*
 * デモストア共通スクリプト（カート管理 + KARTE / GA4 イベント送信）
 *
 * - カートは localStorage に保存（ブラウザを閉じても残る＝カゴ落ち状態を再現できる）
 * - KARTE: cart / buy イベントを krt('send', ...) で送信
 *     cart … カートの中身が変わったとき・カート/購入手続きページ表示時（カート内の全商品を送る）
 *            購入完了時は status:false の空カートを送る
 *     buy  … 購入完了ページで 1注文につき1回だけ送信
 * - GA4: dataLayer に推奨 e コマースイベントを push（GTM側でトリガー設定が必要）
 * - 画面右下に「送信イベントログ」を表示（検証用）
 *
 * ga4-user.js と GTM スニペットの後に読み込むこと。
 */
(function (w, d) {
  var CART_KEY = 'demo_cart';
  var ORDER_KEY = 'demo_last_order';
  var LOG_KEY = 'demo_event_log';

  // ---------------- 商品マスタ ----------------
  var PRODUCTS = {
    item_001: { item_id: 'item_001', name: 'KARTEテスト用 ロゴTシャツ', price: 3000, category: 'アパレル', brand: 'DEMO', color: '#2f3e46', icon: 'T' },
    item_002: { item_id: 'item_002', name: 'KARTEテスト用 トートバッグ', price: 1500, category: 'バッグ', brand: 'DEMO', color: '#b08968', icon: 'B' },
    item_003: { item_id: 'item_003', name: 'KARTEテスト用 マグカップ', price: 1200, category: '雑貨', brand: 'DEMO', color: '#588157', icon: 'M' },
    item_004: { item_id: 'item_004', name: 'KARTEテスト用 キャップ', price: 2500, category: 'アパレル', brand: 'DEMO', color: '#6d597a', icon: 'C' }
  };
  var AFFILIATION = 'KARTE検証用デモストア';
  var TAX_RATE = 0.10; // 価格はすべて税込（内税）
  var FREE_SHIPPING_THRESHOLD = 5000;
  var SHIPPING_FEE = 500;

  function baseUrl() { return location.href.replace(/[^/]*([?#].*)?$/, ''); }

  // ---------------- storage ----------------
  function read(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function write(key, v) {
    try { v == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(v)); } catch (e) {}
  }

  // ---------------- カート ----------------
  // 保存形式: [{ item_id, quantity }]
  function getLines() { return read(CART_KEY, []).filter(function (l) { return PRODUCTS[l.item_id] && l.quantity > 0; }); }

  function getItems() {
    return getLines().map(function (l) {
      var p = PRODUCTS[l.item_id];
      return {
        item_id: p.item_id, name: p.name, price: p.price, quantity: l.quantity,
        item_url: baseUrl() + 'index.html#' + p.item_id,
        l_category_name: p.category, brand_name: p.brand
      };
    });
  }

  function summary(items) {
    items = items || getItems();
    var subtotal = 0, qty = 0;
    items.forEach(function (i) { subtotal += i.price * i.quantity; qty += i.quantity; });
    var shipping = subtotal === 0 || subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;
    return { items: items, subtotal: subtotal, quantity: qty, shipping: shipping, total: subtotal + shipping };
  }

  function setQty(itemId, qty, opts) {
    opts = opts || {};
    var lines = getLines();
    var line = lines.filter(function (l) { return l.item_id === itemId; })[0];
    var before = line ? line.quantity : 0;
    qty = Math.max(0, Math.min(99, qty | 0));
    if (line) line.quantity = qty; else if (qty > 0) lines.push({ item_id: itemId, quantity: qty });
    lines = lines.filter(function (l) { return l.quantity > 0; });
    write(CART_KEY, lines);

    var diff = qty - before;
    if (diff !== 0) {
      var p = PRODUCTS[itemId];
      ga4(diff > 0 ? 'add_to_cart' : 'remove_from_cart', {
        currency: 'JPY', value: p.price * Math.abs(diff),
        items: [ga4Item(p, Math.abs(diff))]
      });
      sendCart(diff > 0 ? { added_item_id: itemId } : { deleted_item_id: itemId });
    }
    renderBadge();
    return diff;
  }

  function add(itemId, qty) {
    var line = getLines().filter(function (l) { return l.item_id === itemId; })[0];
    return setQty(itemId, (line ? line.quantity : 0) + (qty || 1));
  }

  function clearCart() {
    write(CART_KEY, []);
    renderBadge();
  }

  // ---------------- KARTE ----------------
  // KARTEタグ(GTM経由)の読み込み完了を待ってから送信する
  function whenKarte(fn, waited) {
    waited = waited || 0;
    if (typeof w.krt === 'function') { fn(); return; }
    if (waited >= 10000) { log('KARTE', '(未送信) KARTEタグが読み込まれていません', null, true); return; }
    setTimeout(function () { whenKarte(fn, waited + 200); }, 200);
  }

  function krtSend(name, values) {
    log('KARTE', name, values);
    whenKarte(function () {
      try { w.krt('send', name, values); }
      catch (e) { try { w.krt('send', '_error', { message: e.message }); } catch (_) {} }
    });
  }

  // カート内の「全商品」を送る（差分ではない）。空なら status:false
  function sendCart(extra) {
    var s = summary();
    var v;
    if (s.items.length === 0) {
      v = { status: false, price: 0, quantity: 0, items: [''], item_ids: [''], item_names: [''],
            item_prices: [''], item_quantities: [''], item_urls: [''] };
    } else {
      v = {
        status: true, price: s.subtotal, quantity: s.quantity, items: s.items,
        item_ids: pluck(s.items, 'item_id'), item_names: pluck(s.items, 'name'),
        item_prices: pluck(s.items, 'price'), item_quantities: pluck(s.items, 'quantity'),
        item_urls: pluck(s.items, 'item_url')
      };
    }
    if (extra) for (var k in extra) v[k] = extra[k];
    krtSend('cart', v);
  }

  function pluck(arr, k) { return arr.map(function (x) { return x[k]; }); }

  // ---------------- GA4 (dataLayer) ----------------
  // GA4 推奨パラメータ: item_id / item_name（どちらか必須）, affiliation, index, item_brand, item_category, price, quantity
  function ga4Item(p, qty, index) {
    var it = { item_id: p.item_id, item_name: p.name, affiliation: AFFILIATION, item_brand: p.brand, item_category: p.category, price: p.price, quantity: qty };
    if (typeof index === 'number') it.index = index;
    return it;
  }
  function ga4Items(items) { return items.map(function (i, n) { return ga4Item(PRODUCTS[i.item_id], i.quantity, n); }); }
  // 税込価格に含まれる消費税額（内税）
  function taxOf(amount) { return Math.floor(amount * TAX_RATE / (1 + TAX_RATE)); }

  function ga4(event, ecommerce) {
    w.dataLayer = w.dataLayer || [];
    w.dataLayer.push({ ecommerce: null }); // 前回の ecommerce オブジェクトをクリア
    w.dataLayer.push({ event: event, ecommerce: ecommerce });
    log('GA4', event, ecommerce);
  }

  // gtag コマンドで GA4 に直接送信（GTM のトリガー設定なしで送れる）
  // GTM で配信している Google タグが dataLayer 上の gtag コマンドを読み取って送信する
  // ※GTM 経由の Google タグでは send_to（測定ID）を指定しないと送信されない
  var GA4_MEASUREMENT_ID = 'G-K5XV9GYH20';
  function gtag() {
    w.dataLayer = w.dataLayer || [];
    w.dataLayer.push(arguments); // 配列ではなく arguments をそのまま積む（gtag の仕様）
  }
  // GTM が Google タグ（測定ID）を読み込み終えてから送る（最大10秒待つ）
  function whenGoogleTagReady(fn) {
    var tries = 0;
    (function check() {
      if (w.google_tag_manager && w.google_tag_manager[GA4_MEASUREMENT_ID]) return fn();
      if (++tries > 100) return; // 広告ブロッカー等で読み込めない場合は諦める
      setTimeout(check, 100);
    })();
  }

  // ---------------- 注文 ----------------
  function placeOrder(info) {
    var s = summary();
    if (!s.items.length) return null;
    var order = {
      transaction_id: 'ORD-' + Date.now().toString().slice(-8) + Math.floor(Math.random() * 90 + 10),
      created_at: new Date().toISOString(),
      items: s.items, subtotal: s.subtotal, shipping: s.shipping, total: s.total, quantity: s.quantity,
      payment: info.payment, name: info.name, sent: false
    };
    write(ORDER_KEY, order);
    return order;
  }
  function lastOrder() { return read(ORDER_KEY, null); }

  // 購入完了ページで呼ぶ。リロードしても二重計上しない
  function completeOrder() {
    var o = lastOrder();
    if (!o) return null;
    if (o.sent) return o;
    krtSend('buy', {
      transaction_id: o.transaction_id, revenue: o.subtotal, total_price: o.total,
      shipping: o.shipping, quantity: o.quantity, payment_method: o.payment,
      items: o.items, item_ids: pluck(o.items, 'item_id'), item_names: pluck(o.items, 'name'),
      item_prices: pluck(o.items, 'price'), item_quantities: pluck(o.items, 'quantity')
    });
    // 公式リファレンスの purchase パラメータ
    //   必須: transaction_id, value(数値), currency(value と必ずセット), items
    //   推奨: tax, shipping, affiliation, coupon（クーポン機能はないため未送信）
    //   value は商品小計（送料を含まない・税込）
    var purchaseParams = {
      transaction_id: String(o.transaction_id),
      affiliation: AFFILIATION,
      value: Number(o.subtotal),
      tax: taxOf(o.subtotal),
      shipping: Number(o.shipping),
      currency: 'JPY',
      items: ga4Items(o.items)
    };
    ga4('purchase', purchaseParams);
    // GTM にトリガーを作らずに GA4 へ送る。
    // ※GTM 側に purchase のカスタムイベントトリガーを追加した場合は二重計上になるので、この行を削除すること
    var gtagParams = JSON.parse(JSON.stringify(purchaseParams));
    gtagParams.send_to = GA4_MEASUREMENT_ID;
    whenGoogleTagReady(function () { gtag('event', 'purchase', gtagParams); });
    clearCart();
    sendCart(); // 空カート（status:false）→ カゴ落ち対象から外れる
    o.sent = true;
    write(ORDER_KEY, o);
    return o;
  }

  // ---------------- 表示ユーティリティ ----------------
  function yen(n) { return '¥' + Number(n).toLocaleString('ja-JP'); }

  function thumb(p, size) {
    size = size || 64;
    return '<div class="thumb" style="width:' + size + 'px;height:' + size + 'px;background:' + p.color +
      ';font-size:' + Math.round(size * 0.42) + 'px">' + p.icon + '</div>';
  }

  function renderBadge() {
    var n = summary().quantity;
    var els = d.querySelectorAll('[data-cart-count]');
    for (var i = 0; i < els.length; i++) {
      els[i].textContent = n;
      els[i].style.display = n > 0 ? '' : 'none';
    }
  }

  function toast(html) {
    var t = d.getElementById('demo-toast');
    if (!t) { t = d.createElement('div'); t.id = 'demo-toast'; d.body.appendChild(t); }
    t.innerHTML = html;
    t.className = 'show';
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.className = ''; }, 3500);
  }

  // ---------------- 送信イベントログ（検証用） ----------------
  function log(kind, name, payload, isWarn) {
    var entries = read(LOG_KEY, []);
    entries.unshift({ t: new Date().toLocaleTimeString('ja-JP'), kind: kind, name: name, page: location.pathname.split('/').pop() || 'index.html', payload: payload, warn: !!isWarn });
    write(LOG_KEY, entries.slice(0, 30));
    renderLog();
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function renderLog() {
    var box = d.getElementById('demo-log-list');
    if (!box) return;
    var entries = read(LOG_KEY, []);
    box.innerHTML = entries.length ? entries.map(function (e) {
      return '<details class="log-item' + (e.warn ? ' warn' : '') + '"><summary><span class="log-kind ' + e.kind.toLowerCase() + '">' + e.kind +
        '</span><b>' + esc(e.name) + '</b><span class="log-meta">' + esc(e.page) + ' ' + e.t + '</span></summary>' +
        (e.payload ? '<pre>' + esc(JSON.stringify(e.payload, null, 2)) + '</pre>' : '') + '</details>';
    }).join('') : '<p class="log-empty">まだイベントはありません</p>';
  }

  function mountLog() {
    var css = d.createElement('style');
    css.textContent =
      '#demo-log{position:fixed;right:16px;bottom:16px;width:360px;max-width:calc(100vw - 32px);z-index:9000;font-family:Menlo,Consolas,monospace;font-size:12px}' +
      '#demo-log>button{float:right;background:#202124;color:#fff;border:none;border-radius:16px;padding:8px 14px;cursor:pointer;font-size:12px;font-weight:bold;box-shadow:0 2px 6px rgba(0,0,0,.3)}' +
      '#demo-log .panel{clear:both;display:none;background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.2);margin-bottom:8px;max-height:55vh;overflow:auto}' +
      '#demo-log.open .panel{display:block}' +
      '#demo-log .head{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-bottom:1px solid #eee;position:sticky;top:0;background:#fff;font-family:sans-serif;font-weight:bold}' +
      '#demo-log .head button{border:1px solid #ccc;background:#fff;border-radius:4px;cursor:pointer;font-size:11px;padding:3px 8px}' +
      '#demo-log .log-item{border-bottom:1px solid #f0f0f0;padding:6px 10px}' +
      '#demo-log .log-item.warn b{color:#d93025}' +
      '#demo-log summary{cursor:pointer;display:flex;gap:6px;align-items:center}' +
      '#demo-log .log-kind{padding:1px 6px;border-radius:3px;color:#fff;font-size:10px}' +
      '#demo-log .log-kind.karte{background:#e60012}#demo-log .log-kind.ga4{background:#1a73e8}' +
      '#demo-log .log-meta{margin-left:auto;color:#999;font-size:10px}' +
      '#demo-log pre{margin:6px 0 0;background:#f8f9fa;padding:6px;border-radius:4px;white-space:pre-wrap;word-break:break-all;max-height:240px;overflow:auto}' +
      '#demo-log .log-empty{padding:10px;color:#999;margin:0}' +
      '#demo-toast{position:fixed;left:50%;top:20px;transform:translate(-50%,-150%);background:#202124;color:#fff;padding:14px 20px;border-radius:8px;z-index:9500;font-size:14px;transition:transform .25s;box-shadow:0 4px 16px rgba(0,0,0,.3)}' +
      '#demo-toast.show{transform:translate(-50%,0)}#demo-toast a{color:#ffd814;font-weight:bold;margin-left:12px}' +
      '.thumb{display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.9);font-weight:bold;border-radius:6px;flex-shrink:0;font-family:Georgia,serif}';
    d.head.appendChild(css);

    var el = d.createElement('div');
    el.id = 'demo-log';
    el.innerHTML = '<div class="panel"><div class="head">送信イベントログ（検証用）<button id="demo-log-clear">クリア</button></div><div id="demo-log-list"></div></div>' +
      '<button id="demo-log-toggle">イベントログ</button>';
    d.body.appendChild(el);
    try { if (sessionStorage.getItem('demo_log_open') === '1') el.className = 'open'; } catch (e) {}
    d.getElementById('demo-log-toggle').onclick = function () {
      el.className = el.className ? '' : 'open';
      try { sessionStorage.setItem('demo_log_open', el.className ? '1' : '0'); } catch (e) {}
    };
    d.getElementById('demo-log-clear').onclick = function () { write(LOG_KEY, []); renderLog(); };
    renderLog();
  }

  d.addEventListener('DOMContentLoaded', function () { mountLog(); renderBadge(); });

  w.DemoStore = {
    products: PRODUCTS, FREE_SHIPPING_THRESHOLD: FREE_SHIPPING_THRESHOLD,
    items: getItems, summary: summary, add: add, setQty: setQty, clearCart: clearCart,
    sendCart: sendCart, krtSend: krtSend, ga4: ga4, ga4Items: ga4Items, ga4Item: ga4Item,
    placeOrder: placeOrder, lastOrder: lastOrder, completeOrder: completeOrder,
    yen: yen, thumb: thumb, toast: toast, esc: esc
  };
})(window, document);
