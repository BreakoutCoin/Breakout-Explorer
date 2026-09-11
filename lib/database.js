var mongoose = require('mongoose')
  , Stats = require('../models/stats')
  , Markets = require('../models/markets')
  , Tx = require('../models/tx')
  , Peers = require('../models/peers')
  , Heavy = require('../models/heavy')
  , lib = require('./explorer')
  , settings = require('./settings')
  , currs = require('./currencies')
  , poloniex = require('./markets/poloniex')
  , bittrex = require('./markets/bittrex')
  , bleutrade = require('./markets/bleutrade')
  , cryptsy = require('./markets/cryptsy')
  , cryptopia = require('./markets/cryptopia')
  , yobit = require('./markets/yobit')
  , empoex = require('./markets/empoex')
  , ccex = require('./markets/ccex');
//  , BTC38 = require('./markets/BTC38');

function find_tx(txid, cb) {
  Tx.findOne({txid: txid}, function(err, tx) {
    if(tx) {
      return cb(tx);
    } else {
      return cb(null);
    }
  });
}

function save_tx(txid, cb) {
  lib.get_rawtransaction(txid, function(tx) {
    if (tx == 'There was an error. Check your console.' || !tx || !tx.vout) {
      return cb('tx not found: ' + txid);
    }
    lib.get_block(tx.blockhash, function(block) {
      if (!block) return cb('block not found: ' + tx.blockhash);
      // Same assembly the /ext/gettx endpoint uses, so an indexed transaction
      // and a freshly read one cannot disagree.
      lib.assemble_tx(tx, block, function(doc) {
        var newTx = new Tx(doc);
        newTx.save(function(err) {
          return err ? cb(err) : cb();
        });
      });
    });
  });
}

function get_market_data(market, cb) {
  switch(market) {
    case 'bittrex':
      bittrex.get_data(settings.markets.coin, settings.markets.exchange, function(err, obj){
        return cb(err, obj);
      });
      break;
    case 'bleutrade':
      bleutrade.get_data(settings.markets.coin, settings.markets.exchange, function(err, obj){
        return cb(err, obj);
      });
      break;
    case 'poloniex':
      poloniex.get_data(settings.markets.coin, settings.markets.exchange, function(err, obj){
        return cb(err, obj);
      });
      break;
    case 'cryptsy':
      cryptsy.get_data(settings.markets.coin, settings.markets.exchange, settings.markets.cryptsy_id, function(err, obj){
        return cb(err, obj);
      });
      break;
    case 'cryptopia':
      cryptopia.get_data(settings.markets.coin, settings.markets.exchange, settings.markets.cryptopia_id, function (err, obj) {
        return cb(err, obj);
      });
      break;
    case 'ccex':
      ccex.get_data(settings.markets.coin.toLowerCase(), settings.markets.exchange.toLowerCase(), settings.markets.ccex_key, function (err, obj) {
        return cb(err, obj);
      });
      break;
    case 'yobit':
      yobit.get_data(settings.markets.coin.toLowerCase(), settings.markets.exchange.toLowerCase(), function(err, obj){
        return cb(err, obj);
      });
      break;
    case 'empoex':
      empoex.get_data(settings.markets.coin, settings.markets.exchange, function(err, obj){
        return cb(err, obj);
      });
      break;
    default:
      return cb(null);
  }
}

module.exports = {
  // initialize DB
  connect: function(database, cb) {
    mongoose.connect(database, {
      useNewUrlParser:    true,
      useUnifiedTopology: true,
    }, function(err) {
      if (err) {
        console.log('Unable to connect to database: %s', database);
        console.log('Error: %s', err.message);
        console.log('Aborting');
        process.exit(1);
      }
      //console.log('Successfully connected to MongoDB');
      return cb();
    });
  },

  check_stats: function(coin, cb) {
    Stats.findOne({coin: coin}, function(err, stats) {
      if(stats) {
        return cb(true);
      } else {
        return cb(false);
      }
    });
  },

  get_stats: function(coin, cb) {
    Stats.findOne({coin: coin}, function(err, stats) {
      if(stats) {
        return cb(stats);
      } else {
        return cb(null);
      }
    });
  },

  create_stats: function(coin, cb) {
    var newStats = new Stats({
      coin: coin,
    });

    newStats.save(function(err) {
      if (err) {
        console.log(err);
        return cb();
      } else {
        console.log("initial stats entry created for %s", coin);
        //console.log(newStats);
        return cb();
      }
    });
  },

  get_tx: function(txid, cb) {
    find_tx(txid, function(tx){
      return cb(tx);
    });
  },

  get_txs: function(block, cb) {
    var txs = [];
    lib.syncLoop(block.tx.length, function (loop) {
      var i = loop.iteration();
      find_tx(block.tx[i], function(tx){
        if (tx) {
          txs.push(tx);
          loop.next();
        } else {
          loop.next();
        }
      })
    }, function(){
      return cb(txs);
    });
  },

  create_txs: function(block, cb) {
    lib.syncLoop(block.tx.length, function (loop) {
      var i = loop.iteration();
      save_tx(block.tx[i], function(err){
        if (err) {
          loop.next();
        } else {
          //console.log('tx stored: %s', block.tx[i]);
          loop.next();
        }
      });
    }, function(){
      return cb();
    });
  },

  get_last_txs: function(count, min, cb) {
    Tx.find({'total': {$gt: min}}).sort({_id: 'desc'}).limit(count).exec(function(err, txs){
      if (err) {
        return cb(err);
      } else {
        return cb(txs);
      }
    });
  },

  create_market: function(coin, exchange, market, cb) {
    var newMarkets = new Markets({
      market: market,
      coin: coin,
      exchange: exchange,
    });

    newMarkets.save(function(err) {
      if (err) {
        console.log(err);
        return cb();
      } else {
        console.log("initial markets entry created for %s", market);
        //console.log(newMarkets);
        return cb();
      }
    });
  },

  // checks market data exists for given market
  check_market: function(market, cb) {
    Markets.findOne({market: market}, function(err, exists) {
      if(exists) {
        return cb(market, true);
      } else {
        return cb(market, false);
      }
    });
  },

  // gets market data for given market
  get_market: function(market, cb) {
    Markets.findOne({market: market}, function(err, data) {
      if(data) {
        return cb(data);
      } else {
        return cb(null);
      }
    });
  },

  // creates initial richlist entry in database; called on first launch of explorer
  // checks richlist data exists for given coin
  create_heavy: function(coin, cb) {
    var newHeavy = new Heavy({
      coin: coin,
    });
    newHeavy.save(function(err) {
      if (err) {
        console.log(err);
        return cb();
      } else {
        console.log("initial heavy entry created for %s", coin);
        console.log(newHeavy);
        return cb();
      }
    });
  },

  check_heavy: function(coin, cb) {
    Heavy.findOne({coin: coin}, function(err, exists) {
      if(exists) {
        return cb(true);
      } else {
        return cb(false);
      }
    });
  },

  get_heavy: function(coin, cb) {
    Heavy.findOne({coin: coin}, function(err, heavy) {
      if(heavy) {
        return cb(heavy);
      } else {
        return cb(null);
      }
    });
  },
  // updates heavy stats for coin
  // height: current block height, count: amount of votes to store
  update_heavy: function(coin, height, count, cb) {
    var newVotes = [];
    lib.get_maxmoney( function (maxmoney) {
      lib.get_maxvote( function (maxvote) {
        lib.get_vote( function (vote) {
          lib.get_phase( function (phase) {
            lib.get_reward( function (reward) {
              lib.get_supply( function (supply) {
                lib.get_estnext( function (estnext) {
                  lib.get_nextin( function (nextin) {
                    lib.syncLoop(count, function (loop) {
                      var i = loop.iteration();
                      lib.get_blockhash(height-i, function (hash) {
                        lib.get_block(hash, function (block) {
                          newVotes.push({count:height-i,reward:block.reward,vote:block.vote});
                          loop.next();
                        });
                      });
                    }, function(){
                      console.log(newVotes);
                      Heavy.update({coin: coin}, {
                        lvote: vote,
                        reward: reward,
                        supply: supply,
                        cap: maxmoney,
                        estnext: estnext,
                        phase: phase,
                        maxvote: maxvote,
                        nextin: nextin,
                        votes: newVotes,
                      }, function() {
                        //console.log('address updated: %s', hash);
                        return cb();
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  },

  // updates market data for given market; called by sync.js
  update_markets_db: function(market, cb) {
    get_market_data(market, function (err, obj) {
      if (err == null) {
        Markets.update({market:market}, {
          chartdata: JSON.stringify(obj.chartdata),
          buys: obj.buys,
          sells: obj.sells,
          history: obj.trades,
          summary: obj.stats,
        }, function() {
          if ( market == settings.markets.default ) {
            Stats.update({coin:settings.coin}, {
              last_price: obj.stats.last,
            }, function(){
              return cb(null);
            });
          } else {
            return cb(null);
          }
        });
      } else {
        return cb(err);
      }
    });
  },

  // updates stats data for given coin; called by sync.js
  update_db: function(coin, cb) {
    lib.get_blockcount( function (count) {
      if (!count){
        console.log('Unable to connect to explorer API');
        return cb(false);
      }
      lib.get_supply( function (supply){
        lib.get_connectioncount(function (connections) {
          Stats.update({coin: coin}, {
            coin: coin,
            count : count,
            supply: supply,
            connections: connections,
          }, function() {
            return cb(true);
          });
        });
      });
    });
  },

  // updates tx, address & richlist db's; called by sync.js
  update_tx_db: function(coin, start, end, timeout, cb) {
    var total = (end - start) + 1;

    // Fetch blockhash + block data for a given height
    function fetchBlock(height, done) {
      lib.get_blockhash(height, function(blockhash) {
        if (!blockhash) return done(null, null);
        lib.get_block(blockhash, function(block) {
          done(blockhash, block);
        });
      });
    }

    // Process the txs for one block, then call next() to advance.
    // nextData is either already populated (prefetch completed first) or
    // will be set by the prefetch callback (txs completed first); tryAdvance
    // ensures next() is called only once both sides are ready.
    function iterate(x, blockhash, block) {
      if (x >= total) {
        // All blocks done — write final stats and return
        Tx.find({}).sort({timestamp: 'desc'}).limit(settings.index.last_txs).exec(function(err, txs) {
          Stats.update({coin: coin}, {
            last: end,
            last_txs: '' //not used anymore left to clear out existing objects
          }, function() {
            return cb();
          });
        });
        return;
      }

      var height = start + x;

      // Periodic stats checkpoint
      if (x % 5000 === 0) {
        Stats.update({coin: coin}, {
          last: height - 1,
          last_txs: '' //not used anymore left to clear out existing objects
        }, function() {});
      }

      // Prefetch next block while this block's txs are being saved.
      // tryAdvance fires iterate(x+1) once BOTH sides (txs done + prefetch done) complete.
      var nextData = null;
      var txsDone = false;

      function tryAdvance() {
        if (!txsDone || nextData === null) return;
        // Clear stack every 100 blocks to avoid overflow
        if ((x + 1) % 100 === 0) {
          setTimeout(function() { iterate(x + 1, nextData.blockhash, nextData.block); }, 1);
        } else {
          iterate(x + 1, nextData.blockhash, nextData.block);
        }
      }

      if (x + 1 < total) {
        fetchBlock(height + 1, function(nextHash, nextBlock) {
          nextData = { blockhash: nextHash, block: nextBlock };
          tryAdvance();
        });
      } else {
        nextData = { blockhash: null, block: null }; // no next block needed
      }

      // Handle missing/invalid block
      if (!blockhash || !block || typeof block.tx === 'undefined' || typeof block.tx.length === 'undefined') {
        if (blockhash) console.log('block not found: %s', blockhash);
        txsDone = true;
        tryAdvance();
        return;
      }

      // One batch query to find which txids already exist in the DB,
      // then only call save_tx for the ones that are missing.
      Tx.find({txid: {$in: block.tx}}, 'txid', function(err, existing) {
        var existingSet = {};
        (existing || []).forEach(function(t) { existingSet[t.txid] = true; });
        var missing = block.tx.filter(function(id) { return !existingSet[id]; });

        lib.syncLoop(missing.length, function(subloop) {
          var i = subloop.iteration();
          save_tx(missing[i], function(err) {
            if (err) {
              console.log(err);
            } else {
              console.log('%s: %s', block.height, missing[i]);
            }
            setTimeout(function() { subloop.next(); }, timeout);
          });
        }, function() {
          txsDone = true;
          tryAdvance();
        });
      });
    }

    // Prime the pipeline by fetching the first block before the loop starts
    fetchBlock(start, function(firstHash, firstBlock) {
      iterate(0, firstHash, firstBlock);
    });
  },

  create_peer: function(params, cb) {
    var newPeer = new Peers(params);
    newPeer.save(function(err) {
      if (err) {
        console.log(err);
        return cb();
      } else {
        return cb();
      }
    });
  },

  find_peer: function(address, cb) {
    Peers.findOne({address: address}, function(err, peer) {
      if (err) {
        return cb(null);
      } else {
        if (peer) {
         return cb(peer);
       } else {
         return cb (null)
       }
      }
    })
  },

  get_peers: function(cb) {
    Peers.find({}, function(err, peers) {
      if (err) {
        return cb([]);
      } else {
        return cb(peers);
      }
    });
  }
};
