/* Golden Hands Spa: offers + price list driven by a Google Sheet (or data/content.json as the safe fallback).
   Vanilla JS. To connect the Sheet, paste its ID into SHEET_ID (the sheet must be "Anyone with the link: Viewer"). */
(function () {
  'use strict';
  var SHEET_ID = '';                       // e.g. '1AbC...xyz'  (empty = use data/content.json only)
  var TABS = { prices: 'Prices', offers: 'Offers', settings: 'Settings' };
  var CACHE = 'gh_content_v1';
  var PREVIEW = /[?&]preview\b/.test(location.search);
  var STYLES = ['spotlight', 'card', 'banner'];
  var DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  function $(s, c) { return (c || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function kes(n) { return 'KES ' + Number(n).toLocaleString('en-KE'); }
  function num(v) { if (v === null || v === undefined || String(v).trim() === '') return null; var n = Number(String(v).replace(/[^0-9.]/g, '')); return isFinite(n) && n > 0 ? n : NaN; }
  function wa(no, msg) { return 'https://wa.me/' + no + '?text=' + encodeURIComponent(msg); }

  /* ---------- loading: sheet -> validate -> cache; fall back to cache, then bundled JSON ---------- */
  function csv(text) {
    var rows = [], row = [], f = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else if (c !== '\r') f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    var h = (rows.shift() || []).map(function (x) { return x.trim().toLowerCase(); });
    return rows.filter(function (r) { return r.join('').trim(); }).map(function (r) { var o = {}; h.forEach(function (k, j) { o[k] = (r[j] || '').trim(); }); return o; });
  }
  function fetchTab(name) {
    return fetch('https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(name), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(name); return r.text(); }).then(csv);
  }
  function validPrice(p) {
    var k = num(p.kilimani), b = num(p.kiambu);
    return p.service && p.category && !isNaN(k) && !isNaN(b) ? { category: p.category, service: p.service, duration: p.duration || '', kilimani: k, kiambu: b, note: p.note || '' } : null;
  }
  function validDate(s) { return !s || /^\d{4}-\d{2}-\d{2}$/.test(s); }
  function validTime(s) { return !s || /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
  function validOffer(o) {
    var st = (o.status || '').toLowerCase(), sty = (o.style || '').toLowerCase();
    if (!o.title || ['live', 'draft', 'off'].indexOf(st) < 0 || STYLES.indexOf(sty) < 0) return null;
    if (!validDate(o.start) || !validDate(o.end) || (o.start && o.end && o.start > o.end)) return null;
    if (!validTime(o.from) || !validTime(o.to) || (!!o.from !== !!o.to)) return null;
    if (o.price && isNaN(num(o.price))) return null;
    return { status: st, order: Number(o.order) || 9, style: sty, title: o.title, text: o.text || '', price: o.price || '', was: o.was || '', image: o.image || '',
      branch: o.branch || 'Both', start: o.start || '', end: o.end || '', days: o.days || 'Every day', from: o.from || '', to: o.to || '',
      show: (o.show || 'page').toLowerCase(), popup: (o.popup || 'visit').toLowerCase(), button: o.button || 'Book this offer' };
  }
  function clean(d) {
    return { settings: d.settings || {}, prices: (d.prices || []).map(validPrice).filter(Boolean), offers: (d.offers || []).map(validOffer).filter(Boolean) };
  }
  function load() {
    var bundled = fetch('data/content.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(clean);
    if (!SHEET_ID) return bundled;
    var cached = null; try { cached = JSON.parse(localStorage.getItem(CACHE)); } catch (e) {}
    return Promise.all([fetchTab(TABS.prices), fetchTab(TABS.offers), fetchTab(TABS.settings)]).then(function (t) {
      var s = {}; t[2].forEach(function (r) { if (r.key) s[r.key] = r.value; });
      var d = clean({ settings: s, prices: t[0], offers: t[1] });
      if (!d.prices.length) throw new Error('empty price list');      // half-finished sheet: keep the last good version
      try { localStorage.setItem(CACHE, JSON.stringify(d)); } catch (e) {}
      return d;
    }).catch(function () { return cached || bundled; });
  }

  /* ---------- offer timing ---------- */
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function dayOk(spec, dow) {
    spec = (spec || '').toLowerCase().replace(/\s/g, '');
    if (!spec || spec === 'everyday' || spec === 'daily') return true;
    if (spec === 'weekdays') spec = 'mon-fri'; if (spec === 'weekends') spec = 'sat-sun';
    return spec.split(',').some(function (part) {
      var ab = part.split('-').map(function (x) { return DAYS.indexOf(x.slice(0, 3)); });
      if (ab.length === 1) return ab[0] === dow;
      var a = ab[0], b = ab[1]; if (a < 0 || b < 0) return false;
      return a <= b ? dow >= a && dow <= b : dow >= a || dow <= b;
    });
  }
  function onNow(o) {
    var n = new Date(); if (!dayOk(o.days, n.getDay())) return false;
    if (!o.from) return true;
    var m = n.getHours() * 60 + n.getMinutes(), f = o.from.split(':'), t = o.to.split(':');
    return m >= +f[0] * 60 + +f[1] && m < +t[0] * 60 + +t[1];
  }
  function when(o) {
    var d = o.days && !/every|daily/i.test(o.days) ? o.days.replace(/-/g, '–') : 'Every day';
    if (!o.from) return d;
    var h = function (s) { var p = s.split(':'), H = +p[0]; return (H % 12 || 12) + (p[1] !== '00' ? ':' + p[1] : '') + (H < 12 ? 'am' : 'pm'); };
    return d + ', ' + h(o.from) + '–' + h(o.to);
  }
  function endsIn(o) {
    if (!o.end) return '';
    var ms = new Date(o.end + 'T23:59:59') - new Date(); if (ms <= 0) return '';
    var dd = Math.floor(ms / 864e5); if (dd >= 2) return 'Ends in ' + dd + ' days';
    var hh = Math.floor(ms / 36e5), mm = Math.floor(ms % 36e5 / 6e4); return 'Ends in ' + hh + 'h ' + mm + 'm';
  }
  function live(d) {
    var t = today();
    return d.offers.filter(function (o) {
      return (o.status === 'live' || (PREVIEW && o.status === 'draft')) && (!o.start || o.start <= t) && (!o.end || o.end >= t);
    }).sort(function (a, b) { return a.order - b.order; }).slice(0, 3);
  }

  /* ---------- renderers ---------- */
  function buttons(o, s, cls) {
    var msg = function (br) { return 'Hello Golden Hands Spa 👋 I\'d like to book the "' + o.title + '" offer' + (br ? ' at ' + br : '') + '. Is there a slot available?'; };
    var K = s.wa_kilimani || '254719369088', R = s.wa_kiambu || '254791871433';
    if (/kilimani/i.test(o.branch)) return '<a class="btn ' + cls + '" target="_blank" rel="noopener" href="' + wa(K, msg('Kilimani')) + '">' + esc(o.button) + '</a>';
    if (/kiambu/i.test(o.branch)) return '<a class="btn ' + cls + '" target="_blank" rel="noopener" href="' + wa(R, msg('Kiambu Road')) + '">' + esc(o.button) + '</a>';
    return '<a class="btn ' + cls + '" target="_blank" rel="noopener" href="' + wa(K, msg('Kilimani')) + '">' + (cls === 'btn--mini' ? 'Book · Kilimani' : esc(o.button) + ' · Kilimani') + '</a>' +
           '<a class="btn btn--ghostlite" target="_blank" rel="noopener" href="' + wa(R, msg('Kiambu Road')) + '">Kiambu Road</a>';
  }
  function meta(o) {
    var b = onNow(o) && o.from ? '<span class="of-now">On now</span>' : '';
    var e = endsIn(o); var dr = o.status === 'draft' ? '<span class="of-draft">Draft</span>' : '';
    var br = /both/i.test(o.branch) ? 'Both branches' : esc(o.branch);
    return '<div class="of-meta">' + dr + b + '<span>' + esc(when(o)) + '</span><span>' + br + '</span>' + (e ? '<span class="of-end" data-end="' + o.end + '">' + e + '</span>' : '') + '</div>';
  }
  function price(o) {
    if (!o.price) return '';
    return '<p class="of-price">' + (o.was ? '<s>' + kes(num(o.was)) + '</s> ' : '') + kes(num(o.price)) + '</p>';
  }
  function card(o, s) {
    var img = o.image ? '<img src="images/' + esc(o.image) + '" alt="" loading="lazy">' : '';
    if (o.style === 'spotlight') return '<article class="of of--spot rv">' + img + '<div class="of-body">' + meta(o) + '<h3>' + esc(o.title) + '</h3><p>' + esc(o.text) + '</p>' + price(o) + '<div class="of-btns">' + buttons(o, s, 'btn--gold') + '</div></div></article>';
    return '<article class="of of--card rv">' + (img ? '<div class="of-img">' + img + '</div>' : '') + '<div class="of-body">' + meta(o) + '<h3>' + esc(o.title) + '</h3><p>' + esc(o.text) + '</p>' + price(o) + '<div class="of-btns">' + buttons(o, s, 'btn--gold') + '</div></div></article>';
  }
  function renderOffers(d) {
    var L = live(d), s = d.settings, sec = $('#offers'), hh = $('#happyhour');
    var onPage = L.filter(function (o) { return o.style !== 'banner' && o.show !== 'popup'; });
    var banners = L.filter(function (o) { return o.style === 'banner' && o.show !== 'popup'; });
    if (banners.length) {
      var b = banners[0], el = document.createElement('div'); el.className = 'of-banner';
      el.innerHTML = '<div class="wrap"><span>' + (onNow(b) && b.from ? '<b class="of-now">On now</b> ' : '') + '<b>' + esc(b.title) + '</b> ' + esc(b.text) + '</span>' + buttons(b, s, 'btn--mini') + '</div>';
      document.body.prepend(el); document.body.classList.add('has-bar');
      var fit = function () { document.documentElement.style.setProperty('--bar-h', el.offsetHeight + 'px'); };
      fit(); window.addEventListener('resize', fit);
    }
    if (sec) {
      if (onPage.length) {
        var sp = onPage.filter(function (o) { return o.style === 'spotlight'; }), cd = onPage.filter(function (o) { return o.style !== 'spotlight'; });
        $('.of-grid', sec).innerHTML = sp.map(function (o) { return card(o, s); }).join('') +
          (cd.length ? '<div class="of-cards' + (cd.length === 1 ? ' one' : '') + '">' + cd.map(function (o) { return card(o, s); }).join('') + '</div>' : '');
        sec.hidden = false; if (hh) hh.hidden = true;
        sec.querySelectorAll('.rv').forEach(function (x) { x.classList.add('in'); });
      } else if (hh && s.no_offer === 'hide') hh.hidden = true;
    }
    var pop = L.filter(function (o) { return o.show === 'popup' || o.show === 'both'; })[0];
    if (pop) popup(pop, s);
    setInterval(function () { document.querySelectorAll('.of-end').forEach(function (x) { var t = endsIn({ end: x.dataset.end }); if (t) x.textContent = t; }); }, 60000);
  }
  function popup(o, s) {
    var key = 'gh_pop_' + o.title, now = today();
    try {
      if (!PREVIEW) {
        if (o.popup === 'day' && localStorage.getItem(key) === now) return;
        if (o.popup !== 'day' && sessionStorage.getItem(key)) return;
      }
    } catch (e) {}
    setTimeout(function () {
      var w = document.createElement('div'); w.className = 'of-pop'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-label', o.title);
      w.innerHTML = '<div class="of-pop__box">' + (o.image ? '<img src="images/' + esc(o.image) + '" alt="">' : '') + '<button class="of-pop__x" aria-label="Close">×</button><div class="of-body">' + meta(o) + '<h3>' + esc(o.title) + '</h3><p>' + esc(o.text) + '</p>' + price(o) + '<div class="of-btns">' + buttons(o, s, 'btn--gold') + '</div></div></div>';
      document.body.appendChild(w); requestAnimationFrame(function () { w.classList.add('open'); });
      var close = function () { w.classList.remove('open'); setTimeout(function () { w.remove(); }, 400); };
      w.addEventListener('click', function (e) { if (e.target === w || e.target.classList.contains('of-pop__x')) close(); });
      document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
      try { if (o.popup === 'day') localStorage.setItem(key, now); else sessionStorage.setItem(key, '1'); } catch (e) {}
    }, 4000);
  }
  function renderPrices(d) {
    var box = $('#price-list'); if (!box || !d.prices.length) return;
    var s = d.settings, hasK = d.prices.some(function (p) { return p.kiambu; }), branch = 'kilimani';
    var cats = []; d.prices.forEach(function (p) { if (cats.indexOf(p.category) < 0) cats.push(p.category); });
    function draw() {
      var no = branch === 'kiambu' ? (s.wa_kiambu || '254791871433') : (s.wa_kilimani || '254719369088'), bn = branch === 'kiambu' ? 'Kiambu Road' : 'Kilimani';
      box.querySelector('.pl-body').innerHTML = cats.map(function (c) {
        return '<div class="pl-cat"><h3>' + esc(c) + '</h3>' + d.prices.filter(function (p) { return p.category === c; }).map(function (p) {
          var v = branch === 'kiambu' && p.kiambu ? p.kiambu : p.kilimani;
          return '<div class="pl-row"><div><b>' + esc(p.service) + '</b>' + (p.duration ? '<small>' + esc(p.duration) + '</small>' : '') + (p.note ? '<em>' + esc(p.note) + '</em>' : '') + '</div><span class="pl-dots"></span>' +
            '<a class="pl-price" target="_blank" rel="noopener" href="' + wa(no, 'Hello Golden Hands Spa 👋 I\'d like to book ' + p.service + ' at ' + bn + '.') + '">' + (v ? kes(v) : 'Ask us') + '</a></div>';
        }).join('') + '</div>';
      }).join('');
    }
    box.innerHTML = '<div class="pl-head"><div><p class="eyebrow">Price list</p><h2>Our prices</h2><p class="muted">Tap a price to book it on WhatsApp.</p></div>' +
      (hasK ? '<div class="pl-switch" role="group" aria-label="Branch"><button class="on" data-b="kilimani">Kilimani</button><button data-b="kiambu">Kiambu Road</button></div>' : '<p class="pl-branch">Kilimani prices</p>') +
      '</div><div class="pl-body"></div>';
    box.querySelectorAll('.pl-switch button').forEach(function (b) {
      b.addEventListener('click', function () { branch = b.dataset.b; box.querySelectorAll('.pl-switch button').forEach(function (x) { x.classList.toggle('on', x === b); }); draw(); });
    });
    draw(); box.hidden = false;
  }

  if (PREVIEW) { var r = document.createElement('div'); r.className = 'of-ribbon'; r.textContent = 'Preview: drafts are visible only on this link'; document.body.appendChild(r); }
  load().then(function (d) { renderOffers(d); renderPrices(d); }).catch(function () {});
})();
