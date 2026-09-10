var rpc = require('./rpc')
  , settings = require('./settings')
  , currs = require('./currencies')
  , Address = require('../models/address');

// Calls go straight to the wallet over JSON-RPC (lib/rpc.js). They used to be
// HTTP requests back into this same process's /api/ passthrough, which meant
// the web cluster had to be running for the indexer to work at all.


// last seen tip moneysupply map, refreshed at most every 15s (see get_moneysupply)
var supply_cache = {map: null, at: 0, height: 0};

// returns coinbase total sent as current coin supply
function coinbase_supply(currency, cb) {
  Address.findOne({a_id: ('coinbase-' + currency)}, function(err, address) {
    if (address) {
      return cb(address.sent - address.received);
    } else {
      return cb();
    }
  });
}

module.exports = {

  convert_to_satoshi: function(amount, cb) {
    // fix to 8dp & convert to string
    var fixed = amount.toFixed(8).toString(); 
    // remove decimal (.) and return integer 
    return cb(parseInt(fixed.replace('.', '')));
  },

  get_hashrate: function(cb) {
    if (settings.index.show_hashrate == false) return cb('-');
    if (settings.nethash == 'netmhashps') {
      rpc.call('getmininginfo', function (body) { //returned in mhash
        if (body.netmhashps) {
          if (settings.nethash_units == 'K') {
            return cb((body.netmhashps * 1000).toFixed(4));
          } else if (settings.nethash_units == 'G') {
            return cb((body.netmhashps / 1000).toFixed(4));
          } else if (settings.nethash_units == 'H') {
            return cb((body.netmhashps * 1000000).toFixed(4));
          } else if (settings.nethash_units == 'T') {
            return cb((body.netmhashps / 1000000).toFixed(4));
          } else if (settings.nethash_units == 'P') {
            return cb((body.netmhashps / 1000000000).toFixed(4));
          } else {
            return cb(body.netmhashps.toFixed(4));
          }
        } else {
          return cb('-');
        }
      });
    } else {
      rpc.call('getnetworkhashps', function (body) {
        if (body == 'There was an error. Check your console.') {
          return cb('-');
        } else {
          if (settings.nethash_units == 'K') {
            return cb((body / 1000).toFixed(4));
          } else if (settings.nethash_units == 'M'){
            return cb((body / 1000000).toFixed(4));
          } else if (settings.nethash_units == 'G') {
            return cb((body / 1000000000).toFixed(4));
          } else if (settings.nethash_units == 'T') {
            return cb((body / 1000000000000).toFixed(4));
          } else if (settings.nethash_units == 'P') {
            return cb((body / 1000000000000000).toFixed(4));
          } else {
            return cb((body).toFixed(4));
          }
        }
      });
    }
  },


  get_difficulty: function(cb) {
    rpc.call('getdifficulty', function (body) {
      return cb(body);
    });
  },

  get_connectioncount: function(cb) {
    rpc.call('getconnectioncount', function (body) {
      return cb(body);
    });
  },

  get_blockcount: function(cb) {
    rpc.call('getblockcount', function (body) {
      return cb(body);
    });
  },

  get_blockhash: function(height, cb) {
    rpc.call('getblockhash', {height: height}, function (body) {
      return cb(body);
    });
  },

  get_block: function(hash, cb) {
    rpc.call('getblock', {hash: hash}, function (body) {
      return cb(body);
    });
  },

  get_rawtransaction: function(hash, cb) {
    rpc.call('getrawtransaction', {txid: hash, decrypt: 1}, function (body) {
      return cb(body);
    });
  },

  get_maxmoney: function(cb) {
    rpc.call('getmaxmoney', function (body) {
      return cb(body);
    });
  },

  get_maxvote: function(cb) {
    rpc.call('getmaxvote', function (body) {
      return cb(body);
    });
  },

  get_vote: function(cb) {
    rpc.call('getvote', function (body) {
      return cb(body);
    });
  },

  get_phase: function(cb) {
    rpc.call('getphase', function (body) {
      return cb(body);
    });
  },

  get_reward: function(cb) {
    rpc.call('getreward', function (body) {
      return cb(body);
    });
  },

  get_estnext: function(cb) {
    rpc.call('getnextrewardestimate', function (body) {
      return cb(body);
    });
  },

  get_nextin: function(cb) {
    rpc.call('getnextrewardwhenstr', function (body) {
      return cb(body);
    });
  },
  
  // synchonous loop used to interate through an array, 
  // avoid use unless absolutely neccessary
  syncLoop: function(iterations, process, exit){
    var index = 0,
        done = false,
        shouldExit = false;
    var loop = {
      next:function(){
          if(done){
              if(shouldExit && exit){
                  exit(); // Exit if we're done
              }
              return; // Stop the loop if we're done
          }
          // If we're not finished
          if(index < iterations){
              index++; // Increment our index
              if (index % 100 === 0) { //clear stack
                setTimeout(function() {
                  process(loop); // Run our process, pass in the loop
                }, 1);
              } else {
                 process(loop); // Run our process, pass in the loop
              }
          // Otherwise we're done
          } else {
              done = true; // Make sure we say we're done
              if(exit) exit(); // Call the callback on exit
          }
      },
      iteration:function(){
          return index - 1; // Return the loop number we're on
      },
      break:function(end){
          done = true; // End the loop
          shouldExit = end; // Passing end as true means we still call the exit callback
      }
    };
    loop.next();
    return loop;
  },

  balance_supply: function(cb) {
    Address.find({}, 'balance').where('balance').gt(0).exec(function(err, docs) {
      var count = docs.reduce(function(sum, doc) { return sum + doc.balance; }, 0);
      return cb(count);
    });
  },

  get_supply: function(cb) {
    if ( settings.supply == 'HEAVY' ) {
      rpc.call('getsupply', function (body) {
        return cb(body);
      });
    } else if (settings.supply == 'GETINFO') {
      rpc.call('getinfo', function (body) {
        return cb(body.moneysupply);
      });
    } else if (settings.supply == 'BALANCES') {
      module.exports.balance_supply(function(supply) {
        return cb(supply/settings.toshis);
      });
    } else if (settings.supply == 'TXOUTSET') {
      rpc.call('gettxoutsetinfo', function (body) {
        return cb(body.total_amount);
      });
    } else {
      coinbase_supply("brk", function(supply) {
        return cb(supply/settings.toshis);
      });
    }
  },

  // Per-currency money supply, straight from the block index.
  //
  // The tip block carries a moneysupply map keyed by ticker -- totalmint less
  // whatever the burn protocol has destroyed -- so this is the chain's own
  // figure rather than one the explorer accumulates and can drift from. It
  // moves at most once per block, so a short cache keeps a page that asks for
  // several currencies down to a single call.
  get_moneysupply: function(ticker, cb) {
    var now = Date.now();
    if (supply_cache.map && (now - supply_cache.at) < 15000) {
      return cb(supply_cache.map[ticker]);
    }
    rpc.call('getbestblock', function(block) {
      if (!block || typeof block !== 'object' || !block.moneysupply) {
        // keep serving the last good map rather than reporting zero supply
        return cb(supply_cache.map ? supply_cache.map[ticker] : undefined);
      }
      supply_cache = {map: block.moneysupply, at: now, height: block.height};
      return cb(supply_cache.map[ticker]);
    });
  },

  is_unique: function(array, object, cb) {
    var index = array.findIndex(function(item) { return item.addresses === object; });
    return cb(index === -1, index === -1 ? null : index);
  },

  calculate_totals: function(vout, flags, cb) {
    // coinstake shouldn't count as money flow volume
    if (flags == "coinstake") return cb([]);
    var totals = {};
    for (var i = 0; i < vout.length; i++) {
      totals[vout[i].currency] = (totals[vout[i].currency] || 0) + vout[i].amount;
    }
    for (var currency in totals) {
      totals[currency] = totals[currency].toFixed(8);
    }
    return cb(currs.sorted(totals));
  },

  prepare_vout: function(vout, txid, vin, cb) {
    var arr_vout = [];
    var addressIndex = {}; // address -> index in arr_vout, for O(1) dedup
    for (var i = 0; i < vout.length; i++) {
      if (vout[i].scriptPubKey.type === 'nonstandard') continue;
      var address;
      if (vout[i].scriptPubKey.type === 'nulldata') {
        if (vout[i].flags === 'burn') {
          address = 'burnt-' + vout[i].currency;
        } else {
          continue; // nulldata non-burn: skip
        }
      } else {
        address = vout[i].scriptPubKey.addresses[0];
      }
      var amount_sat = parseInt(parseFloat(vout[i].value).toFixed(8).replace('.', ''));
      if (address in addressIndex) {
        arr_vout[addressIndex[address]].amount += amount_sat;
      } else {
        addressIndex[address] = arr_vout.length;
        arr_vout.push({n: i, address: address, amount: amount_sat, currency: vout[i].currency});
      }
    }
    return cb(arr_vout, vin);
  },

  get_input_addresses: function(input, vout, cb) {
    var addresses = [];
    if (input.coinbase) {
      var amounts = {};
      vout.forEach(function(v, i) {
        amounts[v.currency] = (amounts[v.currency] || 0) + parseFloat(v.value);
        addresses.push({
          hash: (i === 0) ? ('coinbase-' + v.currency) : ('scavenged-' + v.currency),
          amount: amounts[v.currency],
          currency: v.currency
        });
      });
      return cb(addresses);
    } else {
      module.exports.get_rawtransaction(input.txid, function(tx) {
        if (tx) {
          var matching = tx.vout.find(function(o) { return o.n == input.vout; });
          if (matching && matching.scriptPubKey.addresses) {
            addresses.push({hash: matching.scriptPubKey.addresses[0],
                            amount: matching.value,
                            currency: matching.currency});
          }
          return cb(addresses);
        } else {
          return cb();
        }
      });
    }
  },

  prepare_vin: function(tx, cb) {
    var arr_vin = [];
    if (tx.vin.length === 0) return cb(arr_vin);

    var remaining = tx.vin.length;
    var addressResults = new Array(tx.vin.length);

    // Fire all get_input_addresses calls in parallel (each makes an HTTP request
    // for non-coinbase inputs; coinbase returns synchronously)
    tx.vin.forEach(function(input, i) {
      module.exports.get_input_addresses(input, tx.vout, function(addresses) {
        addressResults[i] = { addresses: addresses, isCoinbase: !!input.coinbase, index: i };
        if (--remaining === 0) {
          // All results in; deduplicate using a hash map for O(1) lookups.
          // Note: is_unique checks the .addresses field (used for tx history arrays),
          // not .address, so it cannot be used here — we track by address string directly.
          var vinIndex = {}; // address -> index in arr_vin
          addressResults.forEach(function(result) {
            if (!result.addresses) return;
            var addrs = result.isCoinbase ? result.addresses : result.addresses.slice(0, 1);
            addrs.forEach(function(addr) {
              var amount_sat = parseInt(parseFloat(addr.amount).toFixed(8).replace('.', ''));
              if (addr.hash in vinIndex) {
                arr_vin[vinIndex[addr.hash]].amount += amount_sat;
              } else {
                vinIndex[addr.hash] = arr_vin.length;
                arr_vin.push({ n: result.index, address: addr.hash,
                               amount: amount_sat, currency: addr.currency });
              }
            });
          });
          return cb(arr_vin);
        }
      });
    });
  }
};
