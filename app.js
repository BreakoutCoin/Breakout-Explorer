var express = require('express')
  , path = require('path')
  , bitcoinapi = require('bitcoin-node-api')
  , favicon = require('static-favicon')
  , logger = require('morgan')
  , cookieParser = require('cookie-parser')
  , bodyParser = require('body-parser')
  , settings = require('./lib/settings')
  , routes = require('./routes/index')
  , lib = require('./lib/explorer')
  , db = require('./lib/database')
  , locale = require('./lib/locale')
  , request = require('request')
  , rpc = require('./lib/rpc')
  , currs = require('./lib/currencies')
  , Tx = require('./models/tx');

var app = express();

// bitcoinapi
//
// SECURITY: bitcoin-node-api is a blind passthrough. Its route is app.get('*'),
// which takes whatever method name appears in the path and hands it straight to
// the wallet as an RPC command -- there is no table of supported methods. The
// setAccess('only', [...]) list below is therefore the ONLY thing standing
// between the public internet and the full RPC surface of a wallet we have just
// given credentials to via setWalletDetails(). Add read-only calls here, never
// anything that can move coins or read keys.
//
// Note also that the passthrough forwards query parameters POSITIONALLY, in the
// order they appear in the URL, ignoring their names. So getrichlist wants
// ?color=57&start=1&max=100 in exactly that order; naming them differently or
// reordering them silently changes which RPC argument each one becomes.

// Breakout Explore API: read-only address, rich list and card queries, served
// by breakoutd when it runs with exploreapi=1. Same data explore.brk.zone
// already serves publicly. Shared by both branches below so that turning on
// 'heavy' cannot silently drop them.
var explore_api_methods = [
  'getaddressinfo', 'getaddressbalance',
  'getaddressinoutspg', 'getaddressutxospg', 'getaddresstxspg',
  'getrichlist', 'getrichlistpg', 'getrichlistsize',
  'getcardinfo'
];

bitcoinapi.setWalletDetails(settings.wallet);
if (settings.heavy != true) {
  bitcoinapi.setAccess('only', ['getinfo', 'getnetworkhashps', 'getmininginfo','getdifficulty', 'getconnectioncount',
    'getblockcount', 'getblockhash', 'getblock', 'getrawtransaction', 'getpeerinfo', 'gettxoutsetinfo'
    ].concat(explore_api_methods));
} else {
  // enable additional heavy api calls
  /*
    getvote - Returns the current block reward vote setting.
    getmaxvote - Returns the maximum allowed vote for the current phase of voting.
    getphase - Returns the current voting phase ('Mint', 'Limit' or 'Sustain').
    getreward - Returns the current block reward, which has been decided democratically in the previous round of block reward voting.
    getnextrewardestimate - Returns an estimate for the next block reward based on the current state of decentralized voting.
    getnextrewardwhenstr - Returns string describing how long until the votes are tallied and the next block reward is computed.
    getnextrewardwhensec - Same as above, but returns integer seconds.
    getsupply - Returns the current money supply.
    getmaxmoney - Returns the maximum possible money supply.
  */
  bitcoinapi.setAccess('only', ['getinfo', 'getstakinginfo', 'getnetworkhashps', 'getdifficulty', 'getconnectioncount',
    'getblockcount', 'getblockhash', 'getblock', 'getrawtransaction','getmaxmoney', 'getvote',
    'getmaxvote', 'getphase', 'getreward', 'getnextrewardestimate', 'getnextrewardwhenstr',
    'getnextrewardwhensec', 'getsupply', 'gettxoutsetinfo'
    ].concat(explore_api_methods));
}
// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(favicon(path.join(__dirname, settings.favicon)));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded());
app.use(cookieParser());
// Serve the The Deck multicurrency SPA as the document root ('/').
// (index option is used instead of res.sendFile — Express 4.2 predates sendFile.)
app.use(express.static(path.join(__dirname, 'public'), { index: 'thedeck.html' }));

// [JAMES_HANDOFF change 1/3 — CORS] Let browsers on other origins (e.g. thedeck.rocks
// card pages) fetch() these public read-only /ext endpoints. Origin '*' is fine here
// since everything under /ext is read-only JSON; swap '*' for 'https://thedeck.rocks'
// to lock it to that one site.
// MUST be registered BEFORE the '/' router below: routes/index.js (base Iquidus) also
// serves some /ext/* endpoints — notably /ext/summary — and if CORS is mounted after,
// those respond first without the header, so browsers block them (e.g. the wallet's
// confirmations lookup). Registering it here covers every /ext route, base + custom.
app.use('/ext', function(req, res, next){
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET');
  next();
});

// routes
app.use('/api', bitcoinapi.app);
app.use('/', routes);

app.use('/ext/getmoneysupply', function(req,res){
  lib.get_supply(function(supply){
    res.send(' '+supply);
  });
});

// Address data now comes from the daemon's Explore index rather than Mongo.
//
// Two things improve as a result. The balance is the chain's own, not a total
// this explorer accumulated transaction by transaction and could drift from.
// And last_txs is no longer capped at settings.txcount (100) -- getaddresstxspg
// pages the full history, so `count` can exceed what the Mongo index kept.
//
// The response shape is unchanged, so the address page and the front end need
// no changes: last_txs entries keep the {addresses: <txid>, type: ...} form
// Iquidus used, odd as that key name is.
function explore_address(hash, count, cb) {
  rpc.call('getaddressinfo', {address: hash}, function(info){
    if (!info || typeof info !== 'object' || info.balance === undefined) {
      return cb(null);
    }
    if (!count) {
      return cb({info: info, txs: []});
    }
    // ordering:false = newest first. This is the call that cannot be made
    // through the /api/ passthrough at all, since it cannot carry a boolean.
    rpc.call('getaddresstxspg',
             {address: hash, page: 1, perpage: count, ordering: false},
             function(page){
      var rows = (page && typeof page === 'object' && page.data) ? page.data : [];
      return cb({info: info, txs: rows});
    });
  });
}

// vin/vout classification for a row of getaddresstxspg. An address that both
// spends and receives in one transaction counts as a spend, matching how
// Iquidus recorded it.
function txrow_type(row) {
  var ins = row.address_inputs, outs = row.address_outputs;
  if (ins && ins.length) return 'vin';
  if (outs && outs.length) return 'vout';
  return 'vout';
}

app.use('/ext/getaddress/:hash', function(req,res){
  var hash = req.param('hash');
  explore_address(hash, settings.txcount || 100, function(r){
    if (!r) return res.send({ error: 'address not found.', hash: hash});
    res.send({
      address: hash,
      sent: r.info.sent,
      received: r.info.received,
      balance: String(r.info.balance).replace(/(^-+)/mg, ''),
      last_txs: r.txs.map(function(t){
        return { addresses: t.txid, type: txrow_type(t) };
      })
    });
  });
});

app.use('/ext/getbalance/:hash', function(req,res){
  var hash = req.param('hash');
  rpc.call('getaddressbalance', {address: hash}, function(bal){
    if (bal === rpc.ERRSTR || bal === undefined || bal === null) {
      return res.send({ error: 'address not found.', hash: hash});
    }
    // getaddressbalance answers "3542473.27180316 BRK"; the endpoint has always
    // returned a bare number as a string, so keep it that way.
    res.send(String(bal).split(' ')[0].replace(/(^-+)/mg, ''));
  });
});

// Legacy distribution endpoint for the main coin. Same tiers as
// /ext/getcoindist, kept for API compatibility; both now read the daemon.
app.use('/ext/getdistribution', function(req,res){
  var coin = settings.symbol;
  lib.get_moneysupply(coin, function(supply){
    supply = supply || 0;
    rpc.call('getrichlist', {color: currs.color(coin), start: 1, max: 100}, function(list){
      var top = [];
      if (list && typeof list === 'object') {
        for (var a in list) {
          if (Object.prototype.hasOwnProperty.call(list, a)) top.push(list[a]);
        }
        top.sort(function(x, y){ return y - x; });
        top = top.slice(0, 100);
      }
      var tiers = { t_1_25:{p:0,t:0}, t_26_50:{p:0,t:0}, t_51_75:{p:0,t:0}, t_76_100:{p:0,t:0} };
      for (var i = 0; i < top.length; i++) {
        var pct = supply > 0 ? (top[i] / supply * 100) : 0, n = i + 1;
        var k = n<=25?'t_1_25':n<=50?'t_26_50':n<=75?'t_51_75':n<=100?'t_76_100':null;
        if (k) { tiers[k].p += pct; tiers[k].t += top[i]; }
      }
      var sumP = tiers.t_1_25.p + tiers.t_26_50.p + tiers.t_51_75.p + tiers.t_76_100.p;
      var sumT = tiers.t_1_25.t + tiers.t_26_50.t + tiers.t_51_75.t + tiers.t_76_100.t;
      var f = function(o){ return { percent: Number(o.p).toFixed(2), total: Number(o.t).toFixed(8) }; };
      res.send({ supply: supply, t_1_25: f(tiers.t_1_25), t_26_50: f(tiers.t_26_50),
        t_51_75: f(tiers.t_51_75), t_76_100: f(tiers.t_76_100),
        t_101plus: { percent: Math.max(0, 100 - sumP).toFixed(2),
                     total: Number(Math.max(0, supply - sumT)).toFixed(8) } });
    });
  });
});

app.use('/ext/getlasttxs/:min', function(req,res){
  db.get_last_txs(settings.index.last_txs, (req.params.min * settings.toshis), function(txs){
    res.send({data: txs});
  });
});

app.use('/ext/connections', function(req,res){
  // Read peers LIVE from the node (getpeerinfo) on every request, so the Network page
  // shows whatever the wallet is actually connected to right now — the current peers and
  // any new ones the moment they connect. (The Mongo `peers` collection is only filled by
  // Iquidus's separate peers-sync cron, which isn't running here, so it read empty.)
  var peerUri = 'http://' + (process.env.EXPLORER_API_HOST || '127.0.0.1') + ':' + settings.port + '/api/getpeerinfo';
  request({uri: peerUri, json: true, timeout: 5000}, function(err, resp, body){
    if (err || !Array.isArray(body)) {
      // node call failed — fall back to whatever the DB collection has (may be empty)
      return db.get_peers(function(peers){ res.send({data: peers || []}); });
    }
    var peers = body.map(function(p){
      return {
        address:  p.addr,                                              // e.g. <onion>:11698
        protocol: p.version,                                           // numeric protocol version
        version:  p.subver,                                            // e.g. /Harman:1.7.3/
        inbound:  !!p.inbound,                                         // true = they dialled us
        conntime: (p.conntime != null ? p.conntime : null),           // unix secs the connection opened
        height:   (p.startingheight != null ? p.startingheight : null)  // their height AT connect (not live)
      };
    });
    res.send({data: peers});
  });
});

// per-coin stats. txcount is real (vout.currency is indexed per output).
// supply/holders are intentionally NOT returned: addresses aren't currency-tagged
// in the index, so those cannot be derived truthfully without an indexer change.
app.use('/ext/getcoinstats/:coin', function(req,res){
  var coin = (req.params.coin || '').toUpperCase();
  var color = currs.color(coin);
  // txcount still comes from the tx index: the Explore API is address-scoped
  // and has no per-currency transaction count.
  Tx.count({ 'vout.currency': coin }, function(err, txcount){
    lib.get_moneysupply(coin, function(supply){
      rpc.call('getrichlistsize', {color: color}, function(holders){
        res.send({ coin: coin,
                   txcount: (err ? 0 : (txcount || 0)),
                   holders: (typeof holders === 'number' ? holders : 0),
                   supply: supply || 0 });
      });
    });
  });
});

// per-coin wealth distribution tiers, from the daemon's rich list.
// (distinct name from the legacy /ext/getdistribution so its prefix match can't shadow this)
app.use('/ext/getcoindist/:coin', function(req,res){
  var coin = (req.params.coin || '').toUpperCase();
  var color = currs.color(coin);
  lib.get_moneysupply(coin, function(supply){
    supply = supply || 0;
    rpc.call('getrichlist', {color: color, start: 1, max: 100}, function(list){
      var top = [];
      if (list && typeof list === 'object') {
        for (var a in list) {
          if (Object.prototype.hasOwnProperty.call(list, a)) top.push(list[a]);
        }
        top.sort(function(x, y){ return y - x; });
        top = top.slice(0, 100);
      }
      var tiers = { t_1_25:{p:0,t:0}, t_26_50:{p:0,t:0}, t_51_75:{p:0,t:0}, t_76_100:{p:0,t:0} };
      for (var i = 0; i < top.length; i++) {
        var bal = top[i], pct = supply > 0 ? (bal / supply * 100) : 0, n = i + 1;
        var k = n<=25?'t_1_25':n<=50?'t_26_50':n<=75?'t_51_75':n<=100?'t_76_100':null;
        if (k) { tiers[k].p += pct; tiers[k].t += bal; }
      }
      var top100 = tiers.t_1_25.p + tiers.t_26_50.p + tiers.t_51_75.p + tiers.t_76_100.p;
      var top100t = tiers.t_1_25.t + tiers.t_26_50.t + tiers.t_51_75.t + tiers.t_76_100.t;
      var f = function(o){ return { percent: Number(o.p).toFixed(2), total: Number(o.t).toFixed(8) }; };
      res.send({ supply: supply, t_1_25: f(tiers.t_1_25), t_26_50: f(tiers.t_26_50),
        t_51_75: f(tiers.t_51_75), t_76_100: f(tiers.t_76_100),
        t_101plus: { percent: Math.max(0, 100 - top100).toFixed(2), total: Number(Math.max(0, supply - top100t)).toFixed(8) } });
    });
  });
});

// Balance-bucket histogram, shared by /ext/getcoinbuckets and /ext/getbalancedist.
//
// getrichlistsize(color, minbalance) counts addresses holding AT LEAST
// minbalance, so each bucket is the difference between the counts at its two
// edges. Six cheap counts replace six collection scans, and no address list is
// enumerated at all.
//
// The lowest bucket starts at a cent rather than zero: the daemon does not
// track balances at or below ExploreMaxDust, so "0 - 1" means "0.01 up to 1".
// The labels are unchanged so chart legends are unaffected.
var BALANCE_BUCKETS = [
  ['0 – 1',      0.01,  1],
  ['1 – 10',        1, 10],
  ['10 – 100',     10, 100],
  ['100 – 1k',    100, 1000],
  ['1k – 10k',   1000, 10000],
  ['10k +',     10000, null]
];

function balance_buckets(color, cb) {
  if (color === undefined) {
    return cb(BALANCE_BUCKETS.map(function(e){ return { label: e[0], count: 0 }; }));
  }
  var wanted = [];
  BALANCE_BUCKETS.forEach(function(e){
    if (wanted.indexOf(e[1]) === -1) wanted.push(e[1]);
    if (e[2] !== null && wanted.indexOf(e[2]) === -1) wanted.push(e[2]);
  });
  var counts = {}, i = 0;
  (function next(){
    if (i >= wanted.length) {
      return cb(BALANCE_BUCKETS.map(function(e){
        var lo = counts[e[1]] || 0;
        var hi = (e[2] === null) ? 0 : (counts[e[2]] || 0);
        return { label: e[0], count: Math.max(0, lo - hi) };
      }));
    }
    var edge = wanted[i];
    rpc.call('getrichlistsize', {color: color, minbalance: edge}, function(n){
      counts[edge] = (typeof n === 'number') ? n : 0;
      i++; next();
    });
  })();
}

app.use('/ext/getcoinbuckets/:coin', function(req,res){
  var coin = (req.params.coin || '').toUpperCase();
  balance_buckets(currs.color(coin), function(data){
    res.send({ coin: coin, data: data });
  });
});

// per-coin holder count + top holders (privacy: distribution use only; full list available for API consumers)
// Top holders, from the daemon's rich list.
//
// The holder COUNT changes meaning slightly here, and more honestly: the
// daemon does not track balances at or below ExploreMaxDust (one cent of the
// colour) -- see the "dust balances are not tracked this way" comment in
// explore.cpp -- so this counts addresses holding more than a cent, where the
// old AddressBalance query counted anything above zero. For BRX that is 6274
// rather than 6314.
app.use('/ext/getholders/:coin', function(req,res){
  var coin = (req.params.coin || '').toUpperCase();
  var color = currs.color(coin);
  if (color === undefined) return res.send({ coin: coin, holders: 0, top: [] });
  rpc.call('getrichlistsize', {color: color}, function(holders){
    rpc.call('getrichlist', {color: color, start: 1, max: 100}, function(list){
      var top = [];
      if (list && typeof list === 'object') {
        for (var addr in list) {
          if (Object.prototype.hasOwnProperty.call(list, addr)) {
            top.push({ address: addr, balance: list[addr] });
          }
        }
        // GetRichList returns everyone tied for the last place, so max=100 can
        // return more than 100. Sort and trim rather than trusting the length.
        top.sort(function(a, b){ return b.balance - a.balance; });
        top = top.slice(0, 100);
      }
      res.send({ coin: coin,
                 holders: (typeof holders === 'number' ? holders : 0),
                 top: top });
    });
  });
});

// per-coin money supply (minted - burned), in coins
app.use('/ext/getsupply/:coin', function(req,res){
  var coin = (req.params.coin || '').toUpperCase();
  lib.get_moneysupply(coin, function(supply){ res.send({ coin: coin, supply: supply || 0 }); });
});

// last N blocks (max 100), derived from the tx index. Iquidus keeps no block
// collection, so recent blocks are aggregated from the most-recently-indexed
// transactions. "forger" is the coinstake recipient (an output paying back a
// vin address) when present, else the first output — a best-effort staker/miner.
app.use('/ext/getlastblocks/:count', function(req,res){
  var count = Math.min(Math.max(parseInt(req.params.count, 10) || 10, 1), 100);
  Tx.find().sort({ _id: -1 }).limit(count * 12).exec(function(err, txs){
    if (err || !txs) return res.send({ data: [] });
    var seen = {}, order = [];
    for (var i = 0; i < txs.length; i++) {
      var t = txs[i], h = t.blockindex;
      if (h == null) continue;
      if (seen[h] === undefined) {
        seen[h] = { height: h, blockhash: t.blockhash, timestamp: t.timestamp, txns: 0, forger: null, stake: false };
        order.push(h);
      }
      var b = seen[h];
      b.txns++;
      if (t.timestamp && (!b.timestamp || t.timestamp > b.timestamp)) b.timestamp = t.timestamp;
      if (!b.stake) {
        var vinA = (t.vin || []).map(function(v){ return v.address; });
        var so = (t.vout || []).filter(function(o){ return o.address && vinA.indexOf(o.address) >= 0; })[0];
        if (so) { b.forger = so.address; b.stake = true; }
        else if (!b.forger && t.vout && t.vout[0]) b.forger = t.vout[0].address;
      }
    }
    var out = order.sort(function(a,b){ return b - a; }).slice(0, count).map(function(h){ return seen[h]; });
    res.send({ data: out });
  });
});

// single transaction, straight from the index (vin/vout already currency-tagged).
app.use('/ext/gettx/:txid', function(req,res){
  db.get_tx(req.params.txid, function(tx){
    res.send(tx ? tx : { error: 'transaction not found', txid: req.params.txid });
  });
});

// block by height — resolves height->hash->block over RPC, then attaches the
// block's indexed transactions (with per-currency vout values) from Mongo.
app.use('/ext/getblock/:height', function(req,res){
  var h = parseInt(req.params.height, 10);
  if (isNaN(h)) return res.send({ error: 'bad height', height: req.params.height });
  var ERRSTR = 'There was an error. Check your console.';
  lib.get_blockhash(h, function(hash){
    if (!hash || hash == ERRSTR) return res.send({ error: 'block not found', height: h });
    lib.get_block(hash, function(block){
      if (!block || block == ERRSTR) return res.send({ error: 'block not found', height: h });
      db.get_txs(block, function(txs){
        res.send({ block: block, txs: (txs || []) });
      });
    });
  });
});

// paged transactions (25/page) — real skip/limit over the whole tx index, so the
// pager walks back through all history. filter = all | BRK | BRX | SIS | cards.
app.use('/ext/gettxpage/:filter/:page', function(req,res){
  var per = 25, page = Math.max(1, parseInt(req.params.page, 10) || 1);
  var f = (req.params.filter || 'all').toLowerCase(), query = {};
  if (f === 'cards') query = { 'vout.currency': /^D/ };
  else if (f !== 'all') query = { 'vout.currency': (req.params.filter || '').toUpperCase() };
  Tx.count(query, function(err, total){
    total = total || 0;
    Tx.find(query).sort({ _id: -1 }).skip((page - 1) * per).limit(per).exec(function(e2, txs){
      res.send({ page: page, per: per, total: total, pages: Math.max(1, Math.ceil(total / per)), data: (txs || []) });
    });
  });
});

// paged blocks (25/page) — Iquidus stores no block collection, so blocks are the
// DISTINCT indexed heights (via aggregation), paged newest-first, then enriched
// with txns/timestamp/forger from the txs of just that page's heights.
app.use('/ext/getblockpage/:page', function(req,res){
  var per = 25, page = Math.max(1, parseInt(req.params.page, 10) || 1);
  Tx.distinct('blockindex', function(e0, all){
    var heightsAll = (all || []).filter(function(h){ return h != null; }).sort(function(a,b){ return b - a; });
    var total = heightsAll.length, pages = Math.max(1, Math.ceil(total / per));
    var heights = heightsAll.slice((page - 1) * per, (page - 1) * per + per);
    if (!heights.length) return res.send({ page: page, per: per, total: total, pages: pages, data: [] });
    Tx.find({ blockindex: { $in: heights } }).exec(function(e2, txs){
        var seen = {};
        (txs || []).forEach(function(t){
          var h = t.blockindex;
          if (!seen[h]) seen[h] = { height: h, blockhash: t.blockhash, timestamp: t.timestamp, txns: 0, forger: null, stake: false };
          var b = seen[h]; b.txns++;
          if (t.timestamp && (!b.timestamp || t.timestamp > b.timestamp)) b.timestamp = t.timestamp;
          if (!b.stake) {
            var vinA = (t.vin || []).map(function(v){ return v.address; });
            var so = (t.vout || []).filter(function(o){ return o.address && vinA.indexOf(o.address) >= 0; })[0];
            if (so) { b.forger = so.address; b.stake = true; }
            else if (!b.forger && t.vout && t.vout[0]) b.forger = t.vout[0].address;
          }
        });
        res.send({ page: page, per: per, total: total, pages: pages, data: heights.map(function(h){ return seen[h]; }).filter(Boolean) });
      });
  });
});

// The Deck — all 53 cards' current holder + movement summary, from one pass over
// every Deck-currency tx (vout.currency is a 3-char Dxx ticker). Used by the gallery.
// The Deck, from the daemon's card index.
//
// getcardinfo gives a card's full provenance -- holder, mint block, every
// transfer and the stake count -- and its shape is already exactly what
// /ext/getcard returned from Mongo, so that endpoint is a passthrough.
//
// The whole-deck views need all 53, which is 53 calls, so they share one
// cache. Cards change hands rarely; a stale entry for a few seconds is not
// worth 53 round trips per request.
var deck_cache = {at: 0, cards: null};

function load_deck(cb) {
  if (deck_cache.cards && (Date.now() - deck_cache.at) < 30000) {
    return cb(deck_cache.cards);
  }
  var tickers = currs.deck(), cards = {}, i = 0;
  (function next(){
    if (i >= tickers.length) {
      deck_cache = {at: Date.now(), cards: cards};
      return cb(cards);
    }
    var t = tickers[i];
    rpc.call('getcardinfo', {ticker: t}, function(info){
      if (info && typeof info === 'object' && info.ticker) cards[t] = info;
      i++; next();
    });
  })();
}

app.use('/ext/getdeck', function(req,res){
  load_deck(function(cards){
    var out = {};
    for (var t in cards) {
      if (!Object.prototype.hasOwnProperty.call(cards, t)) continue;
      var c = cards[t], xs = c.transfers || [];
      out[t] = {
        ticker: c.ticker,
        holder: c.holder,
        mintBlock: c.mintBlock,
        transfers: xs.length,
        lastBlock: xs.length ? xs[xs.length - 1].block : null
      };
    }
    res.send({ data: out });
  });
});

// one Deck card's full chain of custody (mint + every transfer, oldest first).
// [JAMES_HANDOFF change 2/3 — collapse coinstake self-rides] A card riding through a
// coinstake tx comes back to the same holder (from == to) — custody did not change, so
// those self-transfers are skipped (they're stakes, not transfers). getdeck below does
// the same so the gallery's transfer counts agree.
app.use('/ext/getcard/:ticker', function(req,res){
  var ticker = (req.params.ticker || '').toUpperCase();
  rpc.call('getcardinfo', {ticker: ticker}, function(info){
    if (!info || typeof info !== 'object' || !info.ticker) {
      return res.send({ ticker: ticker, holder: null, mintBlock: null,
                        transfers: [], stakes: 0 });
    }
    res.send(info);
  });
});

// recent Deck card movements (newest first), with real from (vin) / to (vout).
// Most recent card movements across the whole deck, newest first.
//
// Note this no longer carries the `fees` array. That came from the Mongo tx
// record; the card index does not track it, and nothing displays it --
// public/thedeck.html renders ticker, from, to, block and time only.
app.use('/ext/getcardtxs/:count', function(req,res){
  var count = Math.min(Math.max(parseInt(req.params.count, 10) || 10, 1), 100);
  load_deck(function(cards){
    var all = [];
    for (var t in cards) {
      if (!Object.prototype.hasOwnProperty.call(cards, t)) continue;
      (cards[t].transfers || []).forEach(function(x){
        all.push({ ticker: t, from: x.from, to: x.to, block: x.block,
                   txid: x.txid, timestamp: x.timestamp });
      });
    }
    // Newest first. Several cards can move in one block, and within a block
    // there is no meaningful order, so txid breaks the tie deterministically
    // rather than leaving it to iteration order.
    all.sort(function(a, b){
      if (b.block !== a.block) return b.block - a.block;
      if ((b.timestamp || 0) !== (a.timestamp || 0)) {
        return (b.timestamp || 0) - (a.timestamp || 0);
      }
      return a.txid < b.txid ? -1 : (a.txid > b.txid ? 1 : 0);
    });
    res.send({ data: all.slice(0, count) });
  });
});

// balance-bucket histogram for the main coin (settings.symbol).
app.use('/ext/getbalancedist', function(req,res){
  balance_buckets(currs.color(settings.symbol), function(data){
    res.send({ coin: settings.coin, data: data });
  });
});

// large transfers ("movement") — txs with a single output >= threshold, paged.
// filter = all | BRK | BRX | SIS (per-currency via elemMatch on vout).
app.use('/ext/getmovement/:filter/:page', function(req,res){
  var per = 12, page = Math.max(1, parseInt(req.params.page, 10) || 1);
  var f = (req.params.filter || 'all').toUpperCase();
  var TH = 100000 * settings.toshis; // 100k coins
  var query = (f === 'ALL' || f === '') ? { 'vout.amount': { $gte: TH } }
                                        : { vout: { $elemMatch: { currency: f, amount: { $gte: TH } } } };
  Tx.count(query, function(err, total){
    total = total || 0;
    Tx.find(query).sort({ _id: -1 }).skip((page - 1) * per).limit(per).exec(function(e2, txs){
      res.send({ page: page, per: per, total: total, pages: Math.max(1, Math.ceil(total / per)), threshold: TH, data: (txs || []) });
    });
  });
});

// locals
app.set('title', settings.title);
app.set('symbol', settings.symbol);
app.set('coin', settings.coin);
app.set('locale', locale);
app.set('display', settings.display);
app.set('markets', settings.markets);
app.set('twitter', settings.twitter);
app.set('genesis_block', settings.genesis_block);
app.set('index', settings.index);
app.set('heavy', settings.heavy);
app.set('txcount', settings.txcount);
app.set('nethash', settings.nethash);
app.set('nethash_units', settings.nethash_units);
app.set('show_sent_received', settings.show_sent_received);
app.set('logo', settings.logo);
app.set('theme', settings.theme);
app.set('labels', settings.labels);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
    app.use(function(err, req, res, next) {
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: err
        });
    });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
        message: err.message,
        error: {}
    });
});

module.exports = app;
