var express = require('express')
  , router = express.Router()
  , settings = require('../lib/settings')
  , locale = require('../lib/locale')
  , db = require('../lib/database')
  , lib = require('../lib/explorer')
  , rpc = require('../lib/rpc')
  , currs = require('../lib/currencies')
  , qr = require('qr-image');

function route_get_block(res, blockhash) {
  lib.get_block(blockhash, function (block) {
    if (block != 'There was an error. Check your console.') {
      if (blockhash == settings.genesis_block) {
        res.render('block', { active: 'block', block: block, confirmations: settings.confirmations, txs: 'GENESIS'});
      } else {
        db.get_txs(block, function(txs) {
          if (txs.length > 0) {
            res.render('block', { active: 'block', block: block, confirmations: settings.confirmations, txs: txs});
          } else {
            db.create_txs(block, function(){
              db.get_txs(block, function(ntxs) {
                if (ntxs.length > 0) {
                  res.render('block', { active: 'block', block: block, confirmations: settings.confirmations, txs: ntxs});
                } else {
                  route_get_index(res, 'Block not found: ' + blockhash);
                }
              });
            });
          }
        });
      }
    } else {
      route_get_index(res, 'Block not found: ' + blockhash);
    }
  });
}
/* GET functions */

function route_get_tx(res, txid) {
  if (txid == settings.genesis_tx) {
    route_get_block(res, settings.genesis_block);
  } else {
    db.get_tx(txid, function(tx) {
      if (tx) {
        lib.get_blockcount(function(blockcount) {
          res.render('tx', { active: 'tx', tx: tx, confirmations: settings.confirmations, blockcount: blockcount});
        });
      }
      else {
        lib.get_rawtransaction(txid, function(rtx) {
          if (rtx.txid) {
            lib.prepare_vin(rtx, function(vin) {
              lib.prepare_vout(rtx.vout, rtx.txid, vin, function(rvout, rvin) {
                lib.calculate_totals(rvout, rtx.flags, function(totals){
                  if (!rtx.confirmations > 0) {
                    var utx = {
                      txid: rtx.txid,
                      vin: rvin,
                      vout: rvout,
                      totals: totals,
                      timestamp: rtx.time,
                      blockhash: '-',
                      blockindex: -1,
                    };
                    res.render('tx', { active: 'tx', tx: utx, confirmations: settings.confirmations, blockcount:-1});
                  } else {
                    var utx = {
                      txid: rtx.txid,
                      vin: rvin,
                      vout: rvout,
                      totals: totals,
                      timestamp: rtx.time,
                      blockhash: rtx.blockhash,
                      blockindex: rtx.blockheight,
                    };
                    lib.get_blockcount(function(blockcount) {
                      res.render('tx', { active: 'tx', tx: utx, confirmations: settings.confirmations, blockcount: blockcount});
                    });
                  }
                });
              });
            });
          } else {
            route_get_index(res, null);
          }
        });
      }
    });
  }
}

function route_get_index(res, error) {
  res.render('index', { active: 'home', error: error, warning: null});
}

// The address page reads the daemon's Explore index, not Mongo.
//
// The view wants a document shaped like the old Address model -- a_id, sent,
// received and currency, with the amounts in toshis -- so getaddressinfo's
// coin-denominated floats are converted back. The transactions themselves are
// still read from the tx index, because that is where this explorer's
// currency-tagged vin/vout live; only the ADDRESS totals have moved.
//
// This also lifts the settings.txcount ceiling: getaddresstxspg pages the whole
// history rather than the last 100 the Address document happened to retain.
function to_toshis(coins) {
  // via the fixed-point string, not coins * 1e8, which rounds badly
  return parseInt(Number(coins).toFixed(8).replace('.', ''), 10);
}

function route_get_address(res, hash, count) {
  rpc.call('getaddressinfo', {address: hash}, function(info) {
    if (!info || typeof info !== 'object' || info.balance === undefined) {
      return route_get_index(res, hash + ' not found');
    }
    var address = {
      a_id: hash,
      sent: to_toshis(info.sent),
      received: to_toshis(info.received),
      balance: to_toshis(info.balance),
      currency: currs.ticker(info.color) || settings.symbol,
      txs: []
    };
    rpc.call('getaddresstxspg',
             {address: hash, page: 1, perpage: count, ordering: false},
             function(page) {
      var rows = (page && typeof page === 'object' && page.data) ? page.data : [];
      var txs = [];
      lib.syncLoop(rows.length, function (loop) {
        var i = loop.iteration();
        db.get_tx(rows[i].txid, function(tx) {
          if (tx) txs.push(tx);
          loop.next();
        });
      }, function(){
        res.render('address', { active: 'address', address: address, txs: txs});
      });
    });
  });
}

/* GET home page. */
router.get('/', function(req, res) {
  route_get_index(res, null);
});

router.get('/info', function(req, res) {
  res.render('info', { active: 'info', address: settings.address, hashes: settings.api });
});

router.get('/markets/:market', function(req, res) {
  var market = req.params['market'];
  if (settings.markets.enabled.indexOf(market) != -1) {
    db.get_market(market, function(data) {
      /*if (market === 'bittrex') {
        data = JSON.parse(data);
      }*/
      console.log(data);
      res.render('./markets/' + market, {
        active: 'markets',
        marketdata: {
          coin: settings.markets.coin,
          exchange: settings.markets.exchange,
          data: data,
        },
        market: market
      });
    });
  } else {
    route_get_index(res, null);
  }
});

router.get('/richlist', function(req, res) {
  if (settings.display.richlist != true) return route_get_index(res, null);

  // Rich list straight from the daemon.
  //
  // The "Received" tab is gone. It ranked addresses by lifetime total
  // received, which the Explore API does not offer and which needed the
  // Address collection kept solely to answer it. It is also of doubtful use:
  // an address that received and forwarded a large sum ranks above one that
  // still holds a smaller one.
  var color = currs.color(settings.symbol);
  lib.get_moneysupply(settings.symbol, function(supply) {
    supply = supply || 0;
    rpc.call('getrichlist', {color: color, start: 1, max: 100}, function(list) {
      if (!list || typeof list !== 'object') return route_get_index(res, null);

      // GetRichList returns everyone tied for last place, so max=100 can yield
      // more than 100; sort and trim rather than trusting the length.
      var balance = Object.keys(list).map(function(addr) {
        return { a_id: addr, balance: to_toshis(list[addr]) };
      });
      balance.sort(function(a, b){ return b.balance - a.balance; });
      balance = balance.slice(0, 100);

      var tiers = { t_1_25:{p:0,t:0}, t_26_50:{p:0,t:0},
                    t_51_75:{p:0,t:0}, t_76_100:{p:0,t:0} };
      balance.forEach(function(item, i) {
        var coins = item.balance / settings.toshis;
        var pct = supply > 0 ? (coins / supply * 100) : 0;
        var n = i + 1;
        var k = n<=25?'t_1_25':n<=50?'t_26_50':n<=75?'t_51_75':n<=100?'t_76_100':null;
        if (k) { tiers[k].p += pct; tiers[k].t += coins; }
      });
      var sumP = tiers.t_1_25.p + tiers.t_26_50.p + tiers.t_51_75.p + tiers.t_76_100.p;
      var sumT = tiers.t_1_25.t + tiers.t_26_50.t + tiers.t_51_75.t + tiers.t_76_100.t;
      var f = function(o){ return { percent: o.p.toFixed(2), total: o.t.toFixed(8) }; };

      res.render('richlist', {
        active: 'richlist',
        balance: balance,
        stats: { supply: supply },
        dista: f(tiers.t_1_25),
        distb: f(tiers.t_26_50),
        distc: f(tiers.t_51_75),
        distd: f(tiers.t_76_100),
        diste: { percent: Math.max(0, 100 - sumP).toFixed(2),
                 total: Math.max(0, supply - sumT).toFixed(8) },
        show_dist: settings.richlist.distribution,
        show_balance: settings.richlist.balance
      });
    });
  });
});

router.get('/movement', function(req, res) {
  res.render('movement', {active: 'movement', flaga: settings.movement.low_flag, flagb: settings.movement.high_flag, min_amount:settings.movement.min_amount});
});

router.get('/network', function(req, res) {
  res.render('network', {active: 'network'});
});

router.get('/reward', function(req, res){
  //db.get_stats(settings.coin, function (stats) {
    console.log(stats);
    db.get_heavy(settings.coin, function (heavy) {
      //heavy = heavy;
      var votes = heavy.votes;
      votes.sort(function (a,b) {
        if (a.count < b.count) {
          return -1;
        } else if (a.count > b.count) {
          return 1;
        } else {
         return 0;
        }
      });

      res.render('reward', { active: 'reward', stats: stats, heavy: heavy, votes: heavy.votes });
    });
  //});
});

router.get('/tx/:txid', function(req, res) {
  route_get_tx(res, req.param('txid'));
});

router.get('/block/:hash', function(req, res) {
  route_get_block(res, req.param('hash'));
});

router.get('/address/:hash', function(req, res) {
  route_get_address(res, req.param('hash'), settings.txcount);
});

router.get('/address/:hash/:count', function(req, res) {
  route_get_address(res, req.param('hash'), req.param('count'));
});

router.post('/search', function(req, res) {
  var query = req.body.search;
  if (query.length == 64) {
    if (query == settings.genesis_tx) {
      res.redirect('/block/' + settings.genesis_block);
    } else {
      db.get_tx(query, function(tx) {
        if (tx) {
          res.redirect('/tx/' +tx.txid);
        } else {
          lib.get_block(query, function(block) {
            if (block != 'There was an error. Check your console.') {
              res.redirect('/block/' + query);
            } else {
              route_get_index(res, locale.ex_search_error + query );
            }
          });
        }
      });
    }
  } else {
    // Search: does the query name an address the chain knows? Asking the
    // Explore index rather than Mongo also means an address with no indexed
    // transactions still resolves.
    rpc.call('getaddressinfo', {address: query}, function(info) {
      if (info && typeof info === 'object' && info.balance !== undefined) {
        res.redirect('/address/' + query);
      } else {
        lib.get_blockhash(query, function(hash) {
          if (hash != 'There was an error. Check your console.') {
            res.redirect('/block/' + hash);
          } else {
            route_get_index(res, locale.ex_search_error + query );
          }
        });
      }
    });
  }
});

router.get('/qr/:string', function(req, res) {
  if (req.param('string')) {
    var address = qr.image(req.param('string'), {
      type: 'png',
      size: 4,
      margin: 1,
      ec_level: 'M'
    });
    res.type('png');
    address.pipe(res);
  }
});

router.get('/ext/summary', function(req, res) {
  lib.get_difficulty(function(difficulty) {
    difficultyHybrid = ''
    if (difficulty['proof-of-work']) {
            if (settings.index.difficulty == 'Hybrid') {
              difficultyHybrid = 'POS: ' + difficulty['proof-of-stake'];
              difficulty = 'POW: ' + difficulty['proof-of-work'];
            } else if (settings.index.difficulty == 'POW') {
              difficulty = difficulty['proof-of-work'];
            } else {
        difficulty = difficulty['proof-of-stake'];
      }
    }
    lib.get_hashrate(function(hashrate) {
      lib.get_connectioncount(function(connections){
        lib.get_blockcount(function(blockcount) {
          db.get_stats(settings.coin, function (stats) {
            if (hashrate == 'There was an error. Check your console.') {
              hashrate = 0;
            }
            res.send({ data: [{
              difficulty: difficulty,
              difficultyHybrid: difficultyHybrid,
              supply: stats.supply,
              hashrate: hashrate,
              lastPrice: stats.last_price,
              connections: connections,
              blockcount: blockcount
            }]});
          });
        });
      });
    });
  });
});
module.exports = router;
