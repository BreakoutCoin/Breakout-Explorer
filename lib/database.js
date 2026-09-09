var mongoose = require('mongoose')
  , Stats = require('../models/stats')
  , Markets = require('../models/markets')
  , Address = require('../models/address')
  , AddressBalance = require('../models/addressbalance')
  , Tx = require('../models/tx')
  , Richlist = require('../models/richlist')
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

function find_address(hash, cb) {
  Address.findOne({a_id: hash}, function(err, address) {
    if(address) {
      return cb(address);
    } else {
      return cb();
    }
  });
}

function find_richlist(coin, cb) {
  Richlist.findOne({coin: coin}, function(err, richlist) {
    if(richlist) {
      return cb(richlist);
    } else {
      return cb();
    }
  });
}

function update_address(hash, txid, amount, txtype, type, cb) {
  // Check if address exists
  find_address(hash, function(address) {
    if (address) {
      // if coinbase (new coins), burn (destroyed coins), or
      //   scavenged (recovered fees), update sent only and return cb.
      // note that money supply can be calculated downstream as:
      //   coinbase.sent - burnt.sent
      if ( hash.startsWith('coinbase-') ||
           hash.startsWith('burnt-') ||
           hash.startsWith('scavenged-') ) {
        Address.update({a_id:hash}, {
          sent: address.sent + amount,
                      balance: 0,
        }, function() {
          return cb();
        });
      } else {
        // ensure tx doesnt already exist in address.txs
        lib.is_unique(address.txs, txid, function(unique, index) {
          var tx_array = address.txs;
          var received = address.received;
          var sent = address.sent;
          // coinstake is technically a send, but has an age component
          //    that renders nonsensical the tracking of the amount staked
          //    without accounting for the coin age
          if (txtype != 'coinstake') {
            if (type == 'vin') {
              sent = sent + amount;
            } else {
              received = received + amount;
            }
          }
          if (unique == true) {
            tx_array.push({addresses: txid, type: type});
            if ( tx_array.length > settings.txcount ) {
              tx_array.shift();
            }
            Address.update({a_id:hash}, {
              txs: tx_array,
              received: received,
              sent: sent,
              balance: received - sent
            }, function() {
              return cb();
            });
          } else {
            if (type == tx_array[index].type) {
              return cb(); //duplicate
            } else {
              Address.update({a_id:hash}, {
                txs: tx_array,
                received: received,
                sent: sent,
                balance: received - sent
              }, function() {
                return cb();
              });
            }
          }
        });
      }
    } else {
      //new address
      if (type == 'vin') {
        var newAddress = new Address({
          a_id: hash,
          txs: [ {addresses: txid, type: 'vin'} ],
          sent: amount,
          balance: amount,
        });
      } else {
        var newAddress = new Address({
          a_id: hash,
          txs: [ {addresses: txid, type: 'vout'} ],
          received: amount,
          balance: amount,
        });
      }

      newAddress.save(function(err) {
        if (err) {
          return cb(err);
        } else {
          //console.log('address saved: %s', hash);
          //console.log(newAddress);
          return cb();
        }
      });
    }
  });
}

// Per-(address, currency) balance updater. Mirrors update_address's semantics but
// keyed on {a_id, currency} and writes ONLY to the additive AddressBalance
// collection (no txs[] array). update_address above is left completely untouched.
function update_address_balance(hash, currency, txid, amount, txtype, type, cb) {
  if (!currency) return cb(); // defensive: skip a malformed vin/vout with no currency
  var synthetic = ( hash.startsWith('coinbase-') ||
                    hash.startsWith('burnt-') ||
                    hash.startsWith('scavenged-') );
  AddressBalance.findOne({ a_id: hash, currency: currency }, function(err, ab) {
    if (ab) {
      if (synthetic) {
        // supply accounting: accumulate sent only, balance forced 0
        AddressBalance.update({ a_id: hash, currency: currency }, {
          sent: ab.sent + amount, balance: 0
        }, function() { return cb(); });
      } else {
        var received = ab.received, sent = ab.sent;
        if (txtype != 'coinstake') {
          if (type == 'vin') { sent = sent + amount; } else { received = received + amount; }
        }
        AddressBalance.update({ a_id: hash, currency: currency }, {
          received: received, sent: sent, balance: received - sent
        }, function() { return cb(); });
      }
    } else {
      var doc;
      if (synthetic) {
        doc = { a_id: hash, currency: currency, received: 0, sent: amount, balance: 0 };
      } else if (txtype == 'coinstake') {
        doc = { a_id: hash, currency: currency, received: 0, sent: 0, balance: 0 };
      } else if (type == 'vin') {
        // balance = received - sent = -amount (the legacy Address path's +amount here is a sign bug we do NOT replicate)
        doc = { a_id: hash, currency: currency, received: 0, sent: amount, balance: -amount };
      } else {
        doc = { a_id: hash, currency: currency, received: amount, sent: 0, balance: amount };
      }
      new AddressBalance(doc).save(function(err2) {
        if (err2) return cb(err2);
        return cb();
      });
    }
  });
}

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
    if (tx != 'There was an error. Check your console.') {
      lib.get_block(tx.blockhash, function(block) {
        if (block) {
          lib.prepare_vin(tx, function(vin) {
            lib.prepare_vout(tx.vout, txid, vin, function(vout, nvin) {
              var txtype = tx.flags;

              // Compute fees from nvin synchronously (nvin addresses are deduplicated)
              // - fee = inputs - outputs (coinbase virtual inputs excluded)
              // - fees for coinstake = 0 (protocol enforces inputs == outputs)
              // - fees for coinbase = negated sum of coinbase + scavenged fees
              // - burnt coins are not fees: inputs=25, burnt=24 => fees=1
              var fees = {};
              if (tx.flags != 'coinbase') {
                nvin.forEach(function(v) {
                  fees[v.currency] = (fees[v.currency] || 0) + v.amount;
                });
              }

              // Compute burnt and subtract vout amounts from fees synchronously
              var burnt = {};
              vout.forEach(function(v) {
                if (!v.address) return;
                if (v.address.startsWith("burnt-")) {
                  burnt[v.currency] = (burnt[v.currency] || 0) + v.amount;
                }
                fees[v.currency] = (fees[v.currency] || 0) - v.amount;
              });

              // Save tx record after both vin and vout address updates complete
              function saveTxRecord() {
                lib.calculate_totals(vout, tx.flags, function(totals_out) {
                  var tx_total = 0;
                  for (var ti = 0; ti < vout.length; ti++) {
                    if (vout[ti].currency == settings.symbol) tx_total += vout[ti].amount;
                  }
                  var newTx = new Tx({
                    txid: tx.txid,
                    vin: nvin,
                    vout: vout,
                    fees: currs.sorted(fees),
                    burnt: currs.sorted(burnt),
                    totals: totals_out,
                    total: tx_total,
                    timestamp: tx.time,
                    blockhash: tx.blockhash,
                    blockindex: block.height,
                  });
                  newTx.save(function(err) {
                    return err ? cb(err) : cb();
                  });
                });
              }

              // Run all vout address updates in parallel (vout addresses are deduplicated)
              function updateVoutAddresses() {
                var voutAddrs = vout.filter(function(v) { return v.address; });
                if (voutAddrs.length === 0) return saveTxRecord();
                var remaining = voutAddrs.length;
                voutAddrs.forEach(function(v) {
                  update_address(v.address, txid, v.amount, txtype, 'vout', function() {
                    update_address_balance(v.address, v.currency, txid, v.amount, txtype, 'vout', function() {
                      if (--remaining === 0) saveTxRecord();
                    });
                  });
                });
              }

              // Run all vin address updates in parallel (nvin addresses are deduplicated),
              // then proceed to vout. Vin must complete before vout to correctly handle
              // addresses that appear in both (e.g. change outputs).
              if (nvin.length === 0) return updateVoutAddresses();
              var vinRemaining = nvin.length;
              nvin.forEach(function(v) {
                update_address(v.address, txid, v.amount, txtype, 'vin', function() {
                  update_address_balance(v.address, v.currency, txid, v.amount, txtype, 'vin', function() {
                    if (--vinRemaining === 0) updateVoutAddresses();
                  });
                });
              });
            });
          });
        } else {
          return cb('block not found: ' + tx.blockhash);
        }
      });
    } else {
      return cb('tx not found: ' + txid);
    }
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

  get_address: function(hash, cb) {
    find_address(hash, function(address){
      return cb(address);
    });
  },

  // per-coin holders (count + top list) from the additive AddressBalance collection
  get_holders: function(coin, limit, cb) {
    var q = { currency: coin, balance: { $gt: 0 }, a_id: { $not: /^(coinbase-|burnt-|scavenged-)/ } };
    AddressBalance.count(q, function(err, count) {
      AddressBalance.find(q).sort({ balance: -1 }).limit(limit || 100).exec(function(err2, list) {
        return cb({ holders: (err ? 0 : (count || 0)), top: (list || []) });
      });
    });
  },

  // per-coin money supply = minted (coinbase) - burned, in coins
  get_coin_supply: function(coin, cb) {
    AddressBalance.findOne({ a_id: 'coinbase-' + coin, currency: coin }, function(err, cbrow) {
      AddressBalance.findOne({ a_id: 'burnt-' + coin, currency: coin }, function(err2, brow) {
        var minted = cbrow ? (cbrow.sent - cbrow.received) : 0;
        var burned = brow ? brow.sent : 0;
        return cb((minted - burned) / settings.toshis);
      });
    });
  },

  get_richlist: function(coin, cb) {
    find_richlist(coin, function(richlist){
      return cb(richlist);
    });
  },
  //property: 'received' or 'balance'
  update_richlist: function(list, cb){
    if(list == 'received') {
      Address.find({}).sort({received: 'desc'}).limit(100).exec(function(err, addresses){
        Richlist.update({coin: settings.coin}, {
          received: addresses,
        }, function() {
          return cb();
        });
      });
    } else { //balance
      Address.find({}).sort({balance: 'desc'}).limit(100).exec(function(err, addresses){
        Richlist.update({coin: settings.coin}, {
          balance: addresses,
        }, function() {
          return cb();
        });
      });
    }
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

  create_tx: function(txid, cb) {
    save_tx(txid, function(err){
      if (err) {
        return cb(err);
      } else {
        //console.log('tx stored: %s', txid);
        return cb();
      }
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
  create_richlist: function(coin, cb) {
    var newRichlist = new Richlist({
      coin: coin,
    });
    newRichlist.save(function(err) {
      if (err) {
        console.log(err);
        return cb();
      } else {
        console.log("initial richlist entry created for %s", coin);
        //console.log(newRichlist);
        return cb();
      }
    });
  },
  // checks richlist data exists for given coin
  check_richlist: function(coin, cb) {
    Richlist.findOne({coin: coin}, function(err, exists) {
      if(exists) {
        return cb(true);
      } else {
        return cb(false);
      }
    });
  },

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
  get_distribution: function(richlist, stats, cb){
    var distribution = {
      supply: stats.supply,
      t_1_25: {percent: 0, total: 0 },
      t_26_50: {percent: 0, total: 0 },
      t_51_75: {percent: 0, total: 0 },
      t_76_100: {percent: 0, total: 0 },
      t_101plus: {percent: 0, total: 0 }
    };
    lib.syncLoop(richlist.balance.length, function (loop) {
      var i = loop.iteration();
      var count = i + 1;
      var percentage = ((richlist.balance[i].balance / settings.toshis) / stats.supply) * 100;
      if (count <= 25 ) {
        distribution.t_1_25.percent = distribution.t_1_25.percent + percentage;
        distribution.t_1_25.total = distribution.t_1_25.total + (richlist.balance[i].balance / settings.toshis);
      }
      if (count <= 50 && count > 25) {
        distribution.t_26_50.percent = distribution.t_26_50.percent + percentage;
        distribution.t_26_50.total = distribution.t_26_50.total + (richlist.balance[i].balance / settings.toshis);
      }
      if (count <= 75 && count > 50) {
        distribution.t_51_75.percent = distribution.t_51_75.percent + percentage;
        distribution.t_51_75.total = distribution.t_51_75.total + (richlist.balance[i].balance / settings.toshis);
      }
      if (count <= 100 && count > 75) {
        distribution.t_76_100.percent = distribution.t_76_100.percent + percentage;
        distribution.t_76_100.total = distribution.t_76_100.total + (richlist.balance[i].balance / settings.toshis);
      }
      loop.next();
    }, function(){
      distribution.t_101plus.percent = parseFloat(100 - distribution.t_76_100.percent - distribution.t_51_75.percent - distribution.t_26_50.percent - distribution.t_1_25.percent).toFixed(2);
      distribution.t_101plus.total = parseFloat(distribution.supply - distribution.t_76_100.total - distribution.t_51_75.total - distribution.t_26_50.total - distribution.t_1_25.total).toFixed(8);
      distribution.t_1_25.percent = parseFloat(distribution.t_1_25.percent).toFixed(2);
      distribution.t_1_25.total = parseFloat(distribution.t_1_25.total).toFixed(8);
      distribution.t_26_50.percent = parseFloat(distribution.t_26_50.percent).toFixed(2);
      distribution.t_26_50.total = parseFloat(distribution.t_26_50.total).toFixed(8);
      distribution.t_51_75.percent = parseFloat(distribution.t_51_75.percent).toFixed(2);
      distribution.t_51_75.total = parseFloat(distribution.t_51_75.total).toFixed(8);
      distribution.t_76_100.percent = parseFloat(distribution.t_76_100.percent).toFixed(2);
      distribution.t_76_100.total = parseFloat(distribution.t_76_100.total).toFixed(8);
      return cb(distribution);
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
