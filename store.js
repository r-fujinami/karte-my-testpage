diff --git a/store.js b/store.js
index 9e23e7f..8a8392b 100644
--- a/store.js
+++ b/store.js
@@ -150,6 +150,13 @@
     log('GA4', event, ecommerce);
   }
 
+  // gtag コマンドで GA4 に直接送信（GTM のトリガー設定なしで送れる）
+  // GTM で配信している Google タグが dataLayer 上の gtag コマンドを読み取って送信する
+  function gtag() {
+    w.dataLayer = w.dataLayer || [];
+    w.dataLayer.push(arguments); // 配列ではなく arguments をそのまま積む（gtag の仕様）
+  }
+
   // ---------------- 注文 ----------------
   function placeOrder(info) {
     var s = summary();
@@ -180,7 +187,7 @@
     //   必須: transaction_id, value(数値), currency(value と必ずセット), items
     //   推奨: tax, shipping, affiliation, coupon（クーポン機能はないため未送信）
     //   value は商品小計（送料を含まない・税込）
-    ga4('purchase', {
+    var purchaseParams = {
       transaction_id: String(o.transaction_id),
       affiliation: AFFILIATION,
       value: Number(o.subtotal),
@@ -188,7 +195,11 @@
       shipping: Number(o.shipping),
       currency: 'JPY',
       items: ga4Items(o.items)
-    });
+    };
+    ga4('purchase', purchaseParams);
+    // GTM にトリガーを作らずに GA4 へ送る。
+    // ※GTM 側に purchase のカスタムイベントトリガーを追加した場合は二重計上になるので、この行を削除すること
+    gtag('event', 'purchase', purchaseParams);
     clearCart();
     sendCart(); // 空カート（status:false）→ カゴ落ち対象から外れる
     o.sent = true;
