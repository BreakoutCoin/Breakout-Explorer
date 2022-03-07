var request = require('request')
  , settings = require('./settings')
  , Address = require('../models/address');

var base_url = 'http://127.0.0.1:' + settings.port + '/api/';


// returns coinbase total sent as current coin supply
function coinbase_supply(currency, cb) {
  Address.findOne({a_id: ('coinbase-' + currency)}, function(err, address) {
    if (address) {
asdfjkl;
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
      var uri = base_url + 'getmininginfo';
      request({uri: uri, json: true}, function (error, response, body) { //returned in mhash
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
      var uri = base_url + 'getnetworkhashps';
      request({uri: uri, json: true}, function (error, response, body) {
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
    var uri = base_url + 'getdifficulty';
    request({uri: uri, json: true}, function (error, response, body) {
      return cb(body);
    });
  },

  get_connectioncount: function(cb) {
    var uri = base_url + 'getconnectioncount';
    request({uri: uri, json: true}, function (error, response, body) {
      return cb(body);
    });
  },

  get_blockcount: function(cb) {
    var uri = base_url + 'getblockcount';
    request({uri: uri, json: true}, function (error, response, body) {
      return cb(body);
    });
  },

  get_blockhash: function(height, cb) {
    var uri = base_url + 'getblockhash?height=' + height;
    request({uri: uri, json: true}, function (error, response, body) {
      return cb(body);
    });
  },

  get_block: function(hash, cb) {
    var uri = base_url + 'getblock?hash=' + hash;
    request({uri: uri, json: true}, function (error, response, body) {
      return cb(body);
    });
  },

  get_rawtransaction: function(hash, cb) {
    var uri = base_url + 'getrawtransaction?txid=' + hash + '&decrypt=1';
    request({uri: uri, json: true}, function (error, response, body) {
      return cb(body);
    });
  },

  get_maxmoney: function(cb) {
    var uri = base_url + 'getmaxmoney';
    request({uri: uri, json: true}, function (error, response, body) {
      return cb(body);
    });
  },

  get_maxvote: function(cb) {
    var uri = base_url + 'getmaxvote';
    request({uri: uri, json: true}, function (error, response, body) {
      return cb(body);
    });
  },

  get_vote: function(cb) {
    var uri = base_url + 'getvote';
    request({uri: uri, json: true}, function (error, response, body) {
      return cb(body);
    });
  },

  get_phase: function(cb) {
    var uri = base_url + 'getphase';
    request({uri: uri, json: true}, function (error, response, body) {
      return cb(body);
    });
  },

  get_reward: function(cb) {
    var uri = base_url + 'getreward';
    request({uri: uri, json: true}, function (error, response, body) {
      return cb(body);
    });
  },

  get_estnext: function(cb) {
    var uri = base_url + 'getnextrewardestimate';
    request({uri: uri, json: true}, function (error, response, body) {
      return cb(body);
    });
  },

  get_nextin: function(cb) {
    var uri = base_url + 'getnextrewardwhenstr';
    request({uri: uri, json: true}, function (error, response, body) {
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
      var count = 0;
      module.exports.syncLoop(docs.length, function (loop) {
        var i = loop.iteration();
        count = count + docs[i].balance;
        loop.next();
      }, function(){
        return cb(count);
      });
    });
  },

  get_supply: function(cb) {
    if ( settings.supply == 'HEAVY' ) {
      var uri = base_url + 'getsupply';
      request({uri: uri, json: true}, function (error, response, body) {
        return cb(body);
      });
    } else if (settings.supply == 'GETINFO') {
      var uri = base_url + 'getinfo';
      request({uri: uri, json: true}, function (error, response, body) {
        return cb(body.moneysupply);
      });
    } else if (settings.supply == 'BALANCES') {
      module.exports.balance_supply(function(supply) {
        return cb(supply/settings.toshis);
      });
    } else if (settings.supply == 'TXOUTSET') {
      var uri = base_url + 'gettxoutsetinfo';
      request({uri: uri, json: true}, function (error, response, body) {
        return cb(body.total_amount);
      });
    } else {
      coinbase_supply(function("brk", supply) {
        return cb(supply/settings.toshis);
      });
    }
  },

  is_unique: function(array, object, cb) {
    var unique = true;
    var index = null;
    module.exports.syncLoop(array.length, function (loop) {
      var i = loop.iteration();
      if (array[i].addresses == object) {
        unique = false;
        index = i;
        loop.break(true);
        loop.next();
      } else {
        loop.next();
      }
    }, function(){
      return cb(unique, index);
    });
  },

  calculate_totals: function(vout, flags, cb) {
    // coinstake shouldn't count as money flow volume
    if (flags == "coinstake") {
       return cb([])
    } else {
      var totals = {};
      module.exports.syncLoop(vout.length, function (loop) {
        var i = loop.iteration();
        //module.exports.convert_to_satoshi(parseFloat(vout[i].amount), function(amount_sat){
          if (vout[i].currency in totals) {
            totals[currency] = totals[currency] + vout[i].amount;
          } else {
            totals[currency] = vout[i].amount;
          }
          loop.next();
        //});
      }, function() {
        for (const currency in totals) {
          totals[currency] = totals[currency].toFixed(8);
        }
        return cb(currs.sorted(totals));
      });
    }
  },

  prepare_vout: function(vout, txid, vin, cb) {
    var arr_vout = [];
    var arr_vin = [];
    arr_vin = vin;
    module.exports.syncLoop(vout.length, function (loop) {
      var i = loop.iteration();
      // make sure vout has an address
      if (vout[i].scriptPubKey.type != 'nonstandard') {
        var address;
        if (vout[i].scriptPubKey.type == 'nulldata') { 
          if (vout[i].flags == 'burn') {
            address = 'burnt-' + vout[i].currency;
          } else {
            // not a burn, move to next vout
            loop.next();
          }
        } else {
          address = vout[i].scriptPubKey.addresses[0];
        }
        // check if vout address is unique
        //    if so add it to the array
        //    if not add its amount to existing index
        //console.log('vout:' + i + ':' + txid);
        module.exports.is_unique(arr_vout, address, function(unique, index) {
          if (unique == true) {
            // unique vout
            module.exports.convert_to_satoshi(parseFloat(vout[i].value), function(amount_sat){
              arr_vout.push({n: i,
                             address: address;
                             amount: amount_sat,
                             currency: vout[i].currency});
              loop.next();
            });
          } else {
            // already exists
            module.exports.convert_to_satoshi(parseFloat(vout[i].value), function(amount_sat){
              arr_vout[index].amount = arr_vout[index].amount + amount_sat;
              loop.next();
            });
          }
        });
      } else {
        // no address, move to next vout
        loop.next();
      }
    }, function() {
        return cb(arr_vout, arr_vin);
      }
    });
  },

  get_input_addresses: function(input, vout, cb) {
    var addresses = [];
    if (input.coinbase) {
      var amounts = {},
      module.exports.syncLoop(vout.length, function (loop) {
        var i = loop.iteration();
          if (vout[i].currency in amounts) {
            amounts[vout[i].currency] += parseFloat(vout[i].value);
          } else {
            amounts[vout[i].currency] = parseFloat(vout[i].value); 
          }
          addresses.push({hash: ((i == 0) ? ('coinbase-' + currency)
                                          : ('scavenged-' + currency)),
                          amount: amounts[vout[i].currency],
                          currency: vout[i].currency});
          loop.next();
      }, function(){
        return cb(addresses);
      });
    } else {
      module.exports.get_rawtransaction(input.txid, function(tx) {
        if (tx) {
          module.exports.syncLoop(tx.vout.length, function (loop) {
            var i = loop.iteration();
            if (tx.vout[i].n == input.vout) {
              //module.exports.convert_to_satoshi(parseFloat(tx.vout[i].value), function(amount_sat){
              if (tx.vout[i].scriptPubKey.addresses) {
                addresses.push({hash: tx.vout[i].scriptPubKey.addresses[0],
                                amount: tx.vout[i].value,
                                currency: tx.vout[i].currency});  
              }
                loop.break(true);
                loop.next();
              //});
            } else {
              loop.next();
            } 
          }, function(){
            return cb(addresses);
          });
        } else {
          return cb();
        }
      });
    }
  },

  prepare_vin: function(tx, cb) {
    var arr_vin = [];
    module.exports.syncLoop(tx.vin.length,
                            function (loop) {
      var i = loop.iteration();
        module.exports.get_input_addresses(tx.vin[i],
                                           tx.vout,
                                           function(addresses) {   ///// asdf0
          if (addresses) {    //////// asdf1
            module.exports.syncLoop(addresses.length,
                                    function(loopAddresses) {  /////// asdf2
              var j = loopAddresses.iteration();
                //console.log('vin');
                module.exports.is_unique(arr_vin,
                                         addresses[j].hash,
                                         function(unique, index) {
                  if (unique == true) {
                    module.exports.convert_to_satoshi(parseFloat(addresses[j].amount),
                                                      function(amount_sat) {
asdfjkl;
                      arr_vin.push({n: i,
                                    address: addresses[j].hash,
                                    amount: amount_sat,
                                    currency: addresses[j].currency});
                    });
                  } else {
                    module.exports.convert_to_satoshi(parseFloat(addresses[j].amount),
                                                      function(amount_sat) {
                      arr_vin[index].amount = arr_vin[index].amount + amount_sat;
                    });
                  }
                });
                if (!vin[i].coinbase) {
                  loopAddresses.break(true);
                }
                loopAddresses.next();
              }, function() {   /////// closes loopInner asdf2
                loop.next();
              });
            } else {       ///////// closes if(addresses [&& addresses.size]) asdf1
                loop.next();
            }
      });
    }, function() {  ///////// closes get_input_addresses asdf0
      return cb(arr_vin);
    });
  }
};
