*
 * GA4検証用：テストユーザー管理（GTMへの user_id 連携）
 * ※必ず GTM スニペットより「前」に同期読み込みすること
 *   <script src="ga4-user.js"></script>
 *   <!-- Google Tag Manager --> ...
 */
(function (w) {
  var STORAGE_KEY = 'ga4_test_user';
 
  // テストユーザー定義（GA4上で別ユーザーとして見分けるためのダミー）
  var TEST_USERS = {
    'test_user_001': { member_rank: 'gold',    user_type: 'member' },
    'test_user_002': { member_rank: 'silver',  user_type: 'member' },
    'test_user_003': { member_rank: 'regular', user_type: 'member' }
  };
 
  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { return null; }
  }
  function save(u) {
    try { u ? localStorage.setItem(STORAGE_KEY, JSON.stringify(u)) : localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }
 
  w.dataLayer = w.dataLayer || [];
  var current = load();
 
  // ページ読み込み時：GTMより前に user_id を積む → page_view に user_id が乗る
  w.dataLayer.push({
    user_id: current ? current.user_id : undefined,
    login_status: current ? 'logged_in' : 'guest',
    member_rank: current ? current.member_rank : undefined,
    user_type: current ? current.user_type : 'guest'
  });
 
  // GTMが読み込めない（広告ブロッカー等）場合も確実にリロードする
  function reloadOnce() {
    var done = false;
    function go() { if (!done) { done = true; location.reload(); } }
    setTimeout(go, 2000);
    return go;
  }
 
  w.GA4TestUser = {
    users: TEST_USERS,
    current: function () { return load(); },
 
    login: function (userId) {
      if (!userId) return;
      var meta = TEST_USERS[userId] || { member_rank: 'custom', user_type: 'member' };
      var u = { user_id: userId, member_rank: meta.member_rank, user_type: meta.user_type };
      save(u);
      w.dataLayer.push({
        event: 'login',
        method: 'test_login',
        user_id: u.user_id,
        login_status: 'logged_in',
        member_rank: u.member_rank,
        user_type: u.user_type,
        eventCallback: reloadOnce(),
        eventTimeout: 1500
      });
    },
 
    logout: function () {
      save(null);
      w.dataLayer.push({
        event: 'logout',
        user_id: null,          // GA4側の user_id をクリア
        login_status: 'guest',
        member_rank: null,
        user_type: 'guest',
        eventCallback: reloadOnce(),
        eventTimeout: 1500
      });
    },
 
    // 別デバイス／新規ブラウザを再現：_ga系Cookieを削除して client_id を作り直す
    resetClientId: function () {
      var host = location.hostname;
      document.cookie.split(';').forEach(function (c) {
        var name = c.split('=')[0].trim();
        if (name.indexOf('_ga') === 0) {
          ['', host, '.' + host].forEach(function (d) {
            document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (d ? '; domain=' + d : '');
          });
        }
      });
      location.reload();
    },
 
    // 現在の _ga Cookie から client_id を取得（表示用）
    clientId: function () {
      var m = document.cookie.match(/(?:^|;\s*)_ga=GA\d\.\d\.(\d+\.\d+)/);
      return m ? m[1] : '(未発行)';
    }
  };
})(window);
 
