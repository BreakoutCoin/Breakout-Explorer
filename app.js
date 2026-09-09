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
  , Tx = require('./models/tx')
  , Address = require('./models/address')
  , AddressBalance = require('./models/addressbalance');

var app = express();

// bitcoinapi
bitcoinapi.setWalletDetails(settings.wallet);
if (settings.heavy != true) {
  bitcoinapi.setAccess('only', ['getinfo', 'getnetworkhashps', 'getmininginfo','getdifficulty', 'getconnectioncount',
    'getblockcount', 'getblockhash', 'getblock', 'getrawtransaction', 'getpeerinfo', 'gettxoutsetinfo']);
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
    'getnextrewardwhensec', 'getsupply', 'gettxoutsetinfo']);
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

app.use('/ext/getaddress/:hash', function(req,res){
  db.get_address(req.param('hash'), function(address){
    if (address) {
      var a_ext = {
        address: address.a_id,
        sent: (address.sent / settings.toshis),
        received: (address.received / settings.toshis),
        balance: (address.balance / settings.toshis).toString().replace(/(^-+)/mg, ''),
        last_txs: address.txs,
      };
      res.send(a_ext);
    } else {
      res.send({ error: 'address not found.', hash: req.param('hash')})
    }
  });
});

app.use('/ext/getbalance/:hash', function(req,res){
  db.get_address(req.param('hash'), function(address){
    if (address) {
      res.send((address.balance / settings.toshis).toString().replace(/(^-+)/mg, ''));
    } else {
      res.send({ error: 'address not found.', hash: req.param('hash')})
    }
  });
});

app.use('/ext/getdistribution', function(req,res){
  db.get_richlist(settings.coin, function(richlist){
    db.get_stats(settings.coin, function(stats){
      db.get_distribution(richlist, stats, function(dist){
        res.send(dist);
      });
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
  Tx.count({ 'vout.currency': coin }, function(err, txcount){
    // holders + supply come from the per-currency AddressBalance side-collection
    // (populated by a reindex). Absent that, they resolve to 0 and the UI shows —.
    db.get_holders(coin, 1, function(h){
      db.get_coin_supply(coin, function(supply){
        res.send({ coin: coin, txcount: (err ? 0 : (txcount || 0)), holders: (h && h.holders) || 0, supply: supply || 0 });
      });
    });
  });
});

// per-coin wealth distribution tiers, computed from AddressBalance (any currency).
// (distinct name from the legacy /ext/getdistribution so its prefix match can't shadow this)
app.use('/ext/getcoindist/:coin', function(req,res){
  var coin = (req.params.coin || '').toUpperCase(), T = settings.toshis;
  db.get_coin_supply(coin, function(supply){
    db.get_holders(coin, 100, function(h){
      var top = (h && h.top) || [];
      var tiers = { t_1_25:{p:0,t:0}, t_26_50:{p:0,t:0}, t_51_75:{p:0,t:0}, t_76_100:{p:0,t:0} };
      for (var i = 0; i < top.length; i++) {
        var bal = (top[i].balance || 0) / T, pct = supply > 0 ? (bal / supply * 100) : 0, n = i + 1;
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

// per-coin balance-bucket histogram, from AddressBalance (excludes synthetic rows).
app.use('/ext/getcoinbuckets/:coin', function(req,res){
  var coin = (req.params.coin || '').toUpperCase(), T = settings.toshis;
  var ranges = [['0 – 1',0,1*T], ['1 – 10',1*T,10*T], ['10 – 100',10*T,100*T],
                ['100 – 1k',100*T,1000*T], ['1k – 10k',1000*T,10000*T], ['10k +',10000*T,null]];
  var out = [], i = 0;
  (function next(){
    if (i >= ranges.length) return res.send({ coin: coin, data: out });
    var r = ranges[i];
    var q = { currency: coin, a_id: { $not: /^(coinbase-|burnt-|scavenged-)/ }, balance: { $gt: 0, $gte: r[1] } };
    if (r[2] != null) q.balance.$lt = r[2];
    AddressBalance.count(q, function(err, c){ out.push({ label: r[0], count: (err ? 0 : (c || 0)) }); i++; next(); });
  })();
});

// per-coin holder count + top holders (privacy: distribution use only; full list available for API consumers)
app.use('/ext/getholders/:coin', function(req,res){
  var coin = (req.params.coin || '').toUpperCase();
  db.get_holders(coin, 100, function(h){
    res.send({ coin: coin, holders: (h && h.holders) || 0,
      top: ((h && h.top) || []).map(function(a){ return { address: a.a_id, balance: a.balance / settings.toshis }; }) });
  });
});

// per-coin money supply (minted - burned), in coins
app.use('/ext/getsupply/:coin', function(req,res){
  var coin = (req.params.coin || '').toUpperCase();
  db.get_coin_supply(coin, function(supply){ res.send({ coin: coin, supply: supply || 0 }); });
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
app.use('/ext/getdeck', function(req,res){
  Tx.find({ 'vout.currency': /^D/ }).sort({ blockindex: 1, timestamp: 1 }).exec(function(err, txs){
    var cards = {};
    (txs || []).forEach(function(tx){
      (tx.vout || []).forEach(function(o){
        var c = o.currency;
        if (!c || c.length !== 3 || c.charAt(0) !== 'D' || !o.address) return;
        if (!cards[c]) cards[c] = { ticker: c, holder: null, mintBlock: null, transfers: 0, lastBlock: null };
        var card = cards[c];
        if (card.holder !== null && o.address === card.holder) return; // [JAMES_HANDOFF change 2/3] stake self-ride — card returned to same holder, not a transfer
        card.transfers++;
        card.holder = o.address;
        card.lastBlock = tx.blockindex;
        if (card.mintBlock === null) card.mintBlock = tx.blockindex;
      });
    });
    res.send({ data: cards });
  });
});

// one Deck card's full chain of custody (mint + every transfer, oldest first).
// [JAMES_HANDOFF change 2/3 — collapse coinstake self-rides] A card riding through a
// coinstake tx comes back to the same holder (from == to) — custody did not change, so
// those self-transfers are skipped (they're stakes, not transfers). getdeck below does
// the same so the gallery's transfer counts agree.
app.use('/ext/getcard/:ticker', function(req,res){
  var ticker = (req.params.ticker || '').toUpperCase();
  Tx.find({ 'vout.currency': ticker }).sort({ blockindex: 1, timestamp: 1 }).exec(function(err, txs){
    var transfers = [], holder = null, mintBlock = null, stakes = 0;
    (txs || []).forEach(function(tx){
      var from = null;
      (tx.vin || []).forEach(function(v){ if (v.currency === ticker && v.address) from = v.address; });
      (tx.vout || []).forEach(function(o){
        if (o.currency === ticker && o.address) {
          if (holder !== null && o.address === holder) { stakes++; return; } // stake — no change of hands
          transfers.push({ block: tx.blockindex, txid: tx.txid, to: o.address, from: (from || holder), mint: (holder === null), timestamp: tx.timestamp });
          holder = o.address;
          if (mintBlock === null) mintBlock = tx.blockindex;
        }
      });
    });
    res.send({ ticker: ticker, holder: holder, mintBlock: mintBlock, transfers: transfers, stakes: stakes });
  });
});

// recent Deck card movements (newest first), with real from (vin) / to (vout).
app.use('/ext/getcardtxs/:count', function(req,res){
  var count = Math.min(Math.max(parseInt(req.params.count, 10) || 10, 1), 100);
  Tx.find({ 'vout.currency': /^D/ }).sort({ _id: -1 }).limit(count * 2).exec(function(err, txs){
    var out = [];
    (txs || []).forEach(function(tx){
      (tx.vout || []).forEach(function(o){
        if (o.currency && o.currency.length === 3 && o.currency.charAt(0) === 'D' && o.address) {
          var from = null;
          (tx.vin || []).forEach(function(v){ if (v.currency === o.currency && v.address) from = v.address; });
          out.push({ ticker: o.currency, from: from, to: o.address, block: tx.blockindex, txid: tx.txid, timestamp: tx.timestamp, fees: tx.fees });
        }
      });
    });
    res.send({ data: out.slice(0, count) });
  });
});

// balance-bucket histogram — address counts per balance range (main coin).
// Balances are stored in toshis; ranges below are in coins * settings.toshis.
app.use('/ext/getbalancedist', function(req,res){
  var T = settings.toshis;
  var ranges = [['0 – 1', 0, 1*T], ['1 – 10', 1*T, 10*T], ['10 – 100', 10*T, 100*T],
                ['100 – 1k', 100*T, 1000*T], ['1k – 10k', 1000*T, 10000*T], ['10k +', 10000*T, null]];
  var out = [], i = 0;
  (function next(){
    if (i >= ranges.length) return res.send({ coin: settings.coin, data: out });
    var r = ranges[i], q = { balance: { $gte: r[1] } };
    if (r[2] != null) q.balance.$lt = r[2];
    Address.count(q, function(err, c){ out.push({ label: r[0], count: (err ? 0 : (c || 0)) }); i++; next(); });
  })();
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
